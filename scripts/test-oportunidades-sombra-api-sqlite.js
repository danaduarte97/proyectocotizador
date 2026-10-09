#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const testSecret = "oportunidades-sombra-test";

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function copiarServidor(tempDir) {
    fs.copyFileSync(path.join(repoRoot, "server.js"), path.join(tempDir, "server.js"));
    fs.copyFileSync(path.join(repoRoot, "db.js"), path.join(tempDir, "db.js"));
    fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });

    for (const archivo of ["posventa.js", "oportunidades.js"]) {
        fs.copyFileSync(
            path.join(repoRoot, "lib", archivo),
            path.join(tempDir, "lib", archivo)
        );
    }
}

function iniciarServidor(tempDir, port, habilitada) {
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
            OPORTUNIDADES_SOMBRA_HABILITADA: habilitada ? "true" : "false"
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
    for (let intento = 0; intento < 80; intento++) {
        if (child.exitCode !== null) {
            throw new Error(`Servidor finalizó antes de iniciar:\n${child.testOutput()}`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);
            if (response.ok) return;
        } catch (_) {
            // El servidor todavía está iniciando.
        }

        await delay(100);
    }

    throw new Error(`El servidor no inició:\n${child.testOutput()}`);
}

function openDatabase(tempDir) {
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

function close(db) {
    return new Promise((resolve, reject) => {
        db.close(error => error ? reject(error) : resolve());
    });
}

function token(usuario, rol) {
    return jwt.sign({ usuario, rol }, testSecret, { expiresIn: "10m" });
}

async function request(port, pathname, authToken) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
    });
    return {
        status: response.status,
        body: await response.json().catch(() => null)
    };
}

async function detenerServidor(child) {
    if (child.exitCode !== null) return;
    child.kill();
    await Promise.race([
        new Promise(resolve => child.once("exit", resolve)),
        delay(2000)
    ]);
}

async function probarHabilitada() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-oportunidades-api-"));
    const port = 35000 + Math.floor(Math.random() * 500);
    const server = iniciarServidor(tempDir, port, true);

    try {
        await esperarServidor(port, server);
        const db = openDatabase(tempDir);

        try {
            await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", ["admin_test", "x", "admin"]);
            await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", ["asesora_a", "x", "vendedora"]);
            await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", ["asesora_b", "x", "vendedora"]);
            const cliente = await run(db, `
                INSERT INTO clientes (
                    identidad_tipo, identidad_valor, nombre, celular,
                    telefono_normalizado, etapa_comercial
                ) VALUES ('telefono', '1111111111', 'Cliente prueba',
                    '1111111111', '1111111111', 'Cotizado')
            `);
            await run(db, `
                INSERT INTO cotizaciones (
                    cliente_id, nombre, celular, vendedora, estado,
                    etapa_pipeline, fecha
                ) VALUES (?, 'Cliente prueba', '1111111111', 'asesora_a',
                    'Nuevo', 'Nuevos', '2026-01-01 10:00:00')
            `, [cliente.lastID]);
            await run(db, `
                INSERT INTO cotizaciones (
                    cliente_id, nombre, celular, vendedora, estado,
                    etapa_pipeline, fecha
                ) VALUES (?, 'Cliente prueba', '1111111111', 'asesora_b',
                    'Contactado', 'Interesados', '2026-01-02 10:00:00')
            `, [cliente.lastID]);
            const procedencia = await run(db, `
                INSERT INTO procedencias (
                    codigo, nombre, seleccionable, activa, orden
                ) VALUES ('referido_test', 'Referido test', 1, 1, 500)
            `);
            await run(db, `
                INSERT INTO primer_contacto_identidades (
                    telefono_original, telefono_normalizado, cliente_id,
                    nombre, procedencia_id, fecha_creacion
                ) VALUES ('1111111111', '1111111111', ?,
                    'Cliente prueba', ?, '2026-01-03 10:00:00')
            `, [cliente.lastID, procedencia.lastID]);
        } finally {
            await close(db);
        }

        const admin = await request(
            port,
            "/admin/oportunidades-sombra/comparacion",
            token("admin_test", "admin")
        );
        assert.strictEqual(admin.status, 200);
        assert.strictEqual(admin.body.modo, "sombra_solo_lectura");
        assert.strictEqual(admin.body.pipeline_actual.tarjetas_activas, 2);
        assert.strictEqual(admin.body.simulacion.resumen.oportunidades_esperadas, 1);
        assert.strictEqual(admin.body.simulacion.resumen.oportunidades_multi_asesora, 1);
        assert.strictEqual(admin.body.simulacion.oportunidades[0].etapa, "Interesados");
        assert.strictEqual(admin.body.simulacion.oportunidades[0].responsable, "asesora_a");
        assert.strictEqual(
            admin.body.simulacion.oportunidades[0].procedencia.atribucion,
            "retrospectiva"
        );

        const vendedora = await request(
            port,
            "/admin/oportunidades-sombra/comparacion",
            token("asesora_a", "vendedora")
        );
        assert.strictEqual(vendedora.status, 403);
    } finally {
        await detenerServidor(server);
    }
}

async function probarDeshabilitada() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-oportunidades-off-"));
    const port = 35500 + Math.floor(Math.random() * 400);
    const server = iniciarServidor(tempDir, port, false);

    try {
        await esperarServidor(port, server);
        const response = await request(
            port,
            "/admin/oportunidades-sombra/comparacion",
            token("admin_test", "admin")
        );
        assert.strictEqual(response.status, 404);
    } finally {
        await detenerServidor(server);
    }
}

async function main() {
    await probarHabilitada();
    await probarDeshabilitada();
    console.log(JSON.stringify({
        resultado: "OK",
        entorno: "SQLite temporal aislado",
        pruebas: [
            "el endpoint en sombra está deshabilitado por defecto",
            "sólo Administración puede consultar la comparación",
            "dos cotizaciones se agrupan en una oportunidad",
            "la primera asesora queda como responsable",
            "la etapa más avanzada se propone sin cambiar el Pipeline",
            "la procedencia directa posterior se marca como retrospectiva"
        ]
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
