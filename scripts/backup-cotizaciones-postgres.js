#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

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

async function tableExists(client, tableName) {
    const result = await client.query(
        `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
            AND table_name = $1
        `,
        [tableName]
    );

    return result.rowCount > 0;
}

async function readTable(client, tableName) {
    if (!(await tableExists(client, tableName))) {
        return [];
    }

    const result = await client.query(`SELECT * FROM ${tableName} ORDER BY id`);
    return result.rows;
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });

    try {
        const client = await pool.connect();

        try {
            const backup = {
                created_at: new Date().toISOString(),
                source: "postgres",
                tables: {
                    cotizaciones: await readTable(client, "cotizaciones"),
                    cotizacion_opciones: await readTable(client, "cotizacion_opciones"),
                    archivos: await readTable(client, "archivos"),
                    comentarios_cotizacion: await readTable(client, "comentarios_cotizacion")
                }
            };
            const backupsDir = path.resolve(__dirname, "..", "backups");
            const backupPath = path.join(
                backupsDir,
                `cotizaciones-before-clientes-${timestamp()}.json`
            );

            fs.mkdirSync(backupsDir, { recursive: true });
            fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

            console.log(JSON.stringify({
                backup_path: backupPath,
                cotizaciones: backup.tables.cotizaciones.length,
                cotizacion_opciones: backup.tables.cotizacion_opciones.length,
                archivos: backup.tables.archivos.length,
                comentarios_cotizacion: backup.tables.comentarios_cotizacion.length
            }, null, 2));
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
