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
        await client.query("BEGIN READ ONLY");
        const tablas = await client.query(`
            SELECT
                to_regclass('public.primer_contacto_identidades') AS identidades,
                to_regclass('public.primer_contacto_gestiones') AS gestiones
        `);
        const existen = Boolean(
            tablas.rows[0].identidades && tablas.rows[0].gestiones
        );
        let resumen = null;

        if (existen) {
            resumen = (await client.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM public.primer_contacto_identidades)
                        AS telefonos,
                    (SELECT COUNT(*)::int FROM public.primer_contacto_gestiones)
                        AS gestiones,
                    (
                        SELECT COUNT(*)::int
                        FROM public.primer_contacto_identidades
                        WHERE cliente_id IS NOT NULL
                    ) AS vinculados_clientes
            `)).rows[0];
        }

        await client.query("ROLLBACK");
        console.log(JSON.stringify({
            resultado: "READ_ONLY_OK",
            tablas: tablas.rows[0],
            resumen
        }, null, 2));
    } catch (error) {
        await client.query("ROLLBACK");
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
