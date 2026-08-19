#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const repoRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asis-primer-contacto-"));
const port = 35000 + Math.floor(Math.random() * 1000);
const testSecret = "primer-contacto-test";

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
        JWT_SECRET: testSecret,
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
            throw new Error(`El servidor temporal terminó antes de iniciar:\n${serverOutput}`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/login-usuarios`);
            if (response.ok) return;
        } catch {
            // Sigue esperando SQLite.
        }

        await delay(150);
    }

    throw new Error(`Timeout al iniciar el servidor temporal:\n${serverOutput}`);
}

function formularioCotizacion({ nombre, celular }) {
    const form = new FormData();
    const campos = {
        dni: "",
        nombre,
        celular,
        plan: "Oro",
        tipo_cobertura: "Individual",
        valor: "100000",
        bonificacion: "0",
        bonificacion_aportes: "0",
        modalidad: "Directo",
        vigencia: "30 días",
        referido: "No",
        congelamiento: "No",
        comentarios: "Creada desde Primer contacto",
        termino_busqueda: celular,
        opciones: JSON.stringify([{
            numero_opcion: 1,
            plan: "Oro",
            tipo_cobertura: "Individual",
            valor: "100000",
            bonificacion: "0",
            bonificacion_aportes: "0"
        }])
    };

    Object.entries(campos).forEach(([clave, valor]) => form.append(clave, valor));
    return form;
}

async function main() {
    await waitForServer();
    await delay(300);

    const db = openDatabase();
    let clienteExistente;
    let cotizacionAjena;
    let clienteMaria;
    let clienteSinCotizacion;

    try {
        await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", [
            "vendedora_a", "test", "vendedora"
        ]);
        await run(db, "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", [
            "vendedora_b", "test", "vendedora"
        ]);
        clienteExistente = (await run(
            db,
            `INSERT INTO clientes (
                identidad_tipo, identidad_valor, nombre, celular,
                telefono_normalizado, vendedora_asignada, etapa_comercial
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                "telefono", "1123456789", "Cliente existente", "11 2345-6789",
                "1123456789", "vendedora_b", "Nuevo"
            ]
        )).lastID;
        cotizacionAjena = (await run(
            db,
            `INSERT INTO cotizaciones (
                cliente_id, nombre, celular, plan, valor, vendedora, estado,
                etapa_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clienteExistente, "Cliente existente", "1123456789", "Plata",
                "90000", "vendedora_b", "Nuevo", "Nuevos"
            ]
        )).lastID;
        clienteMaria = (await run(
            db,
            `INSERT INTO clientes (
                identidad_tipo, identidad_valor, nombre, celular,
                telefono_normalizado, vendedora_asignada, etapa_comercial
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                "dni", "30111222", "Cliente María", "11 3344-5566",
                null, "vendedora_b", "Nuevo"
            ]
        )).lastID;
        await run(
            db,
            `INSERT INTO cotizaciones (
                cliente_id, nombre, celular, plan, valor, vendedora, estado,
                etapa_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clienteMaria, "Cliente María", "11 3344-5566", "Oro",
                "120000", "vendedora_b", "Nuevo", "Nuevos"
            ]
        );
        await run(
            db,
            `INSERT INTO cotizaciones (
                cliente_id, nombre, celular, plan, valor, vendedora, estado,
                etapa_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                null, "Contacto sólo cotizado", "11 7788-9900", "Plata",
                "95000", "vendedora_b", "Nuevo", "Nuevos"
            ]
        );
        clienteSinCotizacion = (await run(
            db,
            `INSERT INTO clientes (
                identidad_tipo, identidad_valor, nombre, celular,
                telefono_normalizado, vendedora_asignada, etapa_comercial
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                "dni", "28999111", "Cliente sin cotización", "(011) 4455-6677",
                null, "vendedora_b", "Nuevo"
            ]
        )).lastID;
    } finally {
        await close(db);
    }

    const sellerA = token("vendedora_a", "vendedora");
    const sellerB = token("vendedora_b", "vendedora");
    const admin = token("admin", "admin");
    const telefonoNuevo = "+54 9 11 5555-0001";

    const dbPreview = openDatabase();
    const antesPreview = await get(
        dbPreview,
        "SELECT COUNT(*) AS total FROM primer_contacto_gestiones"
    );
    await close(dbPreview);

    const previewNuevo = await request(
        `/primer-contacto/buscar?telefono=${encodeURIComponent(telefonoNuevo)}`,
        sellerA
    );
    assert.strictEqual(previewNuevo.status, 200);
    assert.strictEqual(previewNuevo.body.estado, "nuevo");
    assert.strictEqual(previewNuevo.body.telefono_normalizado, "1155550001");

    const analisisSinEscritura = await request(
        "/primer-contacto/analizar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({ numeros: [telefonoNuevo, "11 5555-0002"] })
        }
    );
    assert.strictEqual(analisisSinEscritura.status, 200);

    const dbPostPreview = openDatabase();
    const despuesPreview = await get(
        dbPostPreview,
        "SELECT COUNT(*) AS total FROM primer_contacto_gestiones"
    );
    assert.strictEqual(despuesPreview.total, antesPreview.total);
    await close(dbPostPreview);

    const nuevoA = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: telefonoNuevo,
            nombre: "Contacto nuevo",
            observacion: "Primer intento",
            clave_idempotencia: "individual-nuevo-a-0001"
        })
    });
    assert.strictEqual(nuevoA.status, 201);
    assert.strictEqual(nuevoA.body.creada, true);

    const dobleClick = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: telefonoNuevo,
            nombre: "Contacto nuevo",
            observacion: "Primer intento",
            clave_idempotencia: "individual-nuevo-a-0001"
        })
    });
    assert.strictEqual(dobleClick.status, 200);
    assert.strictEqual(dobleClick.body.idempotente, true);

    const buscadoPorB = await request(
        "/primer-contacto/buscar?telefono=1155550001",
        sellerB
    );
    assert.strictEqual(buscadoPorB.body.estado, "contactado_por_otra");
    assert.deepStrictEqual(buscadoPorB.body.asesoras, ["vendedora_a"]);

    const mismoTelefonoB = await request("/primer-contacto", sellerB, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 5555-0001",
            clave_idempotencia: "individual-mismo-b-0001"
        })
    });
    assert.strictEqual(mismoTelefonoB.status, 201);

    const repetidoSinConfirmar = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: telefonoNuevo,
            clave_idempotencia: "individual-repetido-a-0002"
        })
    });
    assert.strictEqual(repetidoSinConfirmar.status, 409);

    const repetidoConfirmado = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: telefonoNuevo,
            confirmar_repetido: true,
            clave_idempotencia: "individual-repetido-a-0002"
        })
    });
    assert.strictEqual(repetidoConfirmado.status, 201);
    assert.strictEqual(repetidoConfirmado.body.analisis.cantidad_contactos, 3);

    const clienteDetectado = await request(
        "/primer-contacto/buscar?telefono=5491123456789",
        sellerA
    );
    assert.strictEqual(String(clienteDetectado.body.cliente.id), String(clienteExistente));
    assert.strictEqual(clienteDetectado.body.cliente.cantidad_cotizaciones, 1);

    const formatosMaria = [
        "11 3344 5566",
        "11 3344-5566",
        "1133445566",
        "01133445566",
        "011 3344 5566",
        "011 3344-5566",
        "+54 11 3344 5566",
        "+54 11 3344-5566",
        "+54 9 11 3344 5566",
        "5491133445566",
        "541133445566",
        "(011) 3344-5566"
    ];
    const dbAntesMaria = openDatabase();
    const identidadMariaAntes = await get(
        dbAntesMaria,
        `SELECT id FROM primer_contacto_identidades
         WHERE telefono_normalizado = ?`,
        ["1133445566"]
    );
    assert.strictEqual(identidadMariaAntes, undefined);
    await close(dbAntesMaria);

    for (const formato of formatosMaria) {
        const resultado = await request(
            `/primer-contacto/buscar?telefono=${encodeURIComponent(formato)}`,
            sellerA
        );
        assert.strictEqual(resultado.status, 200);
        assert.strictEqual(resultado.body.telefono_normalizado, "1133445566");
        assert.strictEqual(resultado.body.estado, "existe_en_crm");
        assert.strictEqual(resultado.body.existe_en_crm, true);
        assert.strictEqual(String(resultado.body.cliente.id), String(clienteMaria));
        assert.strictEqual(resultado.body.cantidad_cotizaciones_crm, 1);
    }

    const gestionMariaOtraAsesora = await request(
        "/primer-contacto",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                telefono: "01133445566",
                observacion: "Contacto sobre cliente ya cotizado",
                clave_idempotencia: "individual-maria-otra-asesora-0001"
            })
        }
    );
    assert.strictEqual(gestionMariaOtraAsesora.status, 201);
    assert.strictEqual(
        String(gestionMariaOtraAsesora.body.analisis.cliente.id),
        String(clienteMaria)
    );

    const formatosConQuince = [
        "11 15 1234-5678",
        "011 15 1234-5678",
        "+54 9 11 1234-5678",
        "5491112345678"
    ];
    for (const formato of formatosConQuince) {
        const resultado = await request(
            `/primer-contacto/buscar?telefono=${encodeURIComponent(formato)}`,
            sellerA
        );
        assert.strictEqual(resultado.body.telefono_normalizado, "1112345678");
    }

    const formatosInterior = [
        "0351 15 123-4567",
        "+54 9 351 123-4567",
        "5493511234567"
    ];
    for (const formato of formatosInterior) {
        const resultado = await request(
            `/primer-contacto/buscar?telefono=${encodeURIComponent(formato)}`,
            sellerA
        );
        assert.strictEqual(resultado.body.telefono_normalizado, "3511234567");
    }

    const numerosDiferentes = await request(
        "/primer-contacto/analizar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                numeros: ["11 1512-3456", "11 5123-4567"]
            })
        }
    );
    assert.strictEqual(numerosDiferentes.status, 200);
    assert.notStrictEqual(
        numerosDiferentes.body.resultados[0].telefono_normalizado,
        numerosDiferentes.body.resultados[1].telefono_normalizado
    );
    assert.notStrictEqual(
        numerosDiferentes.body.resultados[1].estado,
        "duplicado_tanda"
    );

    const variantesDuplicadas = await request(
        "/primer-contacto/analizar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                numeros: ["11 3344-5566", "01133445566"]
            })
        }
    );
    assert.strictEqual(variantesDuplicadas.status, 200);
    assert.strictEqual(variantesDuplicadas.body.resultados[0].existe_en_crm, true);
    assert.strictEqual(variantesDuplicadas.body.resultados[1].estado, "duplicado_tanda");

    const cotizacionSinCliente = await request(
        "/primer-contacto/buscar?telefono=01177889900",
        sellerA
    );
    assert.strictEqual(cotizacionSinCliente.status, 200);
    assert.strictEqual(cotizacionSinCliente.body.estado, "existe_en_crm");
    assert.strictEqual(cotizacionSinCliente.body.existe_en_crm, true);
    assert.strictEqual(cotizacionSinCliente.body.cliente, null);

    const registrarCotizacionSinCliente = await request(
        "/primer-contacto",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                telefono: "+54 11 7788-9900",
                clave_idempotencia: "individual-cotizacion-sin-cliente-0001"
            })
        }
    );
    assert.strictEqual(registrarCotizacionSinCliente.status, 201);
    assert.strictEqual(registrarCotizacionSinCliente.body.analisis.existe_en_crm, true);
    assert.strictEqual(registrarCotizacionSinCliente.body.analisis.cliente, null);

    const clienteSinCotizacionDetectado = await request(
        "/primer-contacto/buscar?telefono=541144556677",
        sellerA
    );
    assert.strictEqual(clienteSinCotizacionDetectado.status, 200);
    assert.strictEqual(clienteSinCotizacionDetectado.body.estado, "existe_en_crm");
    assert.strictEqual(
        String(clienteSinCotizacionDetectado.body.cliente.id),
        String(clienteSinCotizacion)
    );
    assert.strictEqual(clienteSinCotizacionDetectado.body.cantidad_cotizaciones_crm, 0);

    const dbClientesAntes = openDatabase();
    const cantidadClientesAntes = await get(
        dbClientesAntes,
        "SELECT COUNT(*) AS total FROM clientes"
    );
    await close(dbClientesAntes);

    const contactoClienteExistente = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: "+54 9 11 2345-6789",
            clave_idempotencia: "individual-cliente-a-0001"
        })
    });
    assert.strictEqual(contactoClienteExistente.status, 201);
    assert.strictEqual(
        String(contactoClienteExistente.body.analisis.cliente.id),
        String(clienteExistente)
    );

    const quince = Array.from(
        { length: 15 },
        (_, indice) => `11 6000-${String(1000 + indice).slice(-4)}`
    );
    const previewQuince = await request("/primer-contacto/analizar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({ numeros: quince })
    });
    assert.strictEqual(previewQuince.status, 200);
    assert.strictEqual(previewQuince.body.resultados.length, 15);

    const confirmarQuince = await request(
        "/primer-contacto/confirmar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                clave_operacion: "lote-exacto-quince-0001",
                items: quince.map(telefono => ({ telefono }))
            })
        }
    );
    assert.strictEqual(confirmarQuince.status, 200);
    assert.strictEqual(confirmarQuince.body.creadas, 15);

    const previewDieciseis = await request("/primer-contacto/analizar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({ numeros: [...quince, "11 7000-0001"] })
    });
    assert.strictEqual(previewDieciseis.status, 400);

    const previewRepetido = await request("/primer-contacto/analizar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({ numeros: ["11 6000-1000", "+54 9 11 6000-1000"] })
    });
    assert.strictEqual(previewRepetido.body.resultados[1].estado, "duplicado_tanda");

    const previewInvalido = await request("/primer-contacto/analizar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({ numeros: ["123"] })
    });
    assert.strictEqual(previewInvalido.body.resultados[0].estado, "invalido");

    const seleccionParcial = ["11 7000-1001", "11 7000-1002", "11 7000-1003"];
    const previewSeleccionParcial = await request(
        "/primer-contacto/analizar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({ numeros: seleccionParcial })
        }
    );
    assert.strictEqual(previewSeleccionParcial.status, 200);

    const confirmarDos = await request("/primer-contacto/confirmar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({
            clave_operacion: "lote-prueba-seleccion-0001",
            items: seleccionParcial.slice(0, 2).map(telefono => ({ telefono }))
        })
    });
    assert.strictEqual(confirmarDos.status, 200);
    assert.strictEqual(confirmarDos.body.creadas, 2);

    const confirmarDosRepetido = await request(
        "/primer-contacto/confirmar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                clave_operacion: "lote-prueba-seleccion-0001",
                items: seleccionParcial.slice(0, 2).map(telefono => ({ telefono }))
            })
        }
    );
    assert.strictEqual(confirmarDosRepetido.status, 200);
    assert.strictEqual(confirmarDosRepetido.body.creadas, 0);
    assert.strictEqual(confirmarDosRepetido.body.idempotentes, 2);

    const listaA = await request("/primer-contacto", sellerA);
    assert.ok(listaA.body.length >= 1);
    assert.ok(listaA.body.every(gestion => gestion.asesora === "vendedora_a"));

    const listaAdmin = await request("/primer-contacto", admin);
    assert.ok(listaAdmin.body.some(gestion => gestion.asesora === "vendedora_a"));
    assert.ok(listaAdmin.body.some(gestion => gestion.asesora === "vendedora_b"));

    const modificarAjeno = await request(
        `/primer-contacto/gestiones/${nuevoA.body.gestion_id}`,
        sellerB,
        { method: "PUT", body: JSON.stringify({ observacion: "No permitido" }) }
    );
    assert.strictEqual(modificarAjeno.status, 404);

    const editarCotizacionAjena = await request(
        `/cotizaciones/${cotizacionAjena}/seguimiento`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({ estado: "Contactado", fecha_seguimiento: null })
        }
    );
    assert.strictEqual(editarCotizacionAjena.status, 403);

    const cotizacionPropia = await request(
        `/clientes/${clienteExistente}/cotizaciones?termino=1123456789`,
        sellerA,
        {
            method: "POST",
            body: formularioCotizacion({
                nombre: "Cliente existente",
                celular: "1123456789"
            })
        }
    );
    assert.strictEqual(cotizacionPropia.status, 200);

    const dbFinal = openDatabase();
    try {
        const cantidadClientesFinal = await get(
            dbFinal,
            "SELECT COUNT(*) AS total FROM clientes"
        );
        assert.strictEqual(cantidadClientesFinal.total, cantidadClientesAntes.total);

        const identidadVinculada = await get(
            dbFinal,
            `SELECT cliente_id FROM primer_contacto_identidades
             WHERE telefono_normalizado = ?`,
            ["1123456789"]
        );
        assert.strictEqual(String(identidadVinculada.cliente_id), String(clienteExistente));

        const identidadMariaVinculada = await get(
            dbFinal,
            `SELECT cliente_id FROM primer_contacto_identidades
             WHERE telefono_normalizado = ?`,
            ["1133445566"]
        );
        assert.strictEqual(
            String(identidadMariaVinculada.cliente_id),
            String(clienteMaria)
        );

        const identidadCotizacionSinCliente = await get(
            dbFinal,
            `SELECT cliente_id FROM primer_contacto_identidades
             WHERE telefono_normalizado = ?`,
            ["1177889900"]
        );
        assert.strictEqual(identidadCotizacionSinCliente.cliente_id, null);

        const cotizacionGuardada = await get(
            dbFinal,
            "SELECT cliente_id, vendedora FROM cotizaciones WHERE id = ?",
            [cotizacionPropia.body.id]
        );
        assert.strictEqual(String(cotizacionGuardada.cliente_id), String(clienteExistente));
        assert.strictEqual(cotizacionGuardada.vendedora, "vendedora_a");

        const telefonosLote = await all(
            dbFinal,
            `SELECT identidades.telefono_normalizado
             FROM primer_contacto_gestiones gestiones
             JOIN primer_contacto_identidades identidades
                ON identidades.id = gestiones.contacto_id
             WHERE gestiones.clave_idempotencia LIKE 'lote:lote-prueba-seleccion-0001:%'`
        );
        assert.strictEqual(telefonosLote.length, 2);
    } finally {
        await close(dbFinal);
    }

    console.log(JSON.stringify({
        resultado: "OK",
        entorno: "SQLite temporal",
        pruebas: [
            "registrar teléfono nuevo",
            "normalización argentina reutilizada",
            "análisis individual y múltiple sin escritura",
            "registrar teléfono existente por otra asesora",
            "nuevo intento explícito de la misma asesora",
            "doble confirmación individual idempotente",
            "detectar cliente existente sin duplicarlo",
            "detectar cotización por teléfono sin identidad previa",
            "detectar cliente por teléfono original sin normalizado persistido",
            "variantes 0, +54, +54 9, espacios, guiones y paréntesis",
            "prefijo local 15 y códigos de área del interior",
            "evitar falsos duplicados con 15 dentro de diez dígitos",
            "vincular la gestión al cliente existente al guardar",
            "cotización sin cliente no crea un cliente automáticamente",
            "carga múltiple de exactamente 15 números",
            "rechazo total de 16 números",
            "repetidos dentro de la tanda",
            "número inválido",
            "confirmación registra sólo seleccionados",
            "doble confirmación múltiple idempotente",
            "vendedora lista sólo sus gestiones",
            "admin consulta todas las gestiones",
            "no existe edición de gestión ajena",
            "cotización ajena continúa protegida",
            "cotización propia sobre cliente compartido"
        ]
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
