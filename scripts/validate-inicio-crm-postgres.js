#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const { Pool } = require("pg");

const ETAPAS = [
    "Nuevos",
    "Contactados",
    "Interesados",
    "Documentaci\u00f3n",
    "Auditor\u00eda",
    "Afiliados"
];

const ESTADOS_AFILIADO = new Set([
    "Afiliado",
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xf3),
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xc3, 0xb3),
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xc3, 0x83, 0xc2, 0xb3),
    String.fromCharCode(
        0x41,
        0x62,
        0x6f,
        0x6e,
        0xc3,
        0x83,
        0xc6,
        0x92,
        0xc3,
        0x82,
        0xc2,
        0xb3
    )
]);
const ESTADOS_CIERRE_NEGATIVO = new Set([
    "anulada",
    "anulado",
    "perdido",
    "perdida",
    "no interesado",
    "no interesada",
    "rechazado",
    "rechazada",
    "cancelado",
    "cancelada",
    "descartado",
    "descartada",
    "cerrado sin venta",
    "no viable",
    "no califica",
    "no calificado",
    "no calificada"
]);

function etapaPrevista(estado) {
    if (ESTADOS_CIERRE_NEGATIVO.has(String(estado || "").trim().toLowerCase())) {
        return null;
    }

    if (ESTADOS_AFILIADO.has(estado)) return "Afiliados";
    if (estado === "Contactado") return "Contactados";
    return "Nuevos";
}

async function existeTabla(client, tabla) {
    const result = await client.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = $1
        ) AS existe
        `,
        [tabla]
    );

    return result.rows[0].existe;
}

async function existeColumna(client, tabla, columna) {
    const result = await client.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = $1
              AND column_name = $2
        ) AS existe
        `,
        [tabla, columna]
    );

    return result.rows[0].existe;
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

        const conexion = (await client.query(`
            SELECT
                current_database() AS base,
                current_schema() AS esquema,
                current_user AS usuario,
                COALESCE(inet_server_addr()::text, 'local') AS servidor
        `)).rows[0];
        const etapaPipelineExiste = await existeColumna(
            client,
            "cotizaciones",
            "etapa_pipeline"
        );
        const tareasCrmExiste = await existeTabla(client, "tareas_crm");
        const clientesExiste = await existeTabla(client, "clientes");
        const cotizacionesTotal = Number((await client.query(
            "SELECT COUNT(*) AS total FROM cotizaciones"
        )).rows[0].total);
        const clientesTotal = clientesExiste
            ? Number((await client.query(
                "SELECT COUNT(*) AS total FROM clientes"
            )).rows[0].total)
            : null;
        const estadosActuales = (await client.query(`
            SELECT
                COALESCE(NULLIF(TRIM(estado), ''), '<VACIO>') AS estado,
                COUNT(*) AS cantidad
            FROM cotizaciones
            GROUP BY 1
            ORDER BY 1
        `)).rows.map(row => ({
            estado: row.estado,
            cantidad: Number(row.cantidad)
        }));
        const distribucionPrevista = Object.fromEntries(
            ETAPAS.map(etapa => [etapa, 0])
        );
        let excluidasPipeline = 0;

        for (const row of estadosActuales) {
            const estado = row.estado === "<VACIO>" ? "" : row.estado;
            const etapa = etapaPrevista(estado);

            if (etapa) distribucionPrevista[etapa] += row.cantidad;
            else excluidasPipeline += row.cantidad;
        }

        const estadosPorFallback = estadosActuales
            .filter(row => {
                const estado = row.estado === "<VACIO>" ? "" : row.estado;
                return etapaPrevista(estado) === "Nuevos";
            });
        const distribucionActual = etapaPipelineExiste
            ? (await client.query(`
                SELECT
                    COALESCE(NULLIF(TRIM(etapa_pipeline), ''), '<VACIO>') AS etapa,
                    COUNT(*) AS cantidad
                FROM cotizaciones
                GROUP BY 1
                ORDER BY 1
            `)).rows.map(row => ({
                etapa: row.etapa,
                cantidad: Number(row.cantidad)
            }))
            : null;
        const tareasCrmFilas = tareasCrmExiste
            ? Number((await client.query(
                "SELECT COUNT(*) AS total FROM tareas_crm"
            )).rows[0].total)
            : null;
        const constraintExiste = (await client.query(`
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE c.conname = 'cotizaciones_etapa_pipeline_check'
                  AND t.relname = 'cotizaciones'
                  AND n.nspname = current_schema()
            ) AS existe
        `)).rows[0].existe;

        await client.query("ROLLBACK");
        transactionOpen = false;

        console.log(JSON.stringify({
            modo: "READ ONLY; finalizado con ROLLBACK",
            conexion,
            cotizaciones_total: cotizacionesTotal,
            clientes_total: clientesTotal,
            etapa_pipeline_existe: etapaPipelineExiste,
            tareas_crm_existe: tareasCrmExiste,
            tareas_crm_filas: tareasCrmFilas,
            constraint_pipeline_existe: constraintExiste,
            estados_actuales: estadosActuales,
            distribucion_prevista: distribucionPrevista,
            excluidas_del_pipeline: excluidasPipeline,
            cotizaciones_conservadas: cotizacionesTotal,
            estados_sin_mapeo: [],
            estados_mapeados_a_nuevos_por_fallback: estadosPorFallback,
            distribucion_pipeline_actual: distribucionActual
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
