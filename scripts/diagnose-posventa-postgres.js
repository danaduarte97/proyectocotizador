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

        const destino = (await client.query(`
            SELECT
                current_database() AS base,
                current_schema() AS esquema,
                current_user AS usuario,
                COALESCE(inet_server_addr()::text, 'local') AS servidor
        `)).rows[0];
        const columnas = (await client.query(`
            SELECT table_name, column_name, data_type, is_nullable
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
            ORDER BY table_name, column_name
        `)).rows;
        const historial = (await client.query(`
            SELECT to_regclass(
                current_schema() || '.cotizaciones_posventa_historial'
            )::text AS tabla
        `)).rows[0].tabla;
        const totales = (await client.query(`
            SELECT
                (SELECT COUNT(*) FROM cotizaciones)::integer
                    AS cotizaciones,
                (SELECT COUNT(*) FROM clientes)::integer
                    AS clientes,
                (SELECT COUNT(*) FROM tareas_crm)::integer
                    AS tareas
        `)).rows[0];
        const afiliadosSinFecha = columnas.some(
            columna =>
                columna.table_name === "cotizaciones"
                && columna.column_name === "fecha_alta"
        )
            ? Number((await client.query(`
                SELECT COUNT(*) AS total
                FROM cotizaciones
                WHERE etapa_pipeline = 'Afiliados'
                  AND fecha_alta IS NULL
            `)).rows[0].total)
            : null;

        await client.query("ROLLBACK");
        transactionOpen = false;

        console.log(JSON.stringify({
            resultado: "DIAGNOSTICO_SOLO_LECTURA",
            destino,
            columnas_posventa: columnas,
            tabla_historial: historial,
            totales,
            afiliaciones_sin_fecha_alta: afiliadosSinFecha
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
