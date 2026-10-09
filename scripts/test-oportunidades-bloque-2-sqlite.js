#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const testSecret = "oportunidades-bloque-2-test";

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

function tokenVencido(usuario, rol = "vendedora") {
    return jwt.sign({ usuario, rol }, testSecret, { expiresIn: -1 });
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

async function crearCotizacion(port, authToken, datos, clienteId = null) {
    const form = new FormData();
    Object.entries({
        nombre: datos.nombre,
        dni: datos.dni,
        celular: datos.celular,
        plan: datos.plan || "Plan prueba",
        tipo_cobertura: "Individual",
        valor: "100000",
        bonificacion: "0",
        bonificacion_aportes: "0",
        modalidad: "Directo",
        vigencia: "2026-12-31"
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
    const appHtml = fs.readFileSync(path.join(repoRoot, "public", "app.html"), "utf8");
    const clientScript = fs.readFileSync(path.join(repoRoot, "public", "script.js"), "utf8");

    assert.match(appHtml, /<span>Buscar<\/span>/);
    assert.match(appHtml, /id="inicioAgendaModal"/);
    assert.match(appHtml, /abrirAgendaInicio\(this\)/);
    assert.match(clientScript, /function copiarTelefonoPipeline\(boton\)/);
    assert.match(clientScript, /class="pipeline-copiar-telefono"/);
    assert.doesNotMatch(clientScript, /function renderTelefonoWhatsappPipeline/);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-bloque-2-"));
    const port = 36000 + Math.floor(Math.random() * 500);
    const server = iniciarServidor(tempDir, port);

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
            nombre: "José Núñez",
            dni: "30111222",
            celular: "+54 9 11 5555-1234",
            plan: "Plan Uno"
        };
        const primera = await crearCotizacion(port, token("asesora_a"), datos);
        assert.strictEqual(primera.status, 200, JSON.stringify(primera.body));
        assert.ok(primera.body.oportunidad_id);

        const segunda = await crearCotizacion(
            port,
            token("asesora_b"),
            { ...datos, plan: "Plan Dos", celular: "011 15 5555 1234" },
            primera.body.cliente_id
        );
        assert.strictEqual(segunda.status, 200, JSON.stringify(segunda.body));
        assert.strictEqual(segunda.body.oportunidad_id, primera.body.oportunidad_id);

        const admin = await request(port, "/pipeline", token("admin_test", "admin"));
        assert.strictEqual(admin.status, 200);
        const oportunidades = admin.body.flatMap(grupo => grupo.oportunidades);
        assert.strictEqual(oportunidades.length, 1);
        assert.strictEqual(oportunidades[0].cantidad_cotizaciones, 2);
        assert.strictEqual(oportunidades[0].responsable, "asesora_a");
        assert.deepStrictEqual(
            oportunidades[0].participantes.map(item => item.nombre),
            ["asesora_a", "asesora_b"]
        );
        assert.strictEqual(oportunidades[0].cotizaciones[0].puede_ver_detalle, true);

        const inicio = await request(port, "/inicio/resumen", token("admin_test", "admin"));
        assert.strictEqual(inicio.status, 200);
        assert.strictEqual(inicio.body.pipeline.flatMap(grupo => grupo.oportunidades).length, 1);
        const tareas = await request(port, "/tareas?estado=pendiente", token("admin_test", "admin"));
        assert.strictEqual(tareas.status, 200);
        const sesionVencida = await request(port, "/inicio/resumen", tokenVencido("admin_test", "admin"));
        assert.strictEqual(sesionVencida.status, 401);

        const asesoraA = await request(port, "/pipeline", token("asesora_a"));
        const oportunidadA = asesoraA.body.flatMap(grupo => grupo.oportunidades)[0];
        assert.strictEqual(oportunidadA.cotizaciones[0].puede_ver_detalle, true);
        assert.strictEqual(oportunidadA.cotizaciones[1].puede_ver_detalle, false);

        const asesoraC = await request(port, "/pipeline", token("asesora_c"));
        assert.strictEqual(asesoraC.body.flatMap(grupo => grupo.oportunidades).length, 0);

        for (const termino of ["jose nunez", "30111222", "5491155551234"]) {
            const busqueda = await request(
                port,
                `/pipeline?busqueda=${encodeURIComponent(termino)}`,
                token("admin_test", "admin")
            );
            assert.strictEqual(busqueda.body.flatMap(grupo => grupo.oportunidades).length, 1);
        }

        const filtro = await request(
            port,
            "/pipeline?asesora=asesora_b&etapa=Inicio",
            token("admin_test", "admin")
        );
        assert.strictEqual(filtro.body.flatMap(grupo => grupo.oportunidades).length, 1);

        const cambio = await request(
            port,
            `/oportunidades/${primera.body.oportunidad_id}/etapa`,
            token("asesora_b"),
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ etapa: "Interesados" })
            }
        );
        assert.strictEqual(cambio.status, 200, JSON.stringify(cambio.body));

        const noAutorizado = await request(
            port,
            `/oportunidades/${primera.body.oportunidad_id}/etapa`,
            token("asesora_c"),
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ etapa: "Auditoría" })
            }
        );
        assert.strictEqual(noAutorizado.status, 404);

        const historial = await request(
            port,
            `/oportunidades/${primera.body.oportunidad_id}/historial`,
            token("asesora_a")
        );
        assert.strictEqual(historial.status, 200);
        assert.strictEqual(historial.body[0].accion, "cambio_etapa");
        assert.strictEqual(historial.body[0].usuario, "asesora_b");

        const verificacion = abrirBase(tempDir);
        try {
            const oportunidadesDb = await all(verificacion, "SELECT * FROM oportunidades_crm");
            const cotizacionesDb = await all(verificacion, "SELECT * FROM cotizaciones ORDER BY id");
            const responsables = await all(
                verificacion,
                "SELECT * FROM oportunidad_asesoras WHERE es_responsable = 1"
            );
            assert.strictEqual(oportunidadesDb.length, 1);
            assert.strictEqual(cotizacionesDb.length, 2);
            assert.ok(cotizacionesDb.every(item => item.oportunidad_id === oportunidadesDb[0].id));
            assert.strictEqual(responsables.length, 1);
        } finally {
            await close(verificacion);
        }

        console.log(JSON.stringify({
            resultado: "OK",
            entorno: "SQLite temporal aislado con datos ficticios",
            pruebas: 28
        }, null, 2));
    } finally {
        await detenerServidor(server);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
