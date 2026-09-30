#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BACKUP_NAME = "inicio-crm-pre-migration-2026-07-23T01-45-21-122Z.json";
const ESTADOS_CIERRE_NEGATIVO = [
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
];

function normalizeValue(value) {
    return value instanceof Date ? value.toISOString() : value;
}

function compareBackupRows(tableName, beforeRows, afterRows) {
    assert.strictEqual(
        afterRows.length,
        beforeRows.length,
        `${tableName}: cambio la cantidad de filas`
    );

    const afterById = new Map(afterRows.map(row => [String(row.id), row]));
    const differences = [];

    for (const before of beforeRows) {
        const after = afterById.get(String(before.id));

        if (!after) {
            differences.push({ id: before.id, campo: "<fila eliminada>" });
            continue;
        }

        for (const key of Object.keys(before)) {
            if (normalizeValue(after[key]) !== normalizeValue(before[key])) {
                differences.push({ id: before.id, campo: key });
            }
        }
    }

    assert.deepStrictEqual(
        differences,
        [],
        `${tableName}: hay valores originales modificados`
    );
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const backupPath = path.resolve(__dirname, "..", "backups", BACKUP_NAME);
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
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

        const cotizaciones = (await client.query(
            "SELECT * FROM cotizaciones ORDER BY id"
        )).rows;
        const clientes = (await client.query(
            "SELECT * FROM clientes ORDER BY id"
        )).rows;
        const tareasTotal = Number((await client.query(
            "SELECT COUNT(*) AS total FROM tareas_crm"
        )).rows[0].total);
        const column = (await client.query(`
            SELECT is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'cotizaciones'
              AND column_name = 'etapa_pipeline'
        `)).rows[0];
        const stages = (await client.query(`
            SELECT
                COALESCE(etapa_pipeline, '<EXCLUIDA>') AS etapa,
                COUNT(*) AS cantidad
            FROM cotizaciones
            GROUP BY 1
            ORDER BY 1
        `)).rows.map(row => ({
            etapa: row.etapa,
            cantidad: Number(row.cantidad)
        }));
        const activeCount = Number((await client.query(
            `
            SELECT COUNT(*) AS total
            FROM cotizaciones
            WHERE LOWER(TRIM(COALESCE(estado, ''))) <> ALL($1::text[])
            `,
            [ESTADOS_CIERRE_NEGATIVO]
        )).rows[0].total);
        const excludedCount = Number((await client.query(
            `
            SELECT COUNT(*) AS total
            FROM cotizaciones
            WHERE LOWER(TRIM(COALESCE(estado, ''))) = ANY($1::text[])
            `,
            [ESTADOS_CIERRE_NEGATIVO]
        )).rows[0].total);

        compareBackupRows(
            "cotizaciones",
            backup.tables.cotizaciones,
            cotizaciones
        );
        compareBackupRows("clientes", backup.tables.clientes, clientes);

        assert.strictEqual(cotizaciones.length, 3);
        assert.strictEqual(clientes.length, 3);
        assert.strictEqual(tareasTotal, 0);
        assert.deepStrictEqual(stages, [
            { etapa: "<EXCLUIDA>", cantidad: 1 },
            { etapa: "Nuevos", cantidad: 2 }
        ]);
        assert.strictEqual(activeCount, 2);
        assert.strictEqual(excludedCount, 1);
        assert.strictEqual(column.is_nullable, "YES");
        assert.match(column.column_default || "", /Nuevos/);

        await client.query("ROLLBACK");
        transactionOpen = false;

        console.log(JSON.stringify({
            resultado: "VALIDACION_OK",
            modo: "READ ONLY; finalizado con ROLLBACK",
            cotizaciones_conservadas: cotizaciones.length,
            clientes_conservados: clientes.length,
            tareas_iniciales: tareasTotal,
            pipeline: {
                nuevos_visibles: activeCount,
                excluidas: excludedCount,
                distribucion: stages
            },
            campos_originales_cotizaciones_sin_cambios: true,
            autoras_sin_cambios: true,
            estados_historicos_sin_cambios: true,
            clientes_sin_cambios: true,
            etapa_pipeline_nullable: column.is_nullable === "YES"
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
