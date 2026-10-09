#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const { Pool } = require("pg");
const { simularOportunidades } = require("../lib/oportunidades");

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
        const cotizaciones = await client.query(`
                    SELECT
                        id,
                        cliente_id,
                        fecha,
                        vendedora,
                        etapa_pipeline,
                        CASE
                            WHEN estado IN ('Abonó', 'AbonÃ³', 'AbonÃƒÂ³')
                                THEN 'Afiliado'
                            ELSE COALESCE(NULLIF(estado, ''), 'Nuevo')
                        END AS estado
                    FROM public.cotizaciones
                    ORDER BY fecha ASC, id ASC
                `);
        const identidadesPrimerContacto = await client.query(`
                    SELECT
                        identidades.id,
                        identidades.cliente_id,
                        identidades.procedencia_id,
                        identidades.fecha_creacion,
                        procedencias.codigo AS procedencia_codigo,
                        procedencias.nombre AS procedencia_nombre
                    FROM public.primer_contacto_identidades identidades
                    LEFT JOIN public.procedencias
                        ON procedencias.id = identidades.procedencia_id
                    WHERE identidades.cliente_id IS NOT NULL
                    ORDER BY identidades.cliente_id, identidades.id
                `);
        const usuarios = await client.query(`
                    SELECT id, usuario, rol
                    FROM public.usuarios
                    ORDER BY id
                `);
        const simulacion = simularOportunidades({
            cotizaciones: cotizaciones.rows,
            identidadesPrimerContacto: identidadesPrimerContacto.rows,
            usuarios: usuarios.rows
        });
        const responsables = new Map();
        const participantes = new Map();

        for (const oportunidad of simulacion.oportunidades) {
            const responsable = oportunidad.responsable || "Sin responsable";
            responsables.set(
                responsable,
                (responsables.get(responsable) || 0) + 1
            );

            for (const participante of oportunidad.participantes) {
                const actual = participantes.get(participante.asesora) || {
                    oportunidades: 0,
                    cotizaciones: 0
                };
                actual.oportunidades++;
                actual.cotizaciones += participante.cantidad_cotizaciones;
                participantes.set(participante.asesora, actual);
            }
        }

        await client.query("ROLLBACK");

        const detalleCompleto = process.argv.includes("--detalle");
        console.log(JSON.stringify({
            resultado: "SIMULACION_SOLO_LECTURA",
            resumen: simulacion.resumen,
            responsables_principales: Object.fromEntries(
                [...responsables.entries()].sort((a, b) =>
                    a[0].localeCompare(b[0], "es")
                )
            ),
            participaciones: Object.fromEntries(
                [...participantes.entries()].sort((a, b) =>
                    a[0].localeCompare(b[0], "es")
                )
            ),
            oportunidades_compartidas: simulacion.oportunidades
                .filter(oportunidad => oportunidad.participantes.length > 1)
                .map(oportunidad => ({
                    cliente_id: oportunidad.cliente_id,
                    responsable: oportunidad.responsable,
                    participantes: oportunidad.participantes.map(item => ({
                        asesora: item.asesora,
                        es_responsable: item.es_responsable,
                        cantidad_cotizaciones: item.cantidad_cotizaciones
                    })),
                    cotizaciones_ids: oportunidad.cotizaciones_ids,
                    etapa_propuesta: oportunidad.etapa
                })),
            pendientes_revision: simulacion.oportunidades
                .filter(oportunidad => oportunidad.conflictos.length)
                .map(oportunidad => ({
                    cliente_id: oportunidad.cliente_id,
                    cotizaciones_ids: oportunidad.cotizaciones_ids,
                    conflictos: oportunidad.conflictos,
                    etapas_legacy:
                        oportunidad.resolucion_etapa.etapas_legacy,
                    etapa_propuesta: oportunidad.etapa
                })),
            cotizaciones_sin_cliente: simulacion.cotizaciones_sin_cliente,
            ...(detalleCompleto
                ? { oportunidades: simulacion.oportunidades }
                : {})
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
