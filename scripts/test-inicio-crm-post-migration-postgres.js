#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const crypto = require("crypto");
const db = require("../db");

const ROLLBACK_TEST = Symbol("ROLLBACK_TEST");

async function rollbackTransaction(callback) {
    try {
        await db.transaction(async tx => {
            await callback(tx);
            throw ROLLBACK_TEST;
        });
    } catch (error) {
        if (error !== ROLLBACK_TEST) throw error;
    }
}

async function main() {
    assert.strictEqual(db.type, "postgres");

    const quoteResult = await db.pool.query(`
        SELECT
            c.id,
            c.cliente_id,
            c.etapa_pipeline,
            c.vendedora,
            u.id AS usuario_id
        FROM cotizaciones c
        JOIN usuarios u
          ON LOWER(TRIM(u.usuario)) = LOWER(TRIM(c.vendedora))
        WHERE c.etapa_pipeline IS NOT NULL
        ORDER BY c.id
        LIMIT 1
    `);
    const quote = quoteResult.rows[0];

    assert.ok(quote, "No hay una cotizacion activa con autora relacionada");

    const marker = `rollback-${crypto.randomUUID()}`;
    const tasksBefore = Number((await db.pool.query(
        "SELECT COUNT(*) AS total FROM tareas_crm"
    )).rows[0].total);
    let generatedTaskId = null;

    await rollbackTransaction(async tx => {
        const result = await tx.run(
            `
            INSERT INTO tareas_crm
            (
                titulo,
                fecha,
                tipo,
                estado,
                usuario_responsable_id,
                usuario_responsable,
                cotizacion_id,
                cliente_id
            )
            VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?, ?)
            `,
            [
                marker,
                "tarea",
                "pendiente",
                quote.usuario_id,
                quote.vendedora,
                quote.id,
                quote.cliente_id
            ]
        );

        generatedTaskId = result.lastID;
        assert.ok(generatedTaskId, "db.js no devolvio el ID de la tarea");

        const inserted = await tx.get(
            "SELECT id FROM tareas_crm WHERE id = ?",
            [generatedTaskId]
        );
        assert.strictEqual(String(inserted.id), String(generatedTaskId));
    });

    const taskAfter = Number((await db.pool.query(
        "SELECT COUNT(*) AS total FROM tareas_crm WHERE titulo = $1",
        [marker]
    )).rows[0].total);
    const tasksAfter = Number((await db.pool.query(
        "SELECT COUNT(*) AS total FROM tareas_crm"
    )).rows[0].total);

    assert.strictEqual(taskAfter, 0);
    assert.strictEqual(tasksAfter, tasksBefore);

    const temporaryStage = quote.etapa_pipeline === "Contactados"
        ? "Interesados"
        : "Contactados";

    await rollbackTransaction(async tx => {
        const result = await tx.run(
            "UPDATE cotizaciones SET etapa_pipeline = ? WHERE id = ?",
            [temporaryStage, quote.id]
        );
        assert.strictEqual(result.changes, 1);

        const changed = await tx.get(
            "SELECT etapa_pipeline FROM cotizaciones WHERE id = ?",
            [quote.id]
        );
        assert.strictEqual(changed.etapa_pipeline, temporaryStage);
    });

    const stageAfter = (await db.pool.query(
        "SELECT etapa_pipeline FROM cotizaciones WHERE id = $1",
        [quote.id]
    )).rows[0].etapa_pipeline;

    assert.strictEqual(stageAfter, quote.etapa_pipeline);

    console.log(JSON.stringify({
        resultado: "ROLLBACK_TESTS_OK",
        tarea: {
            id_generado_por_db_js: generatedTaskId,
            persistida_despues_del_rollback: false,
            total_antes: tasksBefore,
            total_despues: tasksAfter
        },
        etapa: {
            cotizacion_id: quote.id,
            valor_original: quote.etapa_pipeline,
            valor_temporal: temporaryStage,
            valor_despues_del_rollback: stageAfter
        }
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (db.pool) await db.pool.end();
    });
