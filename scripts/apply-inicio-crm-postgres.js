#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const migrationPath = path.resolve(
        __dirname,
        "..",
        "sql",
        "20260722_inicio_crm.postgres.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });
    const client = await pool.connect();

    try {
        const target = (await client.query(`
            SELECT
                current_database() AS base,
                current_schema() AS esquema,
                current_user AS usuario,
                COALESCE(inet_server_addr()::text, 'local') AS servidor
        `)).rows[0];

        if (target.base !== "postgres" || target.esquema !== "public") {
            throw new Error(
                `Destino inesperado: ${target.base}.${target.esquema}`
            );
        }

        await client.query(sql);

        console.log(JSON.stringify({
            resultado: "MIGRACION_APLICADA",
            archivo: migrationPath,
            destino: target
        }, null, 2));
    } catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
