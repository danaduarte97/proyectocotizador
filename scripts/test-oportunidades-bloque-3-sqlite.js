#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const testSecret = "oportunidades-bloque-3-test";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function copiarServidor(tempDir) {
    for (const archivo of ["server.js", "db.js"]) {
        fs.copyFileSync(path.join(repoRoot, archivo), path.join(tempDir, archivo));
    }
    fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });
    for (const archivo of ["posventa.js", "oportunidades.js"]) {
        fs.copyFileSync(path.join(repoRoot, "lib", archivo), path.join(tempDir, "lib", archivo));
    }
}

function iniciarServidor(tempDir, port) {
    copiarServidor(tempDir);
    const child = spawn(process.execPath, [path.join(tempDir, "server.js")], {
        cwd: tempDir,
        env: {
            ...process.env,
            DATABASE_URL: "",
            USE_LEGACY_SQLITE_BACKUP: "true",
            SQLITE_DATABASE_PATH: path.join(tempDir, "database.db"),
            JWT_SECRET: testSecret,
            NODE_PATH: path.join(repoRoot, "node_modules"),
            PORT: String(port),
            OPORTUNIDADES_SOMBRA_HABILITADA: "false"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.testOutput = () => output;
    return child;
}

async function esperarServidor(port, child) {
    for (let intento = 0; intento < 100; intento++) {
        if (child.exitCode !== null) throw new Error(child.testOutput());
        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);
            if (response.ok) return;
        } catch (_) {
            // Sigue iniciando.
        }
        await delay(100);
    }
    throw new Error(`El servidor no inició:\n${child.testOutput()}`);
}

function abrirBase(tempDir) {
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
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

function token(usuario, rol = "vendedora") {
    return jwt.sign({ usuario, rol }, testSecret, { expiresIn: "10m" });
}

async function request(port, pathname, authToken, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        ...options,
        headers
    });
    return {
        status: response.status,
        body: await response.json().catch(() => null)
    };
}

async function putJson(port, pathname, authToken, body) {
    return request(port, pathname, authToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

async function crearCotizacion(port, authToken, datos, clienteId = null) {
    const form = new FormData();
    Object.entries({
        nombre: datos.nombre,
        dni: datos.dni,
        celular: datos.celular,
        plan: datos.plan,
        tipo_cobertura: "Individual",
        valor: "100000",
        bonificacion: "0",
        bonificacion_aportes: "0",
        modalidad: "Directo",
        vigencia: "2027-01-31"
    }).forEach(([clave, valor]) => form.set(clave, valor || ""));
    return request(
        port,
        clienteId ? `/clientes/${clienteId}/cotizaciones` : "/agregar",
        authToken,
        { method: "POST", body: form }
    );
}

async function detenerServidor(child) {
    if (child.exitCode !== null) return;
    child.kill();
    await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        delay(2000)
    ]);
}

