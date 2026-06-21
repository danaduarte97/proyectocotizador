#!/usr/bin/env node

console.error(
    "Migracion deshabilitada: Supabase debe arrancar limpio. " +
    "No copiar cotizaciones, usuarios, comentarios ni archivos desde SQLite."
);
process.exit(1);

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const rootDir = path.resolve(__dirname, "..");
const sqlitePath = path.join(rootDir, "database.db");
const backupsDir = path.join(rootDir, "backups");
const tables = [
    "usuarios",
    "cotizaciones",
    "archivos",
    "comentarios_cotizacion"
];

function timestamp() {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("") + "-" + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join("");
}

function openSqlite() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(
            sqlitePath,
            sqlite3.OPEN_READONLY,
            error => {
                if (error) reject(error);
                else resolve(db);
            }
        );
    });
}

function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows);
        });
    });
}

function closeSqlite(db) {
    return new Promise((resolve, reject) => {
        db.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function createBackup() {
    if (!fs.existsSync(sqlitePath)) {
        throw new Error(`No se encontro SQLite en ${sqlitePath}`);
    }

    fs.mkdirSync(backupsDir, { recursive: true });

    const backupPath = path.join(backupsDir, `database-${timestamp()}.db`);
    fs.copyFileSync(sqlitePath, backupPath, fs.constants.COPYFILE_EXCL);

    return backupPath;
}

function normalizeTimestamp(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
        return null;
    }

    const text = String(value).trim();

    if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) {
        return text;
    }

    return `${text.replace(" ", "T")}-03:00`;
}

function normalizeDate(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
        return null;
    }

    return String(value).trim().slice(0, 10);
}

function mapRows(table, rows) {
    if (table === "cotizaciones") {
        return rows.map(row => ({
            ...row,
            fecha: normalizeTimestamp(row.fecha),
            fecha_seguimiento: normalizeDate(row.fecha_seguimiento)
        }));
    }

    if (table === "archivos" || table === "comentarios_cotizacion") {
        return rows.map(row => ({
            ...row,
            fecha: normalizeTimestamp(row.fecha)
        }));
    }

    return rows;
}

async function readSourceData() {
    const db = await openSqlite();

    try {
        const data = {};

        for (const table of tables) {
            const rows = await sqliteAll(
                db,
                `SELECT * FROM ${quoteIdentifier(table)} ORDER BY id`
            );

            data[table] = mapRows(table, rows);
        }

        return data;
    } finally {
        await closeSqlite(db);
    }
}

function countRowsByTable(data) {
    return Object.fromEntries(
        tables.map(table => [table, data[table]?.length || 0])
    );
}

function printCounts(title, counts) {
    console.log(`\n${title}`);
    for (const table of tables) {
        console.log(`- ${table}: ${counts[table]}`);
    }
}

async function getPostgresCounts(client) {
    const counts = {};

    for (const table of tables) {
        const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(table)}`
        );
        counts[table] = result.rows[0].count;
    }

    return counts;
}

function hasExistingRows(counts) {
    return Object.values(counts).some(count => Number(count) > 0);
}

async function confirmExistingRows(counts) {
    printCounts("PostgreSQL ya tiene datos:", counts);
    console.log("\nEl script no borra ni pisa datos existentes.");
    console.log("Si continuas, intentara insertar preservando IDs y fallara si hay conflictos.");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise(resolve => {
        rl.question(
            "\nEscribi MIGRAR_CON_DATOS_EXISTENTES para continuar, o Enter para cancelar: ",
            resolve
        );
    });

    rl.close();

    if (answer !== "MIGRAR_CON_DATOS_EXISTENTES") {
        throw new Error("Migracion cancelada: PostgreSQL ya contiene datos.");
    }
}

function validateSourceData(data) {
    const requiredColumns = {
        usuarios: ["id", "usuario", "password", "rol"],
        cotizaciones: ["id", "dni", "fecha", "estado"],
        archivos: ["id", "archivo"],
        comentarios_cotizacion: ["id", "comentario"]
    };

    for (const [table, columns] of Object.entries(requiredColumns)) {
        for (const row of data[table]) {
            for (const column of columns) {
                if (row[column] === null || row[column] === undefined || String(row[column]).trim() === "") {
                    throw new Error(
                        `Dato requerido vacio en ${table}.${column}, id ${row.id}`
                    );
                }
            }
        }
    }
}

async function insertRows(client, table, rows) {
    if (rows.length === 0) {
        return;
    }

    const columns = Object.keys(rows[0]);
    const quotedColumns = columns.map(quoteIdentifier).join(", ");

    for (const row of rows) {
        const values = columns.map(column => row[column]);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");

        await client.query(
            `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})`,
            values
        );
    }
}

async function resetSequence(client, table, idColumn = "id") {
    const sequenceResult = await client.query(
        "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
        [`public.${table}`, idColumn]
    );
    const sequenceName = sequenceResult.rows[0]?.sequence_name;

    if (!sequenceName) {
        return;
    }

    await client.query(
        `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdentifier(idColumn)}) FROM ${quoteIdentifier(table)}), 1), (SELECT COUNT(*) > 0 FROM ${quoteIdentifier(table)}))`,
        [sequenceName]
    );
}

async function migrate() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const backupPath = createBackup();
    console.log(`Backup creado: ${backupPath}`);

    const sourceData = await readSourceData();
    validateSourceData(sourceData);
    printCounts("SQLite origen:", countRowsByTable(sourceData));

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });

    const client = await pool.connect();

    try {
        const beforeCounts = await getPostgresCounts(client);

        if (hasExistingRows(beforeCounts)) {
            await confirmExistingRows(beforeCounts);
        } else {
            printCounts("PostgreSQL destino antes:", beforeCounts);
        }

        await client.query("BEGIN");

        for (const table of tables) {
            await insertRows(client, table, sourceData[table]);
        }

        for (const table of tables) {
            await resetSequence(client, table);
        }

        const afterCounts = await getPostgresCounts(client);
        await client.query("COMMIT");

        printCounts("PostgreSQL destino despues:", afterCounts);
        console.log("\nMigracion completada correctamente.");
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (_) {
            // If no transaction started, there is nothing to roll back.
        }

        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(error => {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
});
