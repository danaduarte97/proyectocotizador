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
        "20260817_primer_contacto.postgres.sql"
    );
    const migration = fs.readFileSync(migrationPath, "utf8");
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });

    try {
        await pool.query(migration);
        console.log(JSON.stringify({
            resultado: "OK",
            migracion: path.basename(migrationPath)
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
