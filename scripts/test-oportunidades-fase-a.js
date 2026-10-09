#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    etapaOportunidadDesdeLegacy,
    resolverEtapa,
    simularOportunidades
} = require("../lib/oportunidades");

function cotizacion(id, clienteId, fecha, vendedora, etapa, estado = "Nuevo") {
    return {
        id,
        cliente_id: clienteId,
        fecha,
        vendedora,
        etapa_pipeline: etapa,
        estado
    };
}

assert.strictEqual(etapaOportunidadDesdeLegacy("Nuevos"), "Inicio");
assert.strictEqual(etapaOportunidadDesdeLegacy("Contactados"), "Inicio");
assert.strictEqual(etapaOportunidadDesdeLegacy("Auditoría"), "Auditoría");

const inicioUnificado = resolverEtapa([
    cotizacion(1, 10, "2026-01-01T10:00:00Z", "Ana", "Nuevos"),
    cotizacion(2, 10, "2026-01-02T10:00:00Z", "Ana", "Contactados")
]);
assert.strictEqual(inicioUnificado.etapa, "Inicio");
assert.strictEqual(inicioUnificado.requiere_revision_etapa, false);
assert.strictEqual(inicioUnificado.criterio, "unificacion_inicio");

const resultado = simularOportunidades({
    usuarios: [
        { id: 1, usuario: "Ana", rol: "vendedora" },
        { id: 2, usuario: "Bea", rol: "vendedora" }
    ],
    cotizaciones: [
        cotizacion(1, 10, "2026-01-01T10:00:00Z", "Ana", "Nuevos"),
        cotizacion(2, 10, "2026-01-02T10:00:00Z", "Bea", "Auditoría"),
        cotizacion(3, 20, "2026-02-01T10:00:00Z", "Bea", "Interesados", "Perdido"),
        cotizacion(4, null, "2026-03-01T10:00:00Z", "Ana", "Nuevos")
    ],
    identidadesPrimerContacto: [
        {
            id: 100,
            cliente_id: 10,
            procedencia_id: 7,
            procedencia_codigo: "referido",
            procedencia_nombre: "Referido",
            fecha_creacion: "2026-01-03T10:00:00Z"
        }
    ]
});

assert.strictEqual(resultado.resumen.oportunidades_esperadas, 2);
assert.strictEqual(resultado.resumen.oportunidades_activas, 1);
assert.strictEqual(resultado.resumen.oportunidades_cerradas, 1);
assert.strictEqual(resultado.resumen.cotizaciones_sin_cliente, 1);
assert.strictEqual(resultado.resumen.oportunidades_multi_cotizacion, 1);
assert.strictEqual(resultado.resumen.oportunidades_multi_asesora, 1);
assert.strictEqual(resultado.resumen.procedencias_retrospectivas, 1);

const compartida = resultado.oportunidades.find(item => item.cliente_id === "10");
assert.strictEqual(compartida.etapa, "Auditoría");
assert.strictEqual(compartida.responsable, "Ana");
assert.strictEqual(String(compartida.responsable_usuario_id), "1");
assert.deepStrictEqual(
    compartida.participantes.map(item => item.asesora),
    ["Ana", "Bea"]
);
assert.strictEqual(compartida.procedencia.atribucion, "retrospectiva");
assert.strictEqual(compartida.resolucion_etapa.criterio, "etapa_mas_avanzada");
assert.strictEqual(compartida.conflictos.includes("etapas_normalizadas_distintas"), false);

const cerrada = resultado.oportunidades.find(item => item.cliente_id === "20");
assert.strictEqual(cerrada.estado, "cerrada_perdida");
assert.strictEqual(cerrada.etapa, "Interesados");

const ambigua = simularOportunidades({
    cotizaciones: [
        cotizacion(5, 30, "2026-04-01T10:00:00Z", "Asesora histórica", "Nuevos")
    ],
    identidadesPrimerContacto: [
        { id: 200, cliente_id: 30, procedencia_id: 1 },
        { id: 201, cliente_id: 30, procedencia_id: 2 }
    ]
});
assert.strictEqual(
    ambigua.oportunidades[0].procedencia.motivo,
    "multiples_identidades_directas"
);
assert.strictEqual(ambigua.oportunidades[0].procedencia.procedencia_id, null);
assert.strictEqual(
    ambigua.oportunidades[0].conflictos.includes("multiples_identidades_directas"),
    true
);
assert.strictEqual(ambigua.oportunidades[0].responsable, "Asesora histórica");
assert.strictEqual(ambigua.oportunidades[0].responsable_usuario_id, null);

const etapaDesconocida = resolverEtapa([
    cotizacion(6, 40, "2026-04-02T10:00:00Z", "Ana", "Etapa antigua")
]);
assert.strictEqual(etapaDesconocida.requiere_revision_etapa, true);
assert.deepStrictEqual(etapaDesconocida.etapas_no_reconocidas, ["Etapa antigua"]);

const repoRoot = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
    path.join(repoRoot, "sql", "20261008_oportunidades_fase_a.postgres.sql"),
    "utf8"
);
const backfill = fs.readFileSync(
    path.join(repoRoot, "sql", "20261008_oportunidades_fase_a_backfill.postgres.sql"),
    "utf8"
);
const rollback = fs.readFileSync(
    path.join(repoRoot, "sql", "20261008_oportunidades_fase_a_rollback.postgres.sql"),
    "utf8"
);

for (const tabla of [
    "oportunidades_crm",
    "oportunidad_asesoras",
    "oportunidad_historial"
]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tabla}`));
}
assert.match(migration, /ADD COLUMN IF NOT EXISTS oportunidad_id BIGINT/);
assert.match(migration, /WHERE estado = 'activa'/);
assert.match(backfill, /Backfill bloqueado: existen cotizaciones sin cliente_id/);
assert.match(backfill, /Backfill bloqueado: existen etapas históricas no reconocidas/);
assert.doesNotMatch(backfill, /DELETE\s+FROM/i);
assert.match(rollback, /Rollback bloqueado: existen datos creados o modificados/);

console.log(JSON.stringify({
    resultado: "OK",
    pruebas: [
        "Nuevos y Contactados se unifican como Inicio",
        "la etapa más avanzada se selecciona sin alterar cotizaciones",
        "una persona con varias cotizaciones produce una oportunidad",
        "la primera asesora queda como responsable",
        "todas las asesoras quedan como participantes",
        "los cierres negativos producen oportunidades históricas cerradas",
        "las cotizaciones sin cliente quedan pendientes de revisión",
        "la procedencia directa posterior queda marcada como retrospectiva",
        "múltiples identidades directas no atribuyen procedencia",
        "una asesora histórica se conserva aunque no exista como usuario",
        "etapas válidas diferentes usan la más avanzada sin quedar ambiguas",
        "una etapa histórica desconocida bloquea el backfill para revisión",
        "la migración es aditiva y el backfill posee guardas de seguridad",
        "la reversión se bloquea después de actividad real"
    ]
}, null, 2));
