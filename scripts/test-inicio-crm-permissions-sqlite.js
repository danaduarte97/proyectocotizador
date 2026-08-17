#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-crm-permissions-"));
const port = 33000 + Math.floor(Math.random() * 1000);
const testSecret = "inicio-crm-permissions-test";
const fechaPrueba = new Date().toISOString().slice(0, 10);

fs.copyFileSync(path.join(repoRoot, "server.js"), path.join(tempDir, "server.js"));
fs.copyFileSync(path.join(repoRoot, "db.js"), path.join(tempDir, "db.js"));
fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });
fs.copyFileSync(
    path.join(repoRoot, "lib", "posventa.js"),
    path.join(tempDir, "lib", "posventa.js")
);

const childEnv = {
    ...process.env,
    DATABASE_URL: "",
    USE_LEGACY_SQLITE_BACKUP: "true",
    JWT_SECRET: testSecret,
    NODE_PATH: path.join(repoRoot, "node_modules"),
    PORT: String(port)
};
const server = spawn(
    process.execPath,
    [path.join(tempDir, "server.js")],
    {
        cwd: tempDir,
        env: childEnv,
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

function close(db) {
    return new Promise((resolve, reject) => {
        db.close(error => error ? reject(error) : resolve());
    });
}

function token(usuario, rol) {
    return jwt.sign({ usuario, rol }, testSecret, { expiresIn: "10m" });
}

async function request(pathname, authToken, options = {}) {
    const isFormData = options.body instanceof FormData;
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${authToken}`,
            ...(!isFormData ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });
    const body = await response.json().catch(() => null);

    return { status: response.status, body };
}

async function waitForServer() {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (server.exitCode !== null) {
            throw new Error(`El servidor temporal termino antes de iniciar:\n${serverOutput}`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);

            if (response.ok) return;
        } catch {
            // Sigue esperando durante el arranque de SQLite.
        }

        await delay(150);
    }

    throw new Error(`Timeout al iniciar el servidor temporal:\n${serverOutput}`);
}

async function main() {
    await waitForServer();
    await delay(300);

    const db = openDatabase();
    let clienteA;
    let clienteB;
    let clienteC;
    let cotizacionA;
    let cotizacionB;
    let cotizacionC;
    let tareaB;

    try {
        await run(
            db,
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)",
            ["vendedora_a", "test", "vendedora"]
        );
        await run(
            db,
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)",
            ["vendedora_b", "test", "vendedora"]
        );
        clienteA = (await run(
            db,
            `INSERT INTO clientes
             (identidad_tipo, identidad_valor, nombre, etapa_comercial)
             VALUES (?, ?, ?, ?)`,
            ["dni", "10000001", "Cliente A", "Nuevo"]
        )).lastID;
        clienteB = (await run(
            db,
            `INSERT INTO clientes
             (identidad_tipo, identidad_valor, nombre, etapa_comercial)
             VALUES (?, ?, ?, ?)`,
            ["dni", "10000002", "Cliente B", "Nuevo"]
        )).lastID;
        clienteC = (await run(
            db,
            `INSERT INTO clientes
             (identidad_tipo, identidad_valor, nombre, etapa_comercial)
             VALUES (?, ?, ?, ?)`,
            ["dni", "10000003", "Cliente C", "Nuevo"]
        )).lastID;
        cotizacionA = (await run(
            db,
            `INSERT INTO cotizaciones
             (dni, nombre, celular, plan, valor, vendedora, fecha, estado,
              cliente_id, etapa_pipeline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                "10000001",
                "Cliente A",
                "1111111111",
                "Plan A",
                "100",
                "vendedora_a",
                fechaPrueba,
                "Nuevo",
                clienteA,
                "Nuevos"
            ]
        )).lastID;
        cotizacionB = (await run(
            db,
            `INSERT INTO cotizaciones
             (dni, nombre, celular, plan, valor, vendedora, fecha, estado,
              cliente_id, etapa_pipeline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                "10000002",
                "Cliente B",
                "2222222222",
                "Plan B",
                "200",
                "vendedora_b",
                fechaPrueba,
                "Nuevo",
                clienteB,
                "Nuevos"
            ]
        )).lastID;
        cotizacionC = (await run(
            db,
            `INSERT INTO cotizaciones
             (dni, nombre, celular, plan, valor, vendedora, fecha, estado,
              cliente_id, etapa_pipeline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                "10000003",
                "Cliente C",
                "3333333333",
                "Plan C",
                "300",
                "vendedora_a",
                fechaPrueba,
                "Anulada",
                clienteC,
                "Interesados"
            ]
        )).lastID;
        tareaB = (await run(
            db,
            `INSERT INTO tareas_crm
             (titulo, fecha, tipo, estado, usuario_responsable, cotizacion_id,
              cliente_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                "Tarea B",
                fechaPrueba,
                "tarea",
                "pendiente",
                "vendedora_b",
                cotizacionB,
                clienteB
            ]
        )).lastID;
    } finally {
        await close(db);
    }

    const sellerToken = token("vendedora_a", "vendedora");
    const sellerBToken = token("vendedora_b", "vendedora");
    const adminToken = token("admin", "admin");

    const busquedaClienteCompartido = await request(
        "/clientes/buscar?termino=10000002",
        sellerToken
    );
    assert.strictEqual(busquedaClienteCompartido.status, 200);
    assert.strictEqual(busquedaClienteCompartido.body.clientes.length, 1);

    const cotizacionesClienteCompartido = await request(
        `/clientes/${clienteB}/cotizaciones?termino=10000002`,
        sellerToken
    );
    assert.strictEqual(cotizacionesClienteCompartido.status, 200);
    assert.strictEqual(cotizacionesClienteCompartido.body.length, 1);
    assert.strictEqual(cotizacionesClienteCompartido.body[0].plan, "Plan B");
    assert.deepStrictEqual(cotizacionesClienteCompartido.body[0].archivos, []);

    const busquedaComercialCompartida = await request(
        "/buscar/10000002",
        sellerToken
    );
    assert.strictEqual(busquedaComercialCompartida.status, 200);
    assert.strictEqual(busquedaComercialCompartida.body[0].valor, "200");
    assert.deepStrictEqual(busquedaComercialCompartida.body[0].archivos, []);

    const editarSeguimientoAjeno = await request(
        `/cotizaciones/${cotizacionB}/seguimiento`,
        sellerToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Contactado", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(editarSeguimientoAjeno.status, 403);

    const editarComentarioComercialAjeno = await request(
        `/editar-comentario/${cotizacionB}`,
        sellerToken,
        { method: "PUT", body: JSON.stringify({ comentarios: "No permitido" }) }
    );
    assert.strictEqual(editarComentarioComercialAjeno.status, 403);

    const comentarioAjeno = await request(`/comentarios/${cotizacionB}`, sellerToken, {
        method: "POST",
        body: JSON.stringify({ comentario: "Comentario de vendedora A" })
    });
    assert.strictEqual(comentarioAjeno.status, 200);
    assert.ok(comentarioAjeno.body.id);

    const comentariosCompartidos = await request(`/comentarios/${cotizacionB}`, sellerBToken);
    assert.strictEqual(comentariosCompartidos.status, 200);
    assert.strictEqual(comentariosCompartidos.body.length, 1);
    assert.strictEqual(comentariosCompartidos.body[0].usuario, "vendedora_a");

    const borrarComentarioAjeno = await request(
        `/comentarios/${comentarioAjeno.body.id}`,
        sellerBToken,
        { method: "DELETE" }
    );
    assert.strictEqual(borrarComentarioAjeno.status, 403);

    const borrarComentarioPropio = await request(
        `/comentarios/${comentarioAjeno.body.id}`,
        sellerToken,
        { method: "DELETE" }
    );
    assert.strictEqual(borrarComentarioPropio.status, 200);

    const formularioAdjunto = new FormData();
    formularioAdjunto.append(
        "archivo",
        new Blob(["imagen temporal"], { type: "image/png" }),
        "prueba.png"
    );
    const adjuntoPropio = await request(`/subir-archivo/${cotizacionB}`, sellerBToken, {
        method: "POST",
        body: formularioAdjunto
    });
    assert.strictEqual(adjuntoPropio.status, 200);

    const adjuntosPropios = await request(`/archivos/${cotizacionB}`, sellerBToken);
    assert.strictEqual(adjuntosPropios.status, 200);
    assert.strictEqual(adjuntosPropios.body.length, 1);
    const adjuntoId = adjuntosPropios.body[0].id;
    const adjuntoNombreInterno = adjuntosPropios.body[0].archivo;

    const listarAdjuntosAjenos = await request(`/archivos/${cotizacionB}`, sellerToken);
    assert.strictEqual(listarAdjuntosAjenos.status, 403);

    const descargarAdjuntoAjeno = await request(
        `/archivos/${adjuntoId}/descargar`,
        sellerToken
    );
    assert.strictEqual(descargarAdjuntoAjeno.status, 403);

    const eliminarAdjuntoAjeno = await request(`/archivos/${adjuntoId}`, sellerToken, {
        method: "DELETE"
    });
    assert.strictEqual(eliminarAdjuntoAjeno.status, 403);

    const formularioAdjuntoAjeno = new FormData();
    formularioAdjuntoAjeno.append(
        "archivo",
        new Blob(["imagen temporal"], { type: "image/png" }),
        "ajeno.png"
    );
    const subirAdjuntoAjeno = await request(`/subir-archivo/${cotizacionB}`, sellerToken, {
        method: "POST",
        body: formularioAdjuntoAjeno
    });
    assert.strictEqual(subirAdjuntoAjeno.status, 403);

    const descargaPropia = await request(`/archivos/${adjuntoId}/descargar`, sellerBToken);
    assert.strictEqual(descargaPropia.status, 200);

    const descargaPublica = await fetch(
        `http://127.0.0.1:${port}/uploads/${encodeURIComponent(adjuntoNombreInterno)}`
    );
    assert.strictEqual(descargaPublica.status, 404);

    const eliminarAdjuntoAdmin = await request(`/archivos/${adjuntoId}`, adminToken, {
        method: "DELETE"
    });
    assert.strictEqual(eliminarAdjuntoAdmin.status, 200);

    const sellerPipeline = await request("/pipeline", sellerToken);
    assert.strictEqual(sellerPipeline.status, 200);
    const sellerQuotes = sellerPipeline.body.flatMap(column => column.cotizaciones);
    assert.deepStrictEqual(sellerQuotes.map(item => item.id), [cotizacionA]);

    const adminPipeline = await request("/pipeline", adminToken);
    assert.strictEqual(adminPipeline.status, 200);
    assert.strictEqual(
        adminPipeline.body.flatMap(column => column.cotizaciones).length,
        2
    );

    const inicioInicial = await request("/inicio/resumen", adminToken);
    assert.strictEqual(inicioInicial.status, 200);
    assert.strictEqual(inicioInicial.body.estadisticas.cotizaciones_mes, 3);
    assert.strictEqual(
        inicioInicial.body.pipeline.flatMap(column => column.cotizaciones).length,
        2
    );

    const ownMove = await request(
        `/cotizaciones/${cotizacionA}/etapa-pipeline`,
        sellerToken,
        { method: "PUT", body: JSON.stringify({ etapa_pipeline: "Contactados" }) }
    );
    assert.strictEqual(ownMove.status, 200);

    const foreignMove = await request(
        `/cotizaciones/${cotizacionB}/etapa-pipeline`,
        sellerToken,
        { method: "PUT", body: JSON.stringify({ etapa_pipeline: "Contactados" }) }
    );
    assert.strictEqual(foreignMove.status, 403);

    const ownTask = await request("/tareas", sellerToken, {
        method: "POST",
        body: JSON.stringify({
            titulo: "Tarea A",
            fecha: fechaPrueba,
            tipo: "seguimiento",
            cotizacion_id: cotizacionA,
            cliente_id: clienteB
        })
    });
    assert.strictEqual(ownTask.status, 200);

    const foreignTask = await request("/tareas", sellerToken, {
        method: "POST",
        body: JSON.stringify({
            titulo: "Tarea ajena",
            fecha: fechaPrueba,
            tipo: "tarea",
            cotizacion_id: cotizacionB
        })
    });
    assert.strictEqual(foreignTask.status, 403);

    const foreignTaskEdit = await request(`/tareas/${tareaB}`, sellerToken, {
        method: "PUT",
        body: JSON.stringify({ titulo: "No permitido" })
    });
    assert.strictEqual(foreignTaskEdit.status, 403);

    const sellerTasks = await request("/tareas", sellerToken);
    assert.strictEqual(sellerTasks.status, 200);
    assert.strictEqual(sellerTasks.body.length, 1);
    assert.strictEqual(sellerTasks.body[0].usuario_responsable, "vendedora_a");
    assert.strictEqual(sellerTasks.body[0].cliente_id, clienteA);

    const adminTasks = await request("/tareas", adminToken);
    assert.strictEqual(adminTasks.status, 200);
    assert.strictEqual(adminTasks.body.length, 2);

    const adminMove = await request(
        `/cotizaciones/${cotizacionB}/etapa-pipeline`,
        adminToken,
        { method: "PUT", body: JSON.stringify({ etapa_pipeline: "Auditor\u00eda" }) }
    );
    assert.strictEqual(adminMove.status, 200);

    const adminClose = await request(
        `/cotizaciones/${cotizacionB}/seguimiento`,
        adminToken,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Anulada", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(adminClose.status, 200);

    const pipelineDespuesDeAnular = await request("/pipeline", adminToken);
    assert.strictEqual(pipelineDespuesDeAnular.status, 200);
    assert.deepStrictEqual(
        pipelineDespuesDeAnular.body
            .flatMap(column => column.cotizaciones)
            .map(item => item.id),
        [cotizacionA]
    );

    const inicioDespuesDeAnular = await request("/inicio/resumen", adminToken);
    assert.strictEqual(inicioDespuesDeAnular.status, 200);
    assert.strictEqual(inicioDespuesDeAnular.body.estadisticas.cotizaciones_mes, 3);
    assert.strictEqual(
        inicioDespuesDeAnular.body.pipeline
            .flatMap(column => column.cotizaciones).length,
        1
    );

    const verifyDb = openDatabase();

    try {
        const quoteA = await get(
            verifyDb,
            "SELECT estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [cotizacionA]
        );
        const quoteB = await get(
            verifyDb,
            "SELECT estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [cotizacionB]
        );
        const quoteC = await get(
            verifyDb,
            "SELECT estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [cotizacionC]
        );

        assert.deepStrictEqual(quoteA, {
            estado: "Nuevo",
            etapa_pipeline: "Contactados"
        });
        assert.deepStrictEqual(quoteB, {
            estado: "Anulada",
            etapa_pipeline: null
        });
        assert.deepStrictEqual(quoteC, {
            estado: "Anulada",
            etapa_pipeline: "Interesados"
        });
    } finally {
        await close(verifyDb);
    }

    const newClientForm = new FormData();
    newClientForm.append("dni", "10000004");
    newClientForm.append("nombre", "Cliente API Nuevo");
    newClientForm.append("celular", "4444444444");
    newClientForm.append("plan", "Plan API Nuevo");
    newClientForm.append("tipo_cobertura", "Individual");
    newClientForm.append("valor", "400");
    newClientForm.append("modalidad", "Particular");
    newClientForm.append("referido", "No");
    newClientForm.append("bonificacion", "0");
    newClientForm.append("bonificacion_aportes", "0");
    newClientForm.append("comentarios", "Prueba SQLite temporal");
    newClientForm.append("opciones", JSON.stringify([{
        numero_opcion: 1,
        plan: "Plan API Nuevo",
        tipo_cobertura: "Individual",
        valor: "400",
        bonificacion: "0",
        bonificacion_aportes: "0"
    }]));

    const newClientQuote = await request("/agregar", sellerToken, {
        method: "POST",
        body: newClientForm
    });
    assert.strictEqual(newClientQuote.status, 200);
    assert.ok(newClientQuote.body.id);
    assert.ok(newClientQuote.body.cliente_id);

    const existingClientForm = new FormData();
    existingClientForm.append("dni", "10000001");
    existingClientForm.append("nombre", "Cliente A");
    existingClientForm.append("celular", "1111111111");
    existingClientForm.append("plan", "Plan API Existente");
    existingClientForm.append("tipo_cobertura", "Individual");
    existingClientForm.append("valor", "500");
    existingClientForm.append("modalidad", "Particular");
    existingClientForm.append("referido", "No");
    existingClientForm.append("bonificacion", "0");
    existingClientForm.append("bonificacion_aportes", "0");
    existingClientForm.append("comentarios", "Prueba SQLite temporal");
    existingClientForm.append("cliente_id", String(clienteA));
    existingClientForm.append("termino_busqueda", "10000001");
    existingClientForm.append("opciones", JSON.stringify([{
        numero_opcion: 1,
        plan: "Plan API Existente",
        tipo_cobertura: "Individual",
        valor: "500",
        bonificacion: "0",
        bonificacion_aportes: "0"
    }]));

    const existingClientQuote = await request(
        `/clientes/${clienteA}/cotizaciones`,
        sellerToken,
        { method: "POST", body: existingClientForm }
    );
    assert.strictEqual(existingClientQuote.status, 200);
    assert.strictEqual(String(existingClientQuote.body.cliente_id), String(clienteA));

    const sharedClientForm = new FormData();
    sharedClientForm.append("dni", "10000002");
    sharedClientForm.append("nombre", "Cliente B");
    sharedClientForm.append("celular", "2222222222");
    sharedClientForm.append("plan", "Plan propio sobre contacto compartido");
    sharedClientForm.append("tipo_cobertura", "Individual");
    sharedClientForm.append("valor", "600");
    sharedClientForm.append("modalidad", "Particular");
    sharedClientForm.append("referido", "No");
    sharedClientForm.append("bonificacion", "0");
    sharedClientForm.append("bonificacion_aportes", "0");
    sharedClientForm.append("comentarios", "Nueva gestión de A");
    sharedClientForm.append("cliente_id", String(clienteB));
    sharedClientForm.append("termino_busqueda", "10000002");
    sharedClientForm.append("opciones", JSON.stringify([{
        numero_opcion: 1,
        plan: "Plan propio sobre contacto compartido",
        tipo_cobertura: "Individual",
        valor: "600",
        bonificacion: "0",
        bonificacion_aportes: "0"
    }]));

    const sharedClientQuote = await request(
        `/clientes/${clienteB}/cotizaciones`,
        sellerToken,
        { method: "POST", body: sharedClientForm }
    );
    assert.strictEqual(sharedClientQuote.status, 200);
    assert.strictEqual(String(sharedClientQuote.body.cliente_id), String(clienteB));

    const creationDb = openDatabase();

    try {
        const newQuoteStored = await get(
            creationDb,
            "SELECT cliente_id, vendedora, estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [newClientQuote.body.id]
        );
        const existingQuoteStored = await get(
            creationDb,
            "SELECT cliente_id, vendedora, estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [existingClientQuote.body.id]
        );
        const sharedQuoteStored = await get(
            creationDb,
            "SELECT cliente_id, vendedora, estado, etapa_pipeline FROM cotizaciones WHERE id = ?",
            [sharedClientQuote.body.id]
        );

        for (const quote of [newQuoteStored, existingQuoteStored, sharedQuoteStored]) {
            assert.strictEqual(quote.vendedora, "vendedora_a");
            assert.strictEqual(quote.estado, "Nuevo");
            assert.strictEqual(quote.etapa_pipeline, "Nuevos");
        }

        assert.strictEqual(
            String(newQuoteStored.cliente_id),
            String(newClientQuote.body.cliente_id)
        );
        assert.strictEqual(String(existingQuoteStored.cliente_id), String(clienteA));
        assert.strictEqual(String(sharedQuoteStored.cliente_id), String(clienteB));
    } finally {
        await close(creationDb);
    }

    console.log(JSON.stringify({
        resultado: "OK",
        entorno: "SQLite temporal",
        pruebas: [
            "vendedora lista solo sus cotizaciones",
            "administradora lista todas las cotizaciones",
            "vendedora mueve solo su cotizacion",
            "administradora mueve cualquier cotizacion",
            "mover una etapa no afiliada conserva el estado compatible",
            "anular limpia la etapa del pipeline",
            "cierres negativos se excluyen aunque tengan etapa asignada",
            "anular una cotizacion la quita del pipeline sin borrarla",
            "cotizaciones del mes conserva el total historico",
            "tarea usa responsable de sesion",
            "cliente_id se deriva de la cotizacion",
            "vendedora no vincula ni edita tareas ajenas",
            "vendedora lista solo sus tareas",
            "administradora lista todas las tareas",
            "POST /agregar crea cliente y cotizacion en SQLite temporal",
            "POST /clientes/:id/cotizaciones vincula el cliente existente",
            "búsqueda compartida devuelve información comercial sin adjuntos ajenos",
            "vendedora no modifica seguimiento ni comentario comercial ajeno",
            "comentarios compartidos permiten borrar sólo la propia autora",
            "adjuntos ajenos no se pueden listar, descargar, subir ni eliminar",
            "administradora conserva administración de adjuntos",
            "la URL pública histórica de uploads queda bloqueada",
            "vendedora puede crear su cotización sobre un cliente ya trabajado"
        ],
        creacion_http: {
            cliente_nuevo: {
                ruta: "/agregar",
                metodo: "POST",
                status: newClientQuote.status,
                success: newClientQuote.body.success
            },
            cliente_existente: {
                ruta: "/clientes/:id/cotizaciones",
                metodo: "POST",
                status: existingClientQuote.status,
                success: existingClientQuote.body.success
            },
            cliente_compartido: {
                ruta: "/clientes/:id/cotizaciones",
                metodo: "POST",
                status: sharedClientQuote.status,
                success: sharedClientQuote.body.success
            }
        }
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error.stack || error.message);
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
