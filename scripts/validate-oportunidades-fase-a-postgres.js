#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const validationPath = path.resolve(
        __dirname,
        "..",
        "sql",
        "20261008_oportunidades_fase_a_validation.postgres.sql"
    );
    const validationSql = fs.readFileSync(validationPath, "utf8");
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });

    try {
        const results = await pool.query(validationSql);
        const selects = Array.isArray(results)
            ? results.filter(result => Array.isArray(result.rows))
            : [results];

        console.log(JSON.stringify({
            resultado: "VALIDACION_SOLO_LECTURA_OK",
            archivo: path.basename(validationPath),
            consultas: selects.map((result, indice) => ({
                numero: indice + 1,
                filas: result.rows
            }))
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
