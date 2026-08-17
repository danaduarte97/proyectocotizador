#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const {
    calcularSeguimientoPosventa,
    sumarMesesCalendario
} = require("../lib/posventa");

const repoRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-posventa-"));
const port = 34000 + Math.floor(Math.random() * 1000);
const testSecret = "posventa-afiliaciones-test";

fs.copyFileSync(path.join(repoRoot, "server.js"), path.join(tempDir, "server.js"));
fs.copyFileSync(path.join(repoRoot, "db.js"), path.join(tempDir, "db.js"));
fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });
fs.copyFileSync(
    path.join(repoRoot, "lib", "posventa.js"),
    path.join(tempDir, "lib", "posventa.js")
);

const server = spawn(
    process.execPath,
    [path.join(tempDir, "server.js")],
    {
        cwd: tempDir,
        env: {
            ...process.env,
            DATABASE_URL: "",
            USE_LEGACY_SQLITE_BACKUP: "true",
            JWT_SECRET: testSecret,
            NODE_PATH: path.join(repoRoot, "node_modules"),
            PORT: String(port)
        },
        stdio: ["ignore", "pipe", "pipe"]
    }
);
let serverOutput = "";

server.stdout.on("data", chunk => {
    serverOutput += chunk.toString();
});
server.stderr.on("data", chunk => {
    serverOutput += chunk.toString();
});

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function openDatabase() {
    return new sqlite3.Database(path.join(tempDir, "database.db"));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) reject(error);
            else resolve(row);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows);
        });
    });
}

function close(db) {
    return new Promise((resolve, reject) => {
        db.close(error => error ? reject(error) : resolve());
    });
}

function token(usuario, rol) {
    return jwt.sign({ usuario, rol }, testSecret, { expiresIn: "10m" });
}

async function request(pathname, authToken, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const body = await response.json().catch(() => null);

    return { status: response.status, body };
}

async function waitForServer() {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (server.exitCode !== null) {
            throw new Error(`El servidor temporal terminó antes de iniciar:\n${serverOutput}`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);
            if (response.ok) return;
        } catch {
            // Sigue esperando el arranque de SQLite.
        }

        await delay(150);
    }

    throw new Error(`Timeout al iniciar el servidor temporal:\n${serverOutput}`);
}

async function crearClienteYCotizacion(db, {
    dni,
    nombre,
    vendedora,
    etapa = "Nuevos",
    estado = etapa === "Afiliados" ? "Afiliado" : "Nuevo"
}) {
    const clienteId = (await run(
        db,
        `
        INSERT INTO clientes
        (identidad_tipo, identidad_valor, dni, dni_normalizado, nombre, etapa_comercial)
        VALUES ('dni', ?, ?, ?, ?, 'Nuevo')
        `,
        [dni, dni, dni, nombre]
    )).lastID;
    const cotizacionId = (await run(
        db,
        `
        INSERT INTO cotizaciones
        (
            cliente_id,
            dni,
            nombre,
            celular,
            plan,
            valor,
            vendedora,
            estado,
            etapa_pipeline
        )
        VALUES (?, ?, ?, ?, 'Plan prueba', '100', ?, ?, ?)
        `,
        [clienteId, dni, nombre, "1134419684", vendedora, estado, etapa]
    )).lastID;

    return { clienteId, cotizacionId };
}

