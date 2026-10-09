#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const LOCAL_URL =
    "postgresql://postgres@127.0.0.1:55432/asis_etapa2_test";

async function esperarError(pool, sql, codigo) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await assert.rejects(
            client.query(sql),
            error => error.code === codigo
        );
    } finally {
        await client.query("ROLLBACK").catch(() => { });
        client.release();
    }
}

async function main() {
    const pool = new Pool({ connectionString: LOCAL_URL });

    try {
        const identidad = (await pool.query(`
            SELECT
                current_database() AS base,
                host(inet_server_addr()) AS host,
                inet_server_port() AS puerto,
                version() AS version
        `)).rows[0];

        assert.deepStrictEqual(
            [identidad.base, identidad.host, identidad.puerto],
            ["asis_etapa2_test", "127.0.0.1", 55432]
        );

        const indices = (await pool.query(`
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname IN (
                'uq_oportunidades_crm_cliente_activa',
                'idx_oportunidades_crm_etapa_estado',
                'idx_oportunidades_crm_responsable',
                'idx_oportunidades_crm_procedencia',
                'uq_oportunidad_asesora_responsable',
                'idx_oportunidad_asesoras_usuario',
                'idx_oportunidad_historial_oportunidad_fecha',
                'idx_cotizaciones_oportunidad_id'
              )
            ORDER BY indexname
        `)).rows.map(row => row.indexname);
        assert.strictEqual(indices.length, 8);

        await esperarError(pool, `
            INSERT INTO oportunidades_crm (
                cliente_id, ciclo, estado, etapa, fecha_inicio
            ) VALUES (1, 2, 'activa', 'Inicio', now())
        `, "23505");
        await esperarError(pool, `
            INSERT INTO oportunidades_crm (
                cliente_id, ciclo, estado, etapa, fecha_inicio
            ) VALUES (4, 2, 'activa', 'Etapa inválida', now())
        `, "23514");
        await esperarError(pool, `
            INSERT INTO oportunidad_asesoras (
                oportunidad_id,
                asesora_nombre_snapshot,
                asesora_nombre_normalizado,
                es_responsable,
                cantidad_cotizaciones,
                origen
            )
            SELECT
                id,
                'Otra responsable',
                'otra responsable',
                TRUE,
                0,
                'asignacion_manual'
            FROM oportunidades_crm
            WHERE cliente_id = 1
        `, "23505");
        await esperarError(pool, `
            INSERT INTO cotizaciones (
                cliente_id, nombre, celular, vendedora, estado,
                etapa_pipeline, oportunidad_id
            ) VALUES (
                1, 'Prueba FK', '9999999999', 'Ana Prueba', 'Nuevo',
                'Nuevos', 999999999
            )
        `, "23503");

        const clienteConcurrente = (await pool.query(`
            INSERT INTO clientes (nombre, celular, telefono_normalizado)
            VALUES ('Cliente Concurrente', '5555555555', '5555555555')
            RETURNING id
        `)).rows[0].id;
        const primero = await pool.connect();
        const segundo = await pool.connect();
        let segundoCodigo = null;

        try {
            await primero.query("BEGIN");
            await segundo.query("BEGIN");
            await segundo.query("SET LOCAL statement_timeout = '5s'");
            await primero.query(`
                INSERT INTO oportunidades_crm (
                    cliente_id, ciclo, estado, etapa, fecha_inicio,
                    responsable_nombre_snapshot, origen
                ) VALUES ($1, 1, 'activa', 'Inicio', now(),
                    'Ana Concurrente', 'prueba_concurrencia')
            `, [clienteConcurrente]);
            const segundoIntento = segundo.query(`
                INSERT INTO oportunidades_crm (
                    cliente_id, ciclo, estado, etapa, fecha_inicio,
                    responsable_nombre_snapshot, origen
                ) VALUES ($1, 2, 'activa', 'Inicio', now(),
                    'Bea Concurrente', 'prueba_concurrencia')
            `, [clienteConcurrente]).catch(error => {
                segundoCodigo = error.code;
            });

            await new Promise(resolve => setTimeout(resolve, 200));
            await primero.query("COMMIT");
            await segundoIntento;
            assert.strictEqual(segundoCodigo, "23505");
        } finally {
            await primero.query("ROLLBACK").catch(() => { });
            await segundo.query("ROLLBACK").catch(() => { });
            primero.release();
            segundo.release();
        }

        const activasConcurrentes = Number((await pool.query(`
            SELECT COUNT(*) AS cantidad
            FROM oportunidades_crm
            WHERE cliente_id = $1 AND estado = 'activa'
        `, [clienteConcurrente])).rows[0].cantidad);
        assert.strictEqual(activasConcurrentes, 1);

        await pool.query(
            "DELETE FROM oportunidades_crm WHERE cliente_id = $1",
            [clienteConcurrente]
        );
        await pool.query(
            "DELETE FROM clientes WHERE id = $1",
            [clienteConcurrente]
        );

        const backfillSql = fs.readFileSync(
            path.resolve(
                __dirname,
                "..",
                "sql",
                "20261008_oportunidades_fase_a_backfill.postgres.sql"
            ),
            "utf8"
        );
        const revision = await pool.connect();
        let bloqueoEtapa = null;

        try {
            await revision.query("BEGIN");
            const clienteRevision = (await revision.query(`
                INSERT INTO clientes (nombre, celular, telefono_normalizado)
                VALUES ('Cliente Etapa Ambigua', '6666666666', '6666666666')
                RETURNING id
            `)).rows[0].id;
            await revision.query(`
                INSERT INTO cotizaciones (
                    cliente_id, nombre, celular, vendedora, estado,
                    etapa_pipeline
                ) VALUES ($1, 'Cliente Etapa Ambigua', '6666666666',
                    'Ana Prueba', 'Nuevo', 'Etapa legacy desconocida')
            `, [clienteRevision]);

            await revision.query(backfillSql).catch(error => {
                bloqueoEtapa = {
                    codigo: error.code,
                    mensaje: error.message
                };
            });
            assert.strictEqual(bloqueoEtapa?.codigo, "P0001");
            assert.match(
                bloqueoEtapa?.mensaje || "",
                /etapas históricas no reconocidas/
            );
        } finally {
            await revision.query("ROLLBACK").catch(() => { });
            revision.release();
        }

        console.log(JSON.stringify({
            resultado: "OK",
            entorno: identidad,
            indices_verificados: indices,
            restricciones: {
                oportunidad_activa_unica: "23505",
                etapa_valida: "23514",
                responsable_unica: "23505",
                clave_foranea_cotizacion: "23503"
            },
            concurrencia: {
                segundo_insert_rechazado: segundoCodigo,
                oportunidades_activas_finales: activasConcurrentes
            },
            etapa_historica_no_reconocida: bloqueoEtapa
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