async function main() {
    const clientScript = fs.readFileSync(path.join(repoRoot, "public", "script.js"), "utf8");
    const styles = fs.readFileSync(path.join(repoRoot, "scss", "style.scss"), "utf8");
    assert.match(clientScript, /function renderControlesDocumentacion/);
    assert.match(clientScript, /function renderControlPreingreso/);
    assert.match(clientScript, /no_requiere/);
    assert.match(styles, /\.pipeline-card-preingreso/);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-bloque-3-"));
    const port = 36500 + Math.floor(Math.random() * 400);
    const server = iniciarServidor(tempDir, port);
    let pruebas = 4;

    try {
        await esperarServidor(port, server);
        const db = abrirBase(tempDir);
        try {
            for (const [usuario, rol] of [
                ["admin_test", "admin"],
                ["asesora_a", "vendedora"],
                ["asesora_b", "vendedora"],
                ["asesora_c", "vendedora"]
            ]) {
                await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, 'x', ?)", [usuario, rol]);
            }
        } finally {
            await close(db);
        }

        const datos = {
            nombre: "Persona Bloque Tres",
            dni: "33444555",
            celular: "11 6111 2233",
            plan: "Plan Uno"
        };
        const primera = await crearCotizacion(port, token("asesora_a"), datos);
        assert.strictEqual(primera.status, 200, JSON.stringify(primera.body)); pruebas++;
        const oportunidadId = primera.body.oportunidad_id;
        const segunda = await crearCotizacion(
            port,
            token("asesora_b"),
            { ...datos, plan: "Plan Dos" },
            primera.body.cliente_id
        );
        assert.strictEqual(segunda.status, 200, JSON.stringify(segunda.body)); pruebas++;
        assert.strictEqual(segunda.body.oportunidad_id, oportunidadId); pruebas++;

        const inicial = await request(port, "/pipeline", token("admin_test", "admin"));
        const oportunidadInicial = inicial.body.flatMap(grupo => grupo.oportunidades)[0];
        assert.strictEqual(oportunidadInicial.pago_estado, "sin_confirmar"); pruebas++;
        assert.strictEqual(oportunidadInicial.clave_fiscal_estado, "sin_confirmar"); pruebas++;
        assert.strictEqual(Number(oportunidadInicial.preingreso_solicitado), 0); pruebas++;

        const aDocumentacion = await putJson(
            port,
            `/oportunidades/${oportunidadId}/etapa`,
            token("asesora_a"),
            { etapa: "Documentación" }
        );
        assert.strictEqual(aDocumentacion.status, 200); pruebas++;

        const pagoAdmin = await putJson(
            port,
            `/oportunidades/${oportunidadId}/documentacion`,
            token("admin_test", "admin"),
            { pago_estado: "pendiente" }
        );
        assert.strictEqual(pagoAdmin.status, 200); pruebas++;
        assert.strictEqual(pagoAdmin.body.clave_fiscal_estado, "sin_confirmar"); pruebas++;

        const pagoRecibido = await putJson(
            port,
            `/oportunidades/${oportunidadId}/documentacion`,
            token("asesora_a"),
            { pago_estado: "recibido" }
        );
        assert.strictEqual(pagoRecibido.status, 200); pruebas++;
        assert.strictEqual(pagoRecibido.body.documentacion_completa, false); pruebas++;

        const claveNoRequiere = await putJson(
            port,
            `/oportunidades/${oportunidadId}/documentacion`,
            token("asesora_b"),
            { clave_fiscal_estado: "no_requiere" }
        );
        assert.strictEqual(claveNoRequiere.status, 200); pruebas++;
        assert.strictEqual(claveNoRequiere.body.pago_estado, "recibido"); pruebas++;
        assert.strictEqual(claveNoRequiere.body.documentacion_completa, true); pruebas++;

        const sigueDocumentacion = await request(port, "/pipeline", token("asesora_a"));
        const oportunidadDocumentacion = sigueDocumentacion.body
            .flatMap(grupo => grupo.oportunidades)[0];
        assert.strictEqual(oportunidadDocumentacion.etapa, "Documentación"); pruebas++;
        assert.strictEqual(oportunidadDocumentacion.clave_fiscal_estado, "no_requiere"); pruebas++;

        const noParticipante = await putJson(
            port,
            `/oportunidades/${oportunidadId}/documentacion`,
            token("asesora_c"),
            { pago_estado: "pendiente" }
        );
        assert.strictEqual(noParticipante.status, 404); pruebas++;

        const valorInvalido = await putJson(
            port,
            `/oportunidades/${oportunidadId}/documentacion`,
            token("asesora_a"),
            { clave_fiscal_estado: "omitida" }
        );
        assert.strictEqual(valorInvalido.status, 400); pruebas++;

        const aAuditoria = await putJson(
            port,
            `/oportunidades/${oportunidadId}/etapa`,
            token("asesora_b"),
            { etapa: "Auditoría" }
        );
        assert.strictEqual(aAuditoria.status, 200); pruebas++;

        const marcar = await putJson(
            port,
            `/oportunidades/${oportunidadId}/preingreso`,
            token("asesora_b"),
            { solicitado: true }
        );
        assert.strictEqual(marcar.status, 200); pruebas++;
        assert.strictEqual(marcar.body.preingreso_solicitado, true); pruebas++;

        const marcarAjena = await putJson(
            port,
            `/oportunidades/${oportunidadId}/preingreso`,
            token("asesora_c"),
            { solicitado: false }
        );
        assert.strictEqual(marcarAjena.status, 404); pruebas++;

        const desmarcarAdmin = await putJson(
            port,
            `/oportunidades/${oportunidadId}/preingreso`,
            token("admin_test", "admin"),
            { solicitado: false }
        );
        assert.strictEqual(desmarcarAdmin.status, 200); pruebas++;

        const remarcar = await putJson(
            port,
            `/oportunidades/${oportunidadId}/preingreso`,
            token("asesora_a"),
            { solicitado: true }
        );
        assert.strictEqual(remarcar.status, 200); pruebas++;

        const baseAntesAfiliados = abrirBase(tempDir);
        let tareasAntes;
        try {
            tareasAntes = Number((await get(baseAntesAfiliados, "SELECT COUNT(*) AS total FROM tareas_crm")).total);
        } finally {
            await close(baseAntesAfiliados);
        }

        const aAfiliados = await putJson(
            port,
            `/oportunidades/${oportunidadId}/etapa`,
            token("asesora_a"),
            { etapa: "Afiliados" }
        );
        assert.strictEqual(aAfiliados.status, 200, JSON.stringify(aAfiliados.body)); pruebas++;
        assert.strictEqual(aAfiliados.body.preingreso_solicitado, false); pruebas++;

        const verificacion = abrirBase(tempDir);
        try {
            const oportunidad = await get(
                verificacion,
                "SELECT * FROM oportunidades_crm WHERE id = ?",
                [oportunidadId]
            );
            assert.strictEqual(oportunidad.etapa, "Afiliados"); pruebas++;
            assert.strictEqual(oportunidad.preingreso_solicitado, 0); pruebas++;
            assert.strictEqual(oportunidad.pago_estado, "recibido"); pruebas++;
            assert.strictEqual(oportunidad.clave_fiscal_estado, "no_requiere"); pruebas++;

            const tareasDespues = Number((await get(
                verificacion,
                "SELECT COUNT(*) AS total FROM tareas_crm"
            )).total);
            assert.strictEqual(tareasDespues, tareasAntes); pruebas++;

            const historial = await all(
                verificacion,
                `SELECT accion, usuario_nombre_snapshot, detalle
                 FROM oportunidad_historial
                 WHERE oportunidad_id = ?
                 ORDER BY id`,
                [oportunidadId]
            );
            const documentacion = historial.filter(item => item.accion === "cambio_documentacion");
            const preingresos = historial.filter(item => item.accion === "cambio_preingreso");
            assert.strictEqual(documentacion.length, 3); pruebas++;
            assert.strictEqual(preingresos.length, 4); pruebas++;
            assert.deepStrictEqual(
                documentacion.map(item => item.usuario_nombre_snapshot),
                ["admin_test", "asesora_a", "asesora_b"]
            ); pruebas++;
            const automatico = JSON.parse(preingresos.at(-1).detalle);
            assert.strictEqual(automatico.motivo, "avance_afiliados"); pruebas++;
            assert.strictEqual(automatico.anterior, true); pruebas++;
            assert.strictEqual(automatico.nuevo, false); pruebas++;
        } finally {
            await close(verificacion);
        }

        const marcarFueraAuditoria = await putJson(
            port,
            `/oportunidades/${oportunidadId}/preingreso`,
            token("asesora_a"),
            { solicitado: true }
        );
        assert.strictEqual(marcarFueraAuditoria.status, 409); pruebas++;

        console.log(JSON.stringify({
            resultado: "OK",
            entorno: "SQLite temporal aislado con datos ficticios",
            pruebas
        }, null, 2));
    } finally {
        await detenerServidor(server);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
