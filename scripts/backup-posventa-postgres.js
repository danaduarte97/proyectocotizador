#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
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
            SELECT
                current_database() AS base,
                current_schema() AS esquema,
                COALESCE(inet_server_addr()::text, 'local') AS servidor
        `)).rows[0];
        const tables = {};

        for (const tableName of ["cotizaciones", "clientes", "tareas_crm"]) {
            tables[tableName] = (await client.query(
                `SELECT * FROM ${tableName} ORDER BY id`
            )).rows;
        }

        await client.query("ROLLBACK");
        transactionOpen = false;

        const content = JSON.stringify({
            created_at: new Date().toISOString(),
            source,
            read_mode: "PostgreSQL READ ONLY; finalizado con ROLLBACK",
            tables
        }, null, 2);
        const checksum = crypto
            .createHash("sha256")
            .update(content)
            .digest("hex");
        const backupDir = path.resolve(__dirname, "..", "backups");
        const backupPath = path.join(
            backupDir,
            `posventa-pre-migration-${timestamp()}.json`
        );

        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(backupPath, content, {
            encoding: "utf8",
            flag: "wx"
        });

        console.log(JSON.stringify({
            backup_path: backupPath,
            sha256: checksum,
            destino: source,
            cantidades: Object.fromEntries(
                Object.entries(tables).map(
                    ([tableName, rows]) => [tableName, rows.length]
                )
            )
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
