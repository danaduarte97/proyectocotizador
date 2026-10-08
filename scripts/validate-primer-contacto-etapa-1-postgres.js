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

    try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        const catalogo = (await client.query(`
            SELECT codigo, nombre, seleccionable, activa, orden
            FROM public.procedencias
            ORDER BY orden, id
        `)).rows;
        const identidades = (await client.query(`
            SELECT
                COUNT(*)::integer AS total,
                COUNT(*) FILTER (WHERE procedencia_id IS NULL)::integer
                    AS sin_procedencia,
                COUNT(*) FILTER (WHERE no_interesa)::integer AS no_interesa,
                COUNT(*) FILTER (WHERE no_enviar_mensajes)::integer
                    AS no_enviar_mensajes
            FROM public.primer_contacto_identidades
        `)).rows[0];
        const distribucion = (await client.query(`
            SELECT procedencias.codigo, COUNT(*)::integer AS cantidad
            FROM public.primer_contacto_identidades identidades
            JOIN public.procedencias
                ON procedencias.id = identidades.procedencia_id
            GROUP BY procedencias.codigo
            ORDER BY procedencias.codigo
        `)).rows;
        const historial = (await client.query(`
            SELECT COUNT(*)::integer AS eventos_backfill
            FROM public.primer_contacto_procedencia_historial
            WHERE accion = 'backfill_historico'
        `)).rows[0];
        const preservados = (await client.query(`
            SELECT
                (SELECT COUNT(*) FROM public.clientes)::integer AS clientes,
                (SELECT COUNT(*) FROM public.cotizaciones)::integer
                    AS cotizaciones,
                (SELECT COUNT(*) FROM public.primer_contacto_gestiones)::integer
                    AS gestiones
        `)).rows[0];

        await client.query("ROLLBACK");
        console.log(JSON.stringify({
            resultado: "READ_ONLY_OK",
            catalogo,
            identidades,
            distribucion,
            historial,
            preservados
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
    console.error(error.stack || error.message);
    process.exit(1);
});
