#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const { Pool } = require("pg");

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

        const result = await client.query(`
            SELECT
                id,
                estado,
                etapa_pipeline,
                fecha_alta,
                estado_posventa
            FROM cotizaciones
            WHERE
                (estado = 'Afiliado' AND etapa_pipeline IS DISTINCT FROM 'Afiliados')
                OR
                (etapa_pipeline = 'Afiliados' AND estado IS DISTINCT FROM 'Afiliado')
            ORDER BY id
        `);

        await client.query("ROLLBACK");
        transactionOpen = false;

        console.log(JSON.stringify({
            resultado: "DIAGNOSTICO_SOLO_LECTURA",
            inconsistencias: result.rows
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
    console.error(error.stack || error.message);
    process.exit(1);
});
