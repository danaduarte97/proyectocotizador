#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function countRows(client, tableName) {
    return Number((await client.query(
        `SELECT COUNT(*) AS total FROM ${tableName}`
    )).rows[0].total);
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const migrationPath = path.resolve(
        __dirname,
        "..",
        "sql",
        "20260726_posventa_afiliaciones.postgres.sql"
    );
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });
    const client = await pool.connect();

    try {
        const destino = (await client.query(`
            SELECT
                current_database() AS base,
                current_schema() AS esquema,
                current_user AS usuario,
                COALESCE(inet_server_addr()::text, 'local') AS servidor
        `)).rows[0];

        if (destino.base !== "postgres" || destino.esquema !== "public") {
            throw new Error(
                `Destino inesperado: ${destino.base}.${destino.esquema}`
            );
        }

        const antes = {
            cotizaciones: await countRows(client, "cotizaciones"),
            clientes: await countRows(client, "clientes"),
            tareas_crm: await countRows(client, "tareas_crm")
        };

        await client.query(migrationSql);

        const despues = {
            cotizaciones: await countRows(client, "cotizaciones"),
            clientes: await countRows(client, "clientes"),
            tareas_crm: await countRows(client, "tareas_crm")
        };
        const columnas = Number((await client.query(`
            SELECT COUNT(*) AS total
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND (
                  (
                      table_name = 'cotizaciones'
                      AND column_name IN (
                          'fecha_alta',
                          'estado_posventa',
                          'fecha_actualizacion_posventa'
                      )
                  )
                  OR (
                      table_name = 'tareas_crm'
                      AND column_name = 'clave_automatica'
                  )
              )
        `)).rows[0].total);
        const historial = (await client.query(`
            SELECT to_regclass(
                current_schema() || '.cotizaciones_posventa_historial'
            ) IS NOT NULL AS existe
        `)).rows[0].existe;

        assert.deepStrictEqual(
            despues,
            antes,
            "La migración modificó cantidades existentes"
        );
        assert.strictEqual(columnas, 4, "Faltan columnas de posventa");
        assert.strictEqual(historial, true, "Falta la tabla de historial");

        console.log(JSON.stringify({
            resultado: "MIGRACION_POSVENTA_APLICADA",
            archivo: migrationPath,
            destino,
            cantidades_conservadas: despues,
            columnas_posventa: columnas,
            tabla_historial: historial
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
