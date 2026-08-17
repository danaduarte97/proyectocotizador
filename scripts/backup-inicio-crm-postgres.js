#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readTable(client, tableName) {
    if (!["cotizaciones", "clientes"].includes(tableName)) {
        throw new Error("Tabla no permitida para este respaldo");
    }

    const exists = await client.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = $1
        ) AS existe
        `,
        [tableName]
    );

    if (!exists.rows[0].existe) return [];

    return (await client.query(`SELECT * FROM ${tableName} ORDER BY id`)).rows;
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
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        transactionOpen = true;

        const source = (await client.query(`
            SELECT current_database() AS base, current_schema() AS esquema
        `)).rows[0];
        const cotizaciones = await readTable(client, "cotizaciones");
        const clientes = await readTable(client, "clientes");

        await client.query("ROLLBACK");
        transactionOpen = false;

        const backup = {
            created_at: new Date().toISOString(),
            source,
            read_mode: "PostgreSQL READ ONLY; finalizado con ROLLBACK",
            tables: {
                cotizaciones,
                clientes
            }
        };
        const content = JSON.stringify(backup, null, 2);
        const checksum = crypto.createHash("sha256").update(content).digest("hex");
        const backupsDir = path.resolve(__dirname, "..", "backups");
        const backupPath = path.join(
            backupsDir,
            `inicio-crm-pre-migration-${timestamp()}.json`
        );

        fs.mkdirSync(backupsDir, { recursive: true });
        fs.writeFileSync(backupPath, content, { encoding: "utf8", flag: "wx" });

        console.log(JSON.stringify({
            backup_path: backupPath,
            sha256: checksum,
            cotizaciones: cotizaciones.length,
            clientes: clientes.length
        }, null, 2));
    } finally {
        if (transactionOpen) {
            await client.query("ROLLBACK").catch(() => { });
        }

        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
