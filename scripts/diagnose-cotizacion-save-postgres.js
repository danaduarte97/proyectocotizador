#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BACKUP_NAME = "inicio-crm-pre-migration-2026-07-23T01-45-21-122Z.json";

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const backup = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, "..", "backups", BACKUP_NAME),
        "utf8"
    ));
    const backupQuoteIds = new Set(
        backup.tables.cotizaciones.map(row => String(row.id))
    );
    const backupClientIds = new Set(
        backup.tables.clientes.map(row => String(row.id))
    );
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

        const quotes = (await client.query(`
            SELECT id, cliente_id
            FROM cotizaciones
            ORDER BY id
        `)).rows;
        const clients = (await client.query(`
            SELECT id
            FROM clientes
            ORDER BY id
        `)).rows;
        const clientsWithoutQuotes = Number((await client.query(`
            SELECT COUNT(*) AS total
            FROM clientes c
            LEFT JOIN cotizaciones q ON q.cliente_id = c.id
            WHERE q.id IS NULL
        `)).rows[0].total);
        const duplicateClientIdentities = Number((await client.query(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT identidad_tipo, identidad_valor
                FROM clientes
                GROUP BY identidad_tipo, identidad_valor
                HAVING COUNT(*) > 1
            ) duplicates
        `)).rows[0].total);
        const duplicateQuotes = Number((await client.query(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT
                    cliente_id,
                    COALESCE(dni, ''),
                    COALESCE(nombre, ''),
                    COALESCE(celular, ''),
                    COALESCE(plan, ''),
                    COALESCE(valor, ''),
                    COALESCE(vendedora, ''),
                    fecha
                FROM cotizaciones
                GROUP BY
                    cliente_id,
                    COALESCE(dni, ''),
                    COALESCE(nombre, ''),
                    COALESCE(celular, ''),
                    COALESCE(plan, ''),
                    COALESCE(valor, ''),
                    COALESCE(vendedora, ''),
                    fecha
                HAVING COUNT(*) > 1
            ) duplicates
        `)).rows[0].total);
        const quotesWithoutClient = Number((await client.query(`
            SELECT COUNT(*) AS total
            FROM cotizaciones
            WHERE cliente_id IS NULL
        `)).rows[0].total);

        await client.query("ROLLBACK");
        transactionOpen = false;

        console.log(JSON.stringify({
            resultado: "DIAGNOSTICO_READ_ONLY_OK",
            cotizaciones_actuales: quotes.length,
            clientes_actuales: clients.length,
            cotizaciones_nuevas_desde_respaldo: quotes
                .filter(row => !backupQuoteIds.has(String(row.id))).length,
            clientes_nuevos_desde_respaldo: clients
                .filter(row => !backupClientIds.has(String(row.id))).length,
            clientes_sin_cotizacion: clientsWithoutQuotes,
            cotizaciones_sin_cliente_id: quotesWithoutClient,
            identidades_cliente_duplicadas: duplicateClientIdentities,
            cotizaciones_exactas_duplicadas: duplicateQuotes
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
