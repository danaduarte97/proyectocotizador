#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-perfil-identidad-"));
const port = 36500 + Math.floor(Math.random() * 800);
const secret = "perfil-identidad-test";

fs.copyFileSync(path.join(repoRoot, "server.js"), path.join(tempDir, "server.js"));
fs.copyFileSync(path.join(repoRoot, "db.js"), path.join(tempDir, "db.js"));
fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });
fs.copyFileSync(
    path.join(repoRoot, "lib", "posventa.js"),
    path.join(tempDir, "lib", "posventa.js")
);

const server = spawn(process.execPath, [path.join(tempDir, "server.js")], {
    cwd: tempDir,
    env: {
        ...process.env,
        DATABASE_URL: "",
        USE_LEGACY_SQLITE_BACKUP: "true",
        JWT_SECRET: secret,
        NODE_PATH: path.join(repoRoot, "node_modules"),
        PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function openDb() {
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

function close(db) {
    return new Promise((resolve, reject) => {
        db.close(error => error ? reject(error) : resolve());
    });
}

function auth(usuario, rol = "vendedora") {
    return jwt.sign({ usuario, rol }, secret, { expiresIn: "10m" });
}

async function request(pathname, token, options = {}) {
    const form = options.body instanceof FormData;
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(!form ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });
    return {
        status: response.status,
        body: await response.json().catch(() => null)
    };
}

function formCotizacion({ dni = "", celular = "", nombre = "Prueba" } = {}) {
    const form = new FormData();
    const campos = {
        dni,
        celular,
        nombre,
        plan: "Oro",
        tipo_cobertura: "Individual",
        valor: "100000",
        bonificacion: "0",
        bonificacion_aportes: "0",
        modalidad: "PARTICULAR",
        vigencia: "",
        referido: "No",
        congelamiento: "",
        comentarios: "",
        opciones: JSON.stringify([{
            numero_opcion: 1,
            plan: "Oro",
            tipo_cobertura: "Individual",
            valor: "100000",
            bonificacion: "0",
            bonificacion_aportes: "0"
        }])
    };
    Object.entries(campos).forEach(([key, value]) => form.append(key, value));
    return form;
}

async function waitForServer() {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (server.exitCode !== null) {
            throw new Error(`Servidor finalizado:\n${serverOutput}`);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);
            if (response.ok) return;
        } catch {
            // Continúa esperando la base temporal.
        }
        await delay(120);
    }
    throw new Error(`Timeout al iniciar servidor:\n${serverOutput}`);
}

async function crear(token, datos) {
    return request("/agregar", token, {
        method: "POST",
        body: formCotizacion(datos)
    });
}

async function main() {
    const migracion = fs.readFileSync(
        path.join(repoRoot, "sql", "20260819_cotizacion_identidad_opcional.postgres.sql"),
        "utf8"
    );
    assert.doesNotMatch(
        migracion,
        /CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+(?:public\.)?cotizaciones\s*\([^)]*(?:dni|celular|telefono_normalizado|dni_normalizado)/i
    );
    assert.match(
        migracion,
        /CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+public\.clientes\s*\(dni_normalizado\)/i
    );
    assert.match(
        migracion,
        /CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+public\.clientes\s*\(telefono_normalizado\)/i
    );

    await waitForServer();
    await delay(250);

    const db = openDb();
    try {
        await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", [
            "asesora_a", "test", "vendedora"
        ]);
        await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", [
            "asesora_b", "test", "vendedora"
        ]);
    } finally {
        await close(db);
    }

    const asesoraA = auth("asesora_a");
    const asesoraB = auth("asesora_b");
    const admin = auth("admin", "admin");

    const ambos = await crear(asesoraA, {
        dni: "20.111.222",
        celular: "+54 9 11 3000-0001",
        nombre: "Identidad completa"
    });
    assert.strictEqual(ambos.status, 200);

    const busquedaCompartida = await request(
        "/clientes/buscar?termino=20111222",
        asesoraB
    );
    assert.strictEqual(busquedaCompartida.status, 200);
    assert.strictEqual(busquedaCompartida.body.clientes.length, 1);
    assert.strictEqual(
        String(busquedaCompartida.body.clientes[0].id),
        String(ambos.body.cliente_id)
    );

    const cotizacionCompartida = await request(
        `/clientes/${ambos.body.cliente_id}/cotizaciones?termino=20111222`,
        asesoraB,
        {
            method: "POST",
            body: formCotizacion({
                dni: "20.111.222",
                celular: "11 3000-0001",
                nombre: "Identidad completa"
            })
        }
    );
    assert.strictEqual(cotizacionCompartida.status, 200);
    assert.strictEqual(
        String(cotizacionCompartida.body.cliente_id),
        String(ambos.body.cliente_id)
    );

    const editarNombreCompartido = await request(
        `/cotizaciones/${ambos.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Identidad compartida actualizada",
                dni: "20.111.222",
                celular: "11 3000-0001"
            })
        }
    );
    assert.strictEqual(editarNombreCompartido.status, 200);

    const cambiarTelefonoCompartido = await request(
        `/cotizaciones/${ambos.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Identidad compartida actualizada",
                dni: "20.111.222",
                celular: "+54 9 11 3000-0099"
            })
        }
    );
    assert.strictEqual(cambiarTelefonoCompartido.status, 200);

    const busquedaTelefonoActualizado = await request(
        "/clientes/buscar?termino=1130000099",
        asesoraB
    );
    assert.strictEqual(busquedaTelefonoActualizado.status, 200);
    assert.strictEqual(busquedaTelefonoActualizado.body.clientes.length, 1);
    assert.strictEqual(
        String(busquedaTelefonoActualizado.body.clientes[0].id),
        String(ambos.body.cliente_id)
    );

    const primerContactoTelefonoActualizado = await request(
        "/primer-contacto/buscar?telefono=1130000099",
        asesoraB
    );
    assert.strictEqual(primerContactoTelefonoActualizado.status, 200);
    assert.strictEqual(primerContactoTelefonoActualizado.body.existe_en_crm, true);

    const soloDni = await crear(asesoraA, {
        dni: "21.222.333",
        celular: "11 4555-6677",
        nombre: "DNI y teléfono"
    });
    assert.strictEqual(soloDni.status, 200);

    const sinTelefono = await crear(asesoraA, {
        dni: "21.222.334",
        celular: "",
        nombre: "Sin teléfono"
    });
    assert.strictEqual(sinTelefono.status, 400);

    const soloTelefono = await crear(asesoraA, {
        dni: "",
        celular: "011 3222-4444",
        nombre: "Sólo teléfono"
    });
    assert.strictEqual(soloTelefono.status, 200);

    const dbAntesVacio = openDb();
    const antesVacio = await get(
        dbAntesVacio,
        "SELECT COUNT(*) AS total FROM cotizaciones"
    );
    await close(dbAntesVacio);
    const ninguno = await crear(asesoraA, { dni: "", celular: "" });
    assert.strictEqual(ninguno.status, 400);
    const dbDespuesVacio = openDb();
    const despuesVacio = await get(
        dbDespuesVacio,
        "SELECT COUNT(*) AS total FROM cotizaciones"
    );
    assert.strictEqual(despuesVacio.total, antesVacio.total);
    await close(dbDespuesVacio);

    const editarImportes = await request(
        `/cotizaciones/${soloTelefono.body.id}/importes`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                opciones: [{
                    valor: "160000",
                    bonificacion: "10000",
                    bonificacion_aportes: "5000"
                }]
            })
        }
    );
    assert.strictEqual(editarImportes.status, 200);

    const editarImportesAjenos = await request(
        `/cotizaciones/${soloTelefono.body.id}/importes`,
        asesoraB,
        {
            method: "PUT",
            body: JSON.stringify({ opciones: [{ valor: "1", bonificacion: "0", bonificacion_aportes: "0" }] })
        }
    );
    assert.strictEqual(editarImportesAjenos.status, 403);

    const descartable = await crear(asesoraA, {
        dni: "",
        celular: "11 3999-8877",
        nombre: "Para eliminar"
    });
    assert.strictEqual(descartable.status, 200);

    const dbRelaciones = openDb();
    await run(dbRelaciones,
        "INSERT INTO comentarios_cotizacion (cotizacion_id, usuario, comentario) VALUES (?, ?, ?)",
        [descartable.body.id, "asesora_a", "Comentario"]
    );
    await run(dbRelaciones,
        "INSERT INTO tareas_crm (titulo, fecha, usuario_responsable, cotizacion_id, clave_automatica) VALUES (?, ?, ?, ?, ?)",
        ["Seguimiento", "2026-10-02", "asesora_a", descartable.body.id, "prueba"]
    );
    await close(dbRelaciones);

    const eliminarAjena = await request(`/cotizaciones/${descartable.body.id}`, asesoraB, {
        method: "DELETE"
    });
    assert.strictEqual(eliminarAjena.status, 403);

    const eliminarPropia = await request(`/cotizaciones/${descartable.body.id}`, asesoraA, {
        method: "DELETE"
    });
    assert.strictEqual(eliminarPropia.status, 200);

    const dbDespuesEliminar = openDb();
    const cotizacionEliminada = await get(dbDespuesEliminar,
        "SELECT id FROM cotizaciones WHERE id = ?", [descartable.body.id]);
    const comentariosHuerfanos = await get(dbDespuesEliminar,
        "SELECT COUNT(*) AS total FROM comentarios_cotizacion WHERE cotizacion_id = ?", [descartable.body.id]);
    const tareaDesvinculada = await get(dbDespuesEliminar,
        "SELECT cotizacion_id, clave_automatica FROM tareas_crm WHERE titulo = 'Seguimiento'");
    assert.strictEqual(cotizacionEliminada, undefined);
    assert.strictEqual(comentariosHuerfanos.total, 0);
    assert.strictEqual(tareaDesvinculada.cotizacion_id, null);
    assert.strictEqual(tareaDesvinculada.clave_automatica, null);
    await close(dbDespuesEliminar);

    const dbAntesEdicion = openDb();
    const clientesAntesEdicion = await get(
        dbAntesEdicion,
        "SELECT COUNT(*) AS total FROM clientes"
    );
    await run(
        dbAntesEdicion,
        `INSERT INTO primer_contacto_identidades
            (telefono_original, telefono_normalizado, cliente_id, nombre)
         VALUES (?, ?, NULL, ?)`,
        ["11 4555-6677", "1145556677", "Identidad previa"]
    );
    await close(dbAntesEdicion);

    const agregarDni = await request(
        `/cotizaciones/${soloTelefono.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Sólo teléfono actualizado",
                dni: "23.456.789",
                celular: "(011) 3222-4444"
            })
        }
    );
    assert.strictEqual(agregarDni.status, 200);
    assert.strictEqual(
        String(agregarDni.body.perfil.cliente_id),
        String(soloTelefono.body.cliente_id)
    );

    const buscarDniAgregado = await request("/buscar/23456789", asesoraA);
    assert.strictEqual(buscarDniAgregado.status, 200);
    assert.ok(buscarDniAgregado.body.some(item => item.id === soloTelefono.body.id));

    const agregarTelefono = await request(
        `/cotizaciones/${soloDni.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Sólo DNI actualizado",
                dni: "21.222.333",
                celular: "+54 9 11 4555-6677"
            })
        }
    );
    assert.strictEqual(agregarTelefono.status, 200);
    assert.strictEqual(agregarTelefono.body.perfil.telefono_normalizado, "1145556677");

    const buscarTelefonoAgregado = await request(
        "/buscar/01145556677",
        asesoraA
    );
    assert.strictEqual(buscarTelefonoAgregado.status, 200);
    assert.ok(buscarTelefonoAgregado.body.some(item => item.id === soloDni.body.id));

    const primerContactoDetecta = await request(
        "/primer-contacto/buscar?telefono=541145556677",
        asesoraB
    );
    assert.strictEqual(primerContactoDetecta.status, 200);
    assert.strictEqual(primerContactoDetecta.body.existe_en_crm, true);
    assert.strictEqual(
        String(primerContactoDetecta.body.cliente.id),
        String(soloDni.body.cliente_id)
    );

    const edicionAjena = await request(
        `/cotizaciones/${soloTelefono.body.id}/perfil`,
        asesoraB,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "No permitido",
                dni: "23.456.789",
                celular: "1132224444"
            })
        }
    );
    assert.strictEqual(edicionAjena.status, 403);

    const edicionAdmin = await request(
        `/cotizaciones/${soloTelefono.body.id}/perfil`,
        admin,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Editado por admin",
                dni: "23.456.789",
                celular: "1132224444"
            })
        }
    );
    assert.strictEqual(edicionAdmin.status, 200);

    const conflictoBase = await crear(asesoraB, {
        dni: "24.567.890",
        celular: "11 4666-7788",
        nombre: "Cliente conflicto"
    });
    assert.strictEqual(conflictoBase.status, 200);

    const conflictoDni = await request(
        `/cotizaciones/${soloDni.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Conflicto",
                dni: "24.567.890",
                celular: "1145556677"
            })
        }
    );
    assert.strictEqual(conflictoDni.status, 409);

    const conflictoTelefono = await request(
        `/cotizaciones/${soloDni.body.id}/perfil`,
        asesoraA,
        {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Conflicto",
                dni: "21.222.333",
                celular: "01146667788"
            })
        }
    );
    assert.strictEqual(conflictoTelefono.status, 409);

    const dbFinal = openDb();
    try {
        const clientesFinal = await get(dbFinal, "SELECT COUNT(*) AS total FROM clientes");
        assert.strictEqual(
            clientesFinal.total,
            clientesAntesEdicion.total + 1
        );

        const cotizacionesCompartidas = await get(
            dbFinal,
            `SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT cliente_id) AS clientes,
                COUNT(DISTINCT dni) AS documentos,
                COUNT(DISTINCT celular) AS telefonos,
                COUNT(DISTINCT nombre) AS nombres
             FROM cotizaciones
             WHERE id IN (?, ?)`,
            [ambos.body.id, cotizacionCompartida.body.id]
        );
        assert.strictEqual(cotizacionesCompartidas.total, 2);
        assert.strictEqual(cotizacionesCompartidas.clientes, 1);
        assert.strictEqual(cotizacionesCompartidas.documentos, 1);
        assert.strictEqual(cotizacionesCompartidas.telefonos, 1);
        assert.strictEqual(cotizacionesCompartidas.nombres, 1);

        const clienteCompartidoActualizado = await get(
            dbFinal,
            `SELECT nombre, dni_normalizado, telefono_normalizado
             FROM clientes WHERE id = ?`,
            [ambos.body.cliente_id]
        );
        assert.strictEqual(
            clienteCompartidoActualizado.nombre,
            "Identidad compartida actualizada"
        );
        assert.strictEqual(clienteCompartidoActualizado.dni_normalizado, "20111222");
        assert.strictEqual(
            clienteCompartidoActualizado.telefono_normalizado,
            "1130000099"
        );

        const cotizacionSoloDni = await get(
            dbFinal,
            "SELECT dni, celular, cliente_id FROM cotizaciones WHERE id = ?",
            [soloDni.body.id]
        );
        assert.strictEqual(cotizacionSoloDni.dni, "21.222.333");
        assert.strictEqual(cotizacionSoloDni.celular, "1145556677");

        const clienteActualizado = await get(
            dbFinal,
            `SELECT dni_normalizado, telefono_normalizado
             FROM clientes WHERE id = ?`,
            [soloDni.body.cliente_id]
        );
        assert.strictEqual(clienteActualizado.dni_normalizado, "21222333");
        assert.strictEqual(clienteActualizado.telefono_normalizado, "1145556677");

        const primerContactoVinculado = await get(
            dbFinal,
            `SELECT cliente_id FROM primer_contacto_identidades
             WHERE telefono_normalizado = ?`,
            ["1145556677"]
        );
        assert.strictEqual(
            String(primerContactoVinculado.cliente_id),
            String(soloDni.body.cliente_id)
        );
    } finally {
        await close(dbFinal);
    }

    console.log(JSON.stringify({
        resultado: "OK",
        entorno: "SQLite temporal",
        pruebas: [
            "migracion sin UNIQUE de identidad sobre cotizaciones",
            "dos asesoras crean cotizaciones para el mismo cliente",
            "DNI y teléfono se repiten entre cotizaciones sin error UNIQUE",
            "nombre compartido se sincroniza en cliente y cotizaciones",
            "propietaria cambia el teléfono compartido",
            "Primer contacto reconoce el teléfono actualizado",
            "crear con DNI y teléfono",
            "rechazar creación sólo con DNI",
            "crear sólo con teléfono",
            "rechazar sin DNI ni teléfono",
            "propietaria agrega DNI",
            "propietaria agrega teléfono",
            "admin edita perfil",
            "otra asesora recibe 403",
            "búsqueda por DNI agregado",
            "búsqueda por teléfono agregado",
            "cliente conservado sin duplicación",
            "conflicto de DNI devuelve 409",
            "conflicto de teléfono devuelve 409",
            "Primer contacto reconoce y vincula teléfono",
            "normalización argentina conservada"
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
