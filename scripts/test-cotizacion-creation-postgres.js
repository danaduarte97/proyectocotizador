#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const crypto = require("crypto");
const db = require("../db");

const ROLLBACK_TEST = Symbol("ROLLBACK_TEST");

async function counts() {
    const result = await db.pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM clientes) AS clientes,
            (SELECT COUNT(*)::int FROM cotizaciones) AS cotizaciones,
            (SELECT COUNT(*)::int FROM cotizacion_opciones) AS opciones
    `);

    return result.rows[0];
}

async function insertQuote(tx, values) {
    const result = await tx.run(
        `
        INSERT INTO cotizaciones
        (
            id,
            cliente_id,
            dni,
            nombre,
            celular,
            plan,
            tipo_cobertura,
            valor,
            bonificacion,
            bonificacion_aportes,
            modalidad,
            vendedora,
            vigencia,
            referido,
            congelamiento,
            comentarios
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        values
    );
    const id = result.lastID;

    assert.strictEqual(String(id), String(values[0]));

    await tx.run(
        `
        INSERT INTO cotizacion_opciones
        (
            id,
            cotizacion_id,
            numero_opcion,
            plan,
            tipo_cobertura,
            valor,
            bonificacion,
            bonificacion_aportes
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `,
        [
            values[0] * 10,
            id,
            values[5],
            values[6],
            values[7],
            values[8],
            values[9]
        ]
    );

    return tx.get(
        `
        SELECT id, cliente_id, vendedora, estado, etapa_pipeline
        FROM cotizaciones
        WHERE id = ?
        `,
        [id]
    );
}

async function main() {
    assert.strictEqual(db.type, "postgres");

    const existing = (await db.pool.query(`
        SELECT c.*, u.usuario
        FROM clientes c
        JOIN cotizaciones q ON q.cliente_id = c.id
        JOIN usuarios u
          ON LOWER(TRIM(u.usuario)) = LOWER(TRIM(q.vendedora))
        ORDER BY c.id
        LIMIT 1
    `)).rows[0];

    assert.ok(existing, "No hay un cliente existente utilizable para la prueba");

    const before = await counts();
    const suffix = crypto.randomBytes(5).toString("hex");
    const baseId = -Number.parseInt(suffix.slice(0, 6), 16) - 1000;
    const newClientId = baseId;
    const newQuoteId = baseId - 1;
    const existingQuoteId = baseId - 2;
    let newQuote;
    let existingQuote;

    try {
        await db.transaction(async tx => {
            const newClient = await tx.get(
                `
                INSERT INTO clientes
                (
                    id,
                    identidad_tipo,
                    identidad_valor,
                    dni,
                    dni_normalizado,
                    nombre,
                    celular,
                    telefono_normalizado,
                    vendedora_id,
                    vendedora_asignada,
                    etapa_comercial
                )
                SELECT ?, 'dni', ?, ?, ?, ?, ?, ?, u.id, u.usuario, 'Nuevo'
                FROM usuarios u
                WHERE LOWER(TRIM(u.usuario)) = LOWER(TRIM(?))
                LIMIT 1
                RETURNING *
                `,
                [
                    newClientId,
                    `99${suffix}`,
                    `99${suffix}`,
                    `99${suffix}`,
                    "Cliente Ficticio",
                    `11${suffix}`,
                    `11${suffix}`,
                    existing.usuario
                ]
            );

            assert.ok(newClient);

            newQuote = await insertQuote(tx, [
                newQuoteId,
                newClient.id,
                newClient.dni,
                newClient.nombre,
                newClient.celular,
                "Plan Ficticio Nuevo",
                "Individual",
                "12345",
                "0",
                "0",
                "Particular",
                existing.usuario,
                null,
                "No",
                null,
                "Prueba con rollback"
            ]);
            existingQuote = await insertQuote(tx, [
                existingQuoteId,
                existing.id,
                existing.dni,
                existing.nombre,
                existing.celular,
                "Plan Ficticio Existente",
                "Individual",
                "23456",
                "0",
                "0",
                "Particular",
                existing.usuario,
                null,
                "No",
                null,
                "Prueba con rollback"
            ]);

            for (const quote of [newQuote, existingQuote]) {
                assert.strictEqual(quote.vendedora, existing.usuario);
                assert.strictEqual(quote.estado, "Nuevo");
                assert.strictEqual(quote.etapa_pipeline, "Nuevos");
            }

            assert.strictEqual(String(newQuote.cliente_id), String(newClient.id));
            assert.strictEqual(String(existingQuote.cliente_id), String(existing.id));

            throw ROLLBACK_TEST;
        });
    } catch (error) {
        if (error !== ROLLBACK_TEST) throw error;
    }

    const after = await counts();
    const remaining = (await db.pool.query(
        `
        SELECT
            (SELECT COUNT(*)::int FROM clientes WHERE id = $1) AS clientes,
            (SELECT COUNT(*)::int FROM cotizaciones WHERE id IN ($2, $3)) AS cotizaciones,
            (SELECT COUNT(*)::int FROM cotizacion_opciones WHERE cotizacion_id IN ($2, $3)) AS opciones
        `,
        [newClientId, newQuoteId, existingQuoteId]
    )).rows[0];

    assert.deepStrictEqual(after, before);
    assert.deepStrictEqual(remaining, {
        clientes: 0,
        cotizaciones: 0,
        opciones: 0
    });

    console.log(JSON.stringify({
        resultado: "CREACION_COTIZACION_ROLLBACK_OK",
        cliente_nuevo: {
            cliente_id_correcto: true,
            autoria_correcta: true,
            estado: newQuote.estado,
            etapa_pipeline: newQuote.etapa_pipeline
        },
        cliente_existente: {
            cliente_id_correcto: true,
            autoria_correcta: true,
            estado: existingQuote.estado,
            etapa_pipeline: existingQuote.etapa_pipeline
        },
        persistencia_ficticia: remaining,
        cantidades_antes: before,
        cantidades_despues: after
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
