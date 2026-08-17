#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const BASE_URL = "http://127.0.0.1:3000";
const SECRET = process.env.JWT_SECRET || "secreto_ultra_seguro";
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

function token(user) {
    return jwt.sign(
        { usuario: user.usuario, rol: user.rol },
        SECRET,
        { expiresIn: "10m" }
    );
}

async function request(pathname, authToken, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...(options.headers || {})
        }
    });
    const body = await response.json().catch(() => null);

    return { status: response.status, body };
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

    try {
        const admin = (await pool.query(`
            SELECT usuario, rol
            FROM usuarios
            WHERE rol = 'admin'
            ORDER BY id
            LIMIT 1
        `)).rows[0];
        const seller = (await pool.query(`
            SELECT DISTINCT u.usuario, u.rol
            FROM usuarios u
            JOIN cotizaciones c
              ON LOWER(TRIM(c.vendedora)) = LOWER(TRIM(u.usuario))
            WHERE u.rol <> 'admin'
            ORDER BY u.usuario
            LIMIT 1
        `)).rows[0];
        const sellers = (await pool.query(`
            SELECT usuario, rol
            FROM usuarios
            WHERE rol <> 'admin'
            ORDER BY usuario
        `)).rows;

        assert.ok(admin, "No hay usuario administrador");
        assert.ok(seller, "No hay vendedora relacionada con cotizaciones");

        const activeRows = (await pool.query(
            `
            SELECT id, vendedora, etapa_pipeline
            FROM cotizaciones
            WHERE LOWER(TRIM(COALESCE(estado, ''))) <> ALL($1::text[])
            ORDER BY id
            `,
            [ESTADOS_CIERRE_NEGATIVO]
        )).rows;
        const storedAuthors = (await pool.query(`
            SELECT id, vendedora
            FROM cotizaciones
            ORDER BY id
        `)).rows;
        const storedTasks = Number((await pool.query(
            "SELECT COUNT(*) AS total FROM tareas_crm"
        )).rows[0].total);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
            .toISOString().slice(0, 10);
        const monthlyQuotes = Number((await pool.query(
            `
            SELECT COUNT(*) AS total
            FROM cotizaciones
            WHERE fecha::date >= $1::date
              AND fecha::date < $2::date
            `,
            [monthStart, monthEnd]
        )).rows[0].total);
        const sellerExpected = activeRows.filter(
            row => row.vendedora === seller.usuario
        );
        const sellerTaskCount = Number((await pool.query(
            `
            SELECT COUNT(*) AS total
            FROM tareas_crm
            WHERE usuario_responsable = $1
            `,
            [seller.usuario]
        )).rows[0].total);
        const guardSeller = sellers.find(user =>
            activeRows.some(row => row.vendedora !== user.usuario)
        ) || seller;
        const foreign = (await pool.query(
            `
            SELECT id
            FROM cotizaciones
            WHERE vendedora <> $1
            ORDER BY id
            LIMIT 1
            `,
            [guardSeller.usuario]
        )).rows[0];
        const adminToken = token(admin);
        const sellerToken = token(seller);
        const adminSummary = await request("/inicio/resumen", adminToken);
        const adminQuotes = await request("/mis-cotizaciones", adminToken);

        assert.strictEqual(adminSummary.status, 200);
        assert.strictEqual(adminQuotes.status, 200);
        assert.strictEqual(
            adminSummary.body.estadisticas.cotizaciones_mes,
            monthlyQuotes
        );
        assert.strictEqual(adminSummary.body.pipeline.length, 6);
        assert.deepStrictEqual(
            adminSummary.body.pipeline
                .flatMap(column => column.cotizaciones)
                .map(item => String(item.id))
                .sort(),
            activeRows.map(item => String(item.id)).sort()
        );
        assert.strictEqual(adminSummary.body.tareas.length, storedTasks);
        assert.deepStrictEqual(
            adminQuotes.body.map(item => ({
                id: String(item.id),
                vendedora: item.vendedora
            })).sort((a, b) => a.id.localeCompare(b.id)),
            storedAuthors.map(item => ({
                id: String(item.id),
                vendedora: item.vendedora
            })).sort((a, b) => a.id.localeCompare(b.id))
        );

        const frontendSource = fs.readFileSync(
            path.resolve(__dirname, "..", "public", "script.js"),
            "utf8"
        );
        assert.match(
            frontendSource,
            /Asesora comercial:<\/b> \$\{c\.vendedora\}/
        );
        assert.match(
            frontendSource,
            /card\.querySelectorAll\("\.solo-pdf"\)/
        );

        const sellerPipeline = await request("/pipeline", sellerToken);
        assert.strictEqual(sellerPipeline.status, 200);
        assert.deepStrictEqual(
            sellerPipeline.body
                .flatMap(column => column.cotizaciones)
                .map(item => String(item.id))
                .sort(),
            sellerExpected.map(item => String(item.id)).sort()
        );

        const sellerTasks = await request("/tareas", sellerToken);
        assert.strictEqual(sellerTasks.status, 200);
        assert.strictEqual(sellerTasks.body.length, sellerTaskCount);

        const month = new Date().toISOString().slice(0, 7);
        const calendar = await request(`/calendario?mes=${month}`, sellerToken);
        assert.strictEqual(calendar.status, 200);
        assert.ok(calendar.body.dias && typeof calendar.body.dias === "object");

        if (foreign) {
            const forbiddenMove = await request(
                `/cotizaciones/${foreign.id}/etapa-pipeline`,
                token(guardSeller),
                {
                    method: "PUT",
                    body: JSON.stringify({ etapa_pipeline: "Contactados" })
                }
            );
            assert.strictEqual(forbiddenMove.status, 403);
        }

        console.log(JSON.stringify({
            resultado: "API_READONLY_OK",
            administradora: {
                resumen_status: adminSummary.status,
                cotizaciones_mes: adminSummary.body.estadisticas.cotizaciones_mes,
                oportunidades_visibles: activeRows.length,
                etapas_renderizadas: adminSummary.body.pipeline.length,
                tareas: adminSummary.body.tareas.length,
                autoras_pdf_coinciden_con_base: true
            },
            vendedora: {
                pipeline_status: sellerPipeline.status,
                oportunidades_propias_visibles: sellerExpected.length,
                oportunidades_ajenas_visibles: 0,
                modificacion_ajena_bloqueada: Boolean(foreign),
                tareas: sellerTasks.body.length,
                calendario_status: calendar.status
            }
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