async function main() {
    assert.deepStrictEqual(
        calcularSeguimientoPosventa(
            "2026-07-31",
            "en_seguimiento",
            "2026-07-31"
        ),
        {
            mes_numero: 1,
            mes_texto: "Primer mes",
            color: "normal",
            seguimiento_cerrado: false
        }
    );
    assert.strictEqual(
        calcularSeguimientoPosventa(
            "2026-07-01",
            "en_seguimiento",
            "2026-08-01"
        ).color,
        "amarillo"
    );
    assert.strictEqual(
        calcularSeguimientoPosventa(
            "2026-07-15",
            "en_seguimiento",
            "2026-09-01"
        ).color,
        "rojo"
    );

    await waitForServer();
    await delay(350);

    const db = openDatabase();
    let propia;
    let ajena;
    let existente;
    let porSeguimiento;
    let cierreNegativo;
    let incoherente;

    try {
        await run(
            db,
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, 'test', 'vendedora')",
            ["vendedora_a"]
        );
        await run(
            db,
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, 'test', 'vendedora')",
            ["vendedora_b"]
        );
        propia = await crearClienteYCotizacion(db, {
            dni: "20000001",
            nombre: "Afiliada Propia",
            vendedora: "vendedora_a"
        });
        ajena = await crearClienteYCotizacion(db, {
            dni: "20000002",
            nombre: "Afiliada Ajena",
            vendedora: "vendedora_b"
        });
        existente = await crearClienteYCotizacion(db, {
            dni: "20000003",
            nombre: "Afiliada Existente",
            vendedora: "vendedora_a",
            etapa: "Afiliados"
        });
        porSeguimiento = await crearClienteYCotizacion(db, {
            dni: "20000004",
            nombre: "Afiliada por Seguimiento",
            vendedora: "vendedora_a"
        });
        cierreNegativo = await crearClienteYCotizacion(db, {
            dni: "20000005",
            nombre: "Cierre Negativo",
            vendedora: "vendedora_a",
            etapa: "Interesados"
        });
        incoherente = await crearClienteYCotizacion(db, {
            dni: "20000006",
            nombre: "Afiliación Incoherente",
            vendedora: "vendedora_a",
            estado: "Afiliado",
            etapa: "Nuevos"
        });
    } finally {
        await close(db);
    }

    const sellerToken = token("vendedora_a", "vendedora");
    const adminToken = token("admin", "admin");

    const dbInicial = openDatabase();
    try {
        const cotizacionInicial = await get(
            dbInicial,
            "SELECT estado, etapa_pipeline, fecha_alta, estado_posventa FROM cotizaciones WHERE id = ?",
            [propia.cotizacionId]
        );
        assert.deepStrictEqual(cotizacionInicial, {
            estado: "Nuevo",
            etapa_pipeline: "Nuevos",
            fecha_alta: null,
            estado_posventa: null
        });
    } finally {
        await close(dbInicial);
    }

    const altaPropia = await request(
        `/cotizaciones/${propia.cotizacionId}/etapa-pipeline`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Afiliados" })
        }
    );
    assert.strictEqual(altaPropia.status, 200);
    assert.strictEqual(altaPropia.body.fecha_alta, null);
    assert.strictEqual(altaPropia.body.estado, "Afiliado");
    assert.strictEqual(altaPropia.body.etapa_pipeline, "Afiliados");
    assert.strictEqual(altaPropia.body.estado_posventa, null);
    assert.strictEqual(altaPropia.body.requiere_fecha_alta, true);

    const altaPorSeguimiento = await request(
        `/cotizaciones/${porSeguimiento.cotizacionId}/seguimiento`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Afiliado", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(altaPorSeguimiento.status, 200);
    assert.strictEqual(altaPorSeguimiento.body.estado, "Afiliado");
    assert.strictEqual(altaPorSeguimiento.body.etapa_pipeline, "Afiliados");
    assert.strictEqual(altaPorSeguimiento.body.fecha_alta, null);
    assert.strictEqual(altaPorSeguimiento.body.estado_posventa, null);
    assert.strictEqual(altaPorSeguimiento.body.requiere_fecha_alta, true);

    const confirmarAltaSeguimiento = await request(
        `/cotizaciones/${porSeguimiento.cotizacionId}/posventa`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ fecha_alta: "2026-07-22" })
        }
    );
    assert.strictEqual(confirmarAltaSeguimiento.status, 200);
    assert.strictEqual(confirmarAltaSeguimiento.body.estado_posventa, "en_seguimiento");

    const repetirAltaSeguimiento = await request(
        `/cotizaciones/${porSeguimiento.cotizacionId}/seguimiento`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Afiliado", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(repetirAltaSeguimiento.status, 200);
    assert.strictEqual(repetirAltaSeguimiento.body.fecha_alta, "2026-07-22");

    const cierrePorSeguimiento = await request(
        `/cotizaciones/${cierreNegativo.cotizacionId}/seguimiento`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Perdido", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(cierrePorSeguimiento.status, 200);
    assert.strictEqual(cierrePorSeguimiento.body.estado, "Perdido");
    assert.strictEqual(cierrePorSeguimiento.body.etapa_pipeline, null);

    const detalleIncoherente = await request(
        `/cotizaciones/${incoherente.cotizacionId}/posventa`,
        sellerToken
    );
    assert.strictEqual(detalleIncoherente.status, 200);
    assert.strictEqual(detalleIncoherente.body.aplica, false);

    const altaIncoherente = await request(
        `/cotizaciones/${incoherente.cotizacionId}/posventa`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ fecha_alta: "2026-07-23" })
        }
    );
    assert.strictEqual(altaIncoherente.status, 400);

    const detalleSinFecha = await request(
        `/cotizaciones/${propia.cotizacionId}/posventa`,
        sellerToken
    );
    assert.strictEqual(detalleSinFecha.status, 200);
    assert.strictEqual(detalleSinFecha.body.aplica, true);
    assert.strictEqual(detalleSinFecha.body.requiere_fecha_alta, true);
    assert.strictEqual(detalleSinFecha.body.fecha_alta, null);
    assert.strictEqual(detalleSinFecha.body.proxima_tarea, null);

    const confirmarAltaPropia = await request(
        `/cotizaciones/${propia.cotizacionId}/posventa`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ fecha_alta: "2026-07-20" })
        }
    );
    assert.strictEqual(confirmarAltaPropia.status, 200);
    assert.strictEqual(confirmarAltaPropia.body.fecha_alta, "2026-07-20");
    assert.strictEqual(confirmarAltaPropia.body.estado_posventa, "en_seguimiento");
    assert.strictEqual(confirmarAltaPropia.body.requiere_fecha_alta, false);

    const repetirAlta = await request(
        `/cotizaciones/${propia.cotizacionId}/etapa-pipeline`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Afiliados" })
        }
    );
    assert.strictEqual(repetirAlta.status, 200);
    assert.strictEqual(
        repetirAlta.body.fecha_alta,
        confirmarAltaPropia.body.fecha_alta
    );

    const salirAfiliados = await request(
        `/cotizaciones/${propia.cotizacionId}/etapa-pipeline`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Auditoría" })
        }
    );
    assert.strictEqual(salirAfiliados.status, 200);
    assert.strictEqual(salirAfiliados.body.estado, "Nuevo");
    assert.strictEqual(salirAfiliados.body.etapa_pipeline, "Auditoría");

    const regresarAfiliados = await request(
        `/cotizaciones/${propia.cotizacionId}/etapa-pipeline`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Afiliados" })
        }
    );
    assert.strictEqual(regresarAfiliados.status, 200);
    assert.strictEqual(regresarAfiliados.body.estado, "Afiliado");
    assert.strictEqual(regresarAfiliados.body.etapa_pipeline, "Afiliados");
    assert.strictEqual(
        regresarAfiliados.body.fecha_alta,
        confirmarAltaPropia.body.fecha_alta
    );

    const moverAjena = await request(
        `/cotizaciones/${ajena.cotizacionId}/etapa-pipeline`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Afiliados" })
        }
    );
    assert.strictEqual(moverAjena.status, 403);

    const seguimientoAjeno = await request(
        `/cotizaciones/${ajena.cotizacionId}/seguimiento`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Afiliado", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(seguimientoAjeno.status, 403);

    const altaAjenaAdmin = await request(
        `/cotizaciones/${ajena.cotizacionId}/etapa-pipeline`,
        adminToken,
        {
            method: "PUT",
            body: JSON.stringify({ etapa_pipeline: "Afiliados" })
        }
    );
    assert.strictEqual(altaAjenaAdmin.status, 200);
    assert.strictEqual(altaAjenaAdmin.body.requiere_fecha_alta, true);

    const confirmarAltaAjena = await request(
        `/cotizaciones/${ajena.cotizacionId}/posventa`,
        adminToken,
        {
            method: "PUT",
            body: JSON.stringify({ fecha_alta: "2026-07-21" })
        }
    );
    assert.strictEqual(confirmarAltaAjena.status, 200);

    const leerAjena = await request(
        `/cotizaciones/${ajena.cotizacionId}/posventa`,
        sellerToken
    );
    assert.strictEqual(leerAjena.status, 403);

    const moraAjena = await request(
        `/cotizaciones/${ajena.cotizacionId}/posventa`,
        adminToken,
        {
            method: "PUT",
            body: JSON.stringify({
                fecha_alta: confirmarAltaAjena.body.fecha_alta,
                estado_posventa: "pendiente_mora"
            })
        }
    );
    assert.strictEqual(moraAjena.status, 200);
    assert.strictEqual(moraAjena.body.color, "rojo");

    const bajaAjena = await request(
        `/cotizaciones/${ajena.cotizacionId}/posventa`,
        adminToken,
        {
            method: "PUT",
            body: JSON.stringify({
                fecha_alta: confirmarAltaAjena.body.fecha_alta,
                estado_posventa: "baja_mora"
            })
        }
    );
    assert.strictEqual(bajaAjena.status, 200);
    assert.strictEqual(bajaAjena.body.color, "baja-mora");
    assert.strictEqual(bajaAjena.body.seguimiento_cerrado, true);

    const fechaManual = await request(
        `/cotizaciones/${existente.cotizacionId}/posventa`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({
                fecha_alta: "2026-07-18",
                estado_posventa: "en_seguimiento"
            })
        }
    );
    assert.strictEqual(fechaManual.status, 200);
    assert.strictEqual(fechaManual.body.fecha_alta, "2026-07-18");

    const pagoCompleto = await request(
        `/cotizaciones/${existente.cotizacionId}/posventa`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({
                fecha_alta: "2026-07-18",
                estado_posventa: "pago_3_meses"
            })
        }
    );
    assert.strictEqual(pagoCompleto.status, 200);
    assert.strictEqual(pagoCompleto.body.color, "verde");

    const verificar = openDatabase();

    try {
        const cotizacion = await get(
            verificar,
            `
            SELECT
                fecha_alta,
                estado_posventa,
                etapa_pipeline,
                estado,
                vendedora
            FROM cotizaciones
            WHERE id = ?
            `,
            [propia.cotizacionId]
        );
        const tareasPropias = await all(
            verificar,
            `
            SELECT
                titulo,
                fecha,
                estado,
                usuario_responsable,
                cotizacion_id,
                cliente_id,
                clave_automatica
            FROM tareas_crm
            WHERE cotizacion_id = ?
            ORDER BY fecha
            `,
            [propia.cotizacionId]
        );
        const historialPropia = await all(
            verificar,
            `
            SELECT estado_anterior, estado_nuevo
            FROM cotizaciones_posventa_historial
            WHERE cotizacion_id = ?
            ORDER BY id
            `,
            [propia.cotizacionId]
        );
        const cotizacionSeguimiento = await get(
            verificar,
            `
            SELECT estado, etapa_pipeline, fecha_alta, estado_posventa
            FROM cotizaciones
            WHERE id = ?
            `,
            [porSeguimiento.cotizacionId]
        );
        const tareasSeguimiento = await all(
            verificar,
            `
            SELECT clave_automatica
            FROM tareas_crm
            WHERE cotizacion_id = ?
              AND clave_automatica IS NOT NULL
            ORDER BY clave_automatica
            `,
            [porSeguimiento.cotizacionId]
        );
        const historialSeguimiento = await all(
            verificar,
            `
            SELECT estado_anterior, estado_nuevo
            FROM cotizaciones_posventa_historial
            WHERE cotizacion_id = ?
            ORDER BY id
            `,
            [porSeguimiento.cotizacionId]
        );
        const cotizacionCerrada = await get(
            verificar,
            "SELECT estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [cierreNegativo.cotizacionId]
        );
        const tareasExistente = await all(
            verificar,
            `
            SELECT estado, clave_automatica
            FROM tareas_crm
            WHERE cotizacion_id = ?
            ORDER BY clave_automatica
            `,
            [existente.cotizacionId]
        );
        const historial = await all(
            verificar,
            `
            SELECT estado_anterior, estado_nuevo, usuario
            FROM cotizaciones_posventa_historial
            WHERE cotizacion_id = ?
            ORDER BY id
            `,
            [existente.cotizacionId]
        );
        const tareasAjena = await all(
            verificar,
            `
            SELECT estado
            FROM tareas_crm
            WHERE cotizacion_id = ?
              AND clave_automatica IS NOT NULL
            `,
            [ajena.cotizacionId]
        );

        assert.strictEqual(
            cotizacion.fecha_alta,
            confirmarAltaPropia.body.fecha_alta
        );
        assert.strictEqual(cotizacion.estado_posventa, "en_seguimiento");
        assert.strictEqual(cotizacion.etapa_pipeline, "Afiliados");
        assert.strictEqual(cotizacion.estado, "Afiliado");
        assert.strictEqual(cotizacion.vendedora, "vendedora_a");

        assert.strictEqual(tareasPropias.length, 2);
        assert.deepStrictEqual(
            tareasPropias.map(tarea => tarea.clave_automatica),
            ["posventa_segunda_cuota", "posventa_tercera_cuota"]
        );
        assert.deepStrictEqual(
            tareasPropias.map(tarea => tarea.fecha),
            [
                sumarMesesCalendario(confirmarAltaPropia.body.fecha_alta, 1),
                sumarMesesCalendario(confirmarAltaPropia.body.fecha_alta, 2)
            ]
        );
        assert.deepStrictEqual(
            tareasPropias.map(tarea => tarea.titulo),
            [
                "Verificar segunda cuota de Afiliada Propia",
                "Confirmar pago de las 3 cuotas de Afiliada Propia"
            ]
        );
        assert.ok(tareasPropias.every(tarea =>
            tarea.usuario_responsable === "vendedora_a"
            && String(tarea.cotizacion_id) === String(propia.cotizacionId)
            && String(tarea.cliente_id) === String(propia.clienteId)
        ));
        assert.deepStrictEqual(
            historialPropia.map(item => item.estado_nuevo),
            ["en_seguimiento"]
        );
        assert.deepStrictEqual(cotizacionSeguimiento, {
            estado: "Afiliado",
            etapa_pipeline: "Afiliados",
            fecha_alta: "2026-07-22",
            estado_posventa: "en_seguimiento"
        });
        assert.deepStrictEqual(
            tareasSeguimiento.map(tarea => tarea.clave_automatica),
            ["posventa_segunda_cuota", "posventa_tercera_cuota"]
        );
        assert.deepStrictEqual(
            historialSeguimiento.map(item => item.estado_nuevo),
            ["en_seguimiento"]
        );
        assert.deepStrictEqual(cotizacionCerrada, {
            estado: "Perdido",
            etapa_pipeline: null
        });
        assert.deepStrictEqual(
            tareasExistente.map(tarea => tarea.estado),
            ["realizada", "realizada"]
        );
        assert.deepStrictEqual(
            historial.map(item => item.estado_nuevo),
            ["en_seguimiento", "pago_3_meses"]
        );
        assert.ok(historial.every(item => item.usuario === "vendedora_a"));
        assert.deepStrictEqual(
            tareasAjena.map(tarea => tarea.estado),
            ["cancelada", "cancelada"]
        );
    } finally {
        await close(verificar);
    }

    const tareasVendedora = await request("/tareas", sellerToken);
    const tareasAdmin = await request("/tareas", adminToken);

    assert.strictEqual(tareasVendedora.status, 200);
    assert.ok(tareasVendedora.body.every(
        tarea => tarea.usuario_responsable === "vendedora_a"
    ));
    assert.strictEqual(tareasAdmin.status, 200);
    assert.ok(tareasAdmin.body.some(
        tarea => tarea.usuario_responsable === "vendedora_b"
    ));

    console.log(JSON.stringify({
        resultado: "OK",
        entorno: "SQLite temporal",
        pruebas: [
            "julio conserva color normal",
            "agosto cambia a amarillo",
            "septiembre cambia a rojo",
            "Afiliados sin fecha devuelve estado pendiente válido",
            "el movimiento no asigna una fecha automáticamente",
            "seguimiento tradicional sincroniza Afiliado y Afiliados",
            "pipeline sincroniza Afiliados y Afiliado",
            "la fecha confirmada no se reemplaza",
            "repetir afiliación no duplica tareas ni historial",
            "salir de Afiliados restablece un estado tradicional compatible",
            "fecha de alta manual para afiliaciones existentes",
            "dos tareas automáticas vinculadas sin duplicados",
            "Pagó 3 meses completa las tareas pendientes",
            "Pendiente por mora usa rojo",
            "Baja por mora cierra y cancela tareas pendientes",
            "historial conserva usuario y cambios",
            "cierres negativos limpian la etapa del pipeline",
            "Posventa no inicia con una afiliación incoherente",
            "vendedora no administra posventa ajena",
            "administradora puede administrar cualquier afiliación",
            "visibilidad de tareas respeta responsable"
        ]
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error.stack || error.message);
        if (serverOutput) console.error(serverOutput);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (server.exitCode === null) {
            server.kill();
            await Promise.race([
                new Promise(resolve => server.once("exit", resolve)),
                delay(2000)
            ]);
        }
    });
