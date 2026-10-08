#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");

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

async function requestExcel(pathname, authToken) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        headers: { Authorization: `Bearer ${authToken}` }
    });
    const buffer = await response.arrayBuffer();
    const workbook = new ExcelJS.Workbook();

    if (response.ok) await workbook.xlsx.load(buffer);
    return { status: response.status, workbook };
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
            procedencia_codigo: "base",
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
            procedencia_codigo: "base",
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

    const codigosProcedencia = [
        "base",
        "base_clinica",
        "publicidad_oficial",
        "publicidad_estacion",
        "calle",
        "oficina",
        "micaela_calle",
        "referido"
    ];
    const catalogoSeleccionable = await request("/primer-contacto/procedencias", sellerA);
    assert.strictEqual(catalogoSeleccionable.status, 200);
    assert.deepStrictEqual(
        catalogoSeleccionable.body.map(item => item.codigo),
        codigosProcedencia
    );
    assert.ok(catalogoSeleccionable.body.every(item => item.seleccionable === true));

    const sinProcedencia = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 8100-0001",
            clave_idempotencia: "sin-procedencia-0001"
        })
    });
    assert.strictEqual(sinProcedencia.status, 400);

    const sinInformarNuevo = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 8100-0002",
            procedencia_codigo: "sin_informar",
            clave_idempotencia: "sin-informar-nuevo-0001"
        })
    });
    assert.strictEqual(sinInformarNuevo.status, 400);

    for (const [indice, codigo] of codigosProcedencia.entries()) {
        const alta = await request("/primer-contacto", sellerA, {
            method: "POST",
            body: JSON.stringify({
                telefono: `11 82${String(indice).padStart(2, "0")}-0001`,
                procedencia_codigo: codigo,
                clave_idempotencia: `procedencia-${codigo}-0001`
            })
        });
        assert.strictEqual(alta.status, 201);
        assert.strictEqual(alta.body.analisis.procedencia.codigo, codigo);
    }

    const duplicadoMantieneProcedencia = await request("/primer-contacto", sellerB, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 8200-0001",
            procedencia_codigo: "referido",
            clave_idempotencia: "duplicado-mantiene-procedencia-0001"
        })
    });
    assert.strictEqual(duplicadoMantieneProcedencia.status, 201);
    assert.strictEqual(duplicadoMantieneProcedencia.body.analisis.procedencia.codigo, "base");

    const dbHistorico = openDatabase();
    let historicoId;
    try {
        const sinInformar = await get(
            dbHistorico,
            "SELECT id FROM procedencias WHERE codigo = 'sin_informar'"
        );
        historicoId = (await run(
            dbHistorico,
            `INSERT INTO primer_contacto_identidades
             (telefono_original, telefono_normalizado, procedencia_id)
             VALUES (?, ?, ?)`,
            ["11 8300-0001", "1183000001", sinInformar.id]
        )).lastID;
        await run(
            dbHistorico,
            `INSERT INTO primer_contacto_gestiones
             (contacto_id, asesora, clave_idempotencia)
             VALUES (?, ?, ?)`,
            [historicoId, "vendedora_a", "historico-sin-informar-0001"]
        );
    } finally {
        await close(dbHistorico);
    }
    const historicoDetectado = await request(
        "/primer-contacto/buscar?telefono=1183000001",
        sellerA
    );
    assert.strictEqual(historicoDetectado.body.procedencia.codigo, "sin_informar");
    const completarHistorico = await request(
        `/primer-contacto/${historicoId}/procedencia`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({ procedencia_codigo: "referido" })
        }
    );
    assert.strictEqual(completarHistorico.status, 200);
    assert.strictEqual(completarHistorico.body.procedencia.codigo, "referido");
    const reemplazoNoPermitido = await request(
        `/primer-contacto/${historicoId}/procedencia`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({ procedencia_codigo: "calle" })
        }
    );
    assert.strictEqual(reemplazoNoPermitido.status, 409);

    const contactoMarcas = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 8400-0001",
            procedencia_codigo: "base_clinica",
            clave_idempotencia: "contactabilidad-alta-0001"
        })
    });
    const contactoMarcasId = contactoMarcas.body.analisis.contacto_id;
    const activarNoInteresa = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_interesa",
                valor: true,
                clave_idempotencia: "no-interesa-on-0001"
            })
        }
    );
    assert.strictEqual(activarNoInteresa.status, 200);
    const quitarNoInteresa = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_interesa",
                valor: false,
                clave_idempotencia: "no-interesa-off-0001"
            })
        }
    );
    assert.strictEqual(quitarNoInteresa.status, 200);

    const activarNoEnviar = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_enviar_mensajes",
                valor: true,
                clave_idempotencia: "no-enviar-on-0001"
            })
        }
    );
    assert.strictEqual(activarNoEnviar.status, 200);
    const quitarNoEnviarAsesora = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        sellerA,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_enviar_mensajes",
                valor: false,
                motivo: "Pedido de la persona",
                clave_idempotencia: "no-enviar-off-asesora-0001"
            })
        }
    );
    assert.strictEqual(quitarNoEnviarAsesora.status, 403);
    const quitarNoEnviarSinMotivo = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        admin,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_enviar_mensajes",
                valor: false,
                confirmar_retiro: true,
                clave_idempotencia: "no-enviar-off-admin-sin-motivo-0001"
            })
        }
    );
    assert.strictEqual(quitarNoEnviarSinMotivo.status, 400);

    const bloqueadoBusqueda = await request(
        "/primer-contacto/buscar?telefono=1184000001",
        sellerB
    );
    assert.strictEqual(bloqueadoBusqueda.body.no_enviar_mensajes, true);
    assert.strictEqual(bloqueadoBusqueda.body.seleccion_recomendada, false);
    const bloqueadoGestion = await request("/primer-contacto", sellerB, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 8400-0001",
            confirmar_repetido: true,
            clave_idempotencia: "bloqueado-gestion-0001"
        })
    });
    assert.strictEqual(bloqueadoGestion.status, 409);
    const bloqueadoTanda = await request("/primer-contacto/analizar-multiple", sellerB, {
        method: "POST",
        body: JSON.stringify({
            numeros: ["11 8400-0001", "11 8400-0002"],
            procedencia_codigo: "calle"
        })
    });
    assert.strictEqual(bloqueadoTanda.status, 200);
    assert.strictEqual(bloqueadoTanda.body.resultados[0].no_enviar_mensajes, true);
    assert.strictEqual(bloqueadoTanda.body.resultados[0].seleccion_recomendada, false);
    const confirmarBloqueadoTanda = await request(
        "/primer-contacto/confirmar-multiple",
        sellerB,
        {
            method: "POST",
            body: JSON.stringify({
                clave_operacion: "lote-con-bloqueado-0001",
                procedencia_codigo: "calle",
                items: [{
                    telefono: "11 8400-0001",
                    confirmar_repetido: true
                }]
            })
        }
    );
    assert.strictEqual(confirmarBloqueadoTanda.status, 409);

    const quitarNoEnviarAdmin = await request(
        `/primer-contacto/${contactoMarcasId}/contactabilidad`,
        admin,
        {
            method: "PUT",
            body: JSON.stringify({
                marca: "no_enviar_mensajes",
                valor: false,
                motivo: "La persona revocó expresamente la restricción",
                confirmar_retiro: true,
                clave_idempotencia: "no-enviar-off-admin-0001"
            })
        }
    );
    assert.strictEqual(quitarNoEnviarAdmin.status, 200);
    const marcasAuditadas = await request(
        "/primer-contacto/buscar?telefono=1184000001",
        sellerA
    );
    assert.ok(marcasAuditadas.body.historial_contactabilidad.length >= 4);
    assert.ok(marcasAuditadas.body.historial_contactabilidad.some(item =>
        item.motivo === "La persona revocó expresamente la restricción"
    ));

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
        assert.deepStrictEqual(resultado.body.cotizaciones_por_asesora, [{
            asesora: "vendedora_b",
            cantidad: 1
        }]);
        assert.strictEqual(resultado.body.afiliado, false);
    }

    const gestionMariaOtraAsesora = await request(
        "/primer-contacto",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                telefono: "01133445566",
                observacion: "Contacto sobre cliente ya cotizado",
                procedencia_codigo: "referido",
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
                procedencia_codigo: "publicidad_oficial",
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
    assert.strictEqual(clienteSinCotizacionDetectado.body.cotizado, false);
    assert.strictEqual(clienteSinCotizacionDetectado.body.afiliado, false);

    const contactoClienteSinCotizacion = await request("/primer-contacto", sellerA, {
        method: "POST",
        body: JSON.stringify({
            telefono: "11 4455-6677",
            procedencia_codigo: "base_clinica",
            clave_idempotencia: "cliente-sin-cotizacion-0001"
        })
    });
    assert.strictEqual(contactoClienteSinCotizacion.status, 201);
    assert.strictEqual(contactoClienteSinCotizacion.body.analisis.cotizado, false);
    assert.strictEqual(contactoClienteSinCotizacion.body.analisis.afiliado, false);

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
            procedencia_codigo: "oficina",
            clave_idempotencia: "individual-cliente-a-0001"
        })
    });
    assert.strictEqual(contactoClienteExistente.status, 201);
    assert.strictEqual(
        String(contactoClienteExistente.body.analisis.cliente.id),
        String(clienteExistente)
    );

    const numerosLote = (cantidad, bloque) => Array.from(
        { length: cantidad },
        (_, indice) => `11 ${bloque}-${String(indice + 1).padStart(4, "0")}`
    );
    const cantidadesPermitidas = [1, 10, 15, 29, 30, 50];

    for (const [indice, cantidad] of cantidadesPermitidas.entries()) {
        const numeros = numerosLote(cantidad, String(6100 + indice * 100));
        const preview = await request("/primer-contacto/analizar-multiple", sellerA, {
            method: "POST",
            body: JSON.stringify({ numeros })
        });
        assert.strictEqual(preview.status, 200);
        assert.strictEqual(preview.body.limite, 50);
        assert.strictEqual(preview.body.resultados.length, cantidad);
    }

    const cincuenta = numerosLote(50, "6700");
    const confirmarCincuenta = await request(
        "/primer-contacto/confirmar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                clave_operacion: "lote-exacto-cincuenta-0001",
                procedencia_codigo: "calle",
                items: cincuenta.map(telefono => ({ telefono }))
            })
        }
    );
    assert.strictEqual(confirmarCincuenta.status, 200);
    assert.strictEqual(confirmarCincuenta.body.creadas, 50);

    const cincuentaUno = numerosLote(51, "6800");
    const previewCincuentaUno = await request("/primer-contacto/analizar-multiple", sellerA, {
        method: "POST",
        body: JSON.stringify({ numeros: cincuentaUno })
    });
    assert.strictEqual(previewCincuentaUno.status, 400);
    assert.strictEqual(
        previewCincuentaUno.body.error,
        "Podés cargar un máximo de 50 números por vez."
    );

    const confirmarCincuentaUno = await request(
        "/primer-contacto/confirmar-multiple",
        sellerA,
        {
            method: "POST",
            body: JSON.stringify({
                clave_operacion: "lote-rechazado-cincuenta-uno-0001",
                procedencia_codigo: "calle",
                items: cincuentaUno.map(telefono => ({ telefono }))
            })
        }
    );
    assert.strictEqual(confirmarCincuentaUno.status, 400);

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
            procedencia_codigo: "base_clinica",
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
                procedencia_codigo: "base_clinica",
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
    const listaAdminB = await request(
        "/primer-contacto?asesora=vendedora_b",
        admin
    );
    assert.ok(listaAdminB.body.length >= 1);
    assert.ok(listaAdminB.body.every(gestion => gestion.asesora === "vendedora_b"));
    const listaVendedoraForzada = await request(
        "/primer-contacto?asesora=vendedora_b",
        sellerA
    );
    assert.ok(
        listaVendedoraForzada.body.every(gestion => gestion.asesora === "vendedora_a")
    );

    const resumenVendedora = await request("/primer-contacto/resumen", sellerA);
    assert.strictEqual(resumenVendedora.status, 200);
    const resumenBaseVendedora = resumenVendedora.body.procedencias.find(
        item => item.codigo === "base"
    );
    assert.strictEqual(resumenBaseVendedora.cantidad, 2);
    const resumenAdminB = await request(
        "/primer-contacto/resumen?asesora=vendedora_b",
        admin
    );
    assert.strictEqual(resumenAdminB.status, 200);
    const resumenBaseAdminB = resumenAdminB.body.procedencias.find(
        item => item.codigo === "base"
    );
    assert.strictEqual(resumenBaseAdminB.cantidad, 2);

    const dbExportacion = openDatabase();
    try {
        await run(
            dbExportacion,
            "UPDATE primer_contacto_gestiones SET fecha = ? WHERE id = ?",
            ["2026-08-10 14:30:00", nuevoA.body.gestion_id]
        );
        await run(
            dbExportacion,
            "UPDATE primer_contacto_gestiones SET fecha = ? WHERE id = ?",
            ["2026-08-15 09:45:00", repetidoConfirmado.body.gestion_id]
        );
        await run(
            dbExportacion,
            "UPDATE primer_contacto_gestiones SET fecha = ? WHERE id = ?",
            ["2026-08-16 11:20:00", mismoTelefonoB.body.gestion_id]
        );
    } finally {
        await close(dbExportacion);
    }

    const excelVendedora = await requestExcel(
        "/primer-contacto/exportar-excel?asesora=vendedora_b",
        sellerA
    );
    assert.strictEqual(excelVendedora.status, 200);
    const hojaVendedora = excelVendedora.workbook.getWorksheet("Primer contacto");
    assert.deepStrictEqual(
        hojaVendedora.getRow(1).values.slice(1),
        [
            "Fecha",
            "Hora",
            "Asesora",
            "Nombre",
            "Teléfono",
            "Teléfono normalizado",
            "Cliente vinculado",
            "Cliente ID",
            "Cotizaciones vinculadas"
        ]
    );
    assert.ok(!hojaVendedora.getRow(1).values.includes("Observación"));
    const filasVendedora = hojaVendedora
        .getRows(2, 1000)
        .filter(row => row?.actualCellCount > 0);
    assert.ok(filasVendedora.length >= 2);
    assert.ok(filasVendedora.every(row => row.getCell(3).value === "vendedora_a"));
    assert.strictEqual(
        filasVendedora.filter(row => row.getCell(6).value === "1155550001").length,
        2
    );
    const telefonosLoteExportados = new Set(
        filasVendedora
            .map(row => String(row.getCell(6).value || ""))
            .filter(telefono => /^116700\d{4}$/.test(telefono))
    );
    assert.strictEqual(telefonosLoteExportados.size, 50);
    assert.ok(cincuenta.every(telefono =>
        telefonosLoteExportados.has(telefono.replace(/\D/g, ""))
    ));

    const excelAdmin = await requestExcel("/primer-contacto/exportar-excel", admin);
    assert.strictEqual(excelAdmin.status, 200);
    const filasAdmin = excelAdmin.workbook
        .getWorksheet("Primer contacto")
        .getRows(2, 1000)
        .filter(row => row?.actualCellCount > 0);
    assert.ok(filasAdmin.some(row => row.getCell(3).value === "vendedora_a"));
    assert.ok(filasAdmin.some(row => row.getCell(3).value === "vendedora_b"));

    const excelAdminB = await requestExcel(
        "/primer-contacto/exportar-excel?asesora=vendedora_b",
        admin
    );
    assert.strictEqual(excelAdminB.status, 200);
    const filasAdminB = excelAdminB.workbook
        .getWorksheet("Primer contacto")
        .getRows(2, 1000)
        .filter(row => row?.actualCellCount > 0);
    assert.ok(filasAdminB.length >= 1);
    assert.ok(filasAdminB.every(row => row.getCell(3).value === "vendedora_b"));

    const excelFecha = await requestExcel(
        "/primer-contacto/exportar-excel?fecha_desde=2026-08-16&fecha_hasta=2026-08-16",
        admin
    );
    assert.strictEqual(excelFecha.status, 200);
    const filasFecha = excelFecha.workbook
        .getWorksheet("Primer contacto")
        .getRows(2, 1000)
        .filter(row => row?.actualCellCount > 0);
    assert.strictEqual(filasFecha.length, 1);
    assert.strictEqual(filasFecha[0].getCell(3).value, "vendedora_b");

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

    const numeroCotizadoVariasAsesoras = await request(
        "/primer-contacto/buscar?telefono=1123456789",
        sellerA
    );
    assert.strictEqual(numeroCotizadoVariasAsesoras.status, 200);
    assert.strictEqual(numeroCotizadoVariasAsesoras.body.cantidad_cotizaciones_crm, 2);
    assert.deepStrictEqual(
        [...numeroCotizadoVariasAsesoras.body.asesoras_cotizaciones].sort(),
        ["vendedora_a", "vendedora_b"]
    );
    assert.deepStrictEqual(
        [...numeroCotizadoVariasAsesoras.body.cotizaciones_por_asesora]
            .sort((a, b) => a.asesora.localeCompare(b.asesora)),
        [
            { asesora: "vendedora_a", cantidad: 1 },
            { asesora: "vendedora_b", cantidad: 1 }
        ]
    );
    assert.strictEqual(numeroCotizadoVariasAsesoras.body.afiliado, false);

    const dbEstadosComerciales = openDatabase();
    try {
        await run(
            dbEstadosComerciales,
            `INSERT INTO cotizaciones (
                cliente_id, nombre, celular, plan, valor, vendedora, estado,
                etapa_pipeline
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clienteMaria, "Cliente María", "11 3344-5566", "Oro",
                "125000", "vendedora_b", "Afiliado", "Afiliados"
            ]
        );
    } finally {
        await close(dbEstadosComerciales);
    }

    const numeroAfiliadoMismaAsesora = await request(
        "/primer-contacto/buscar?telefono=1133445566",
        sellerA
    );
    assert.strictEqual(numeroAfiliadoMismaAsesora.status, 200);
    assert.strictEqual(numeroAfiliadoMismaAsesora.body.cotizado, true);
    assert.strictEqual(numeroAfiliadoMismaAsesora.body.afiliado, true);
    assert.strictEqual(numeroAfiliadoMismaAsesora.body.cantidad_cotizaciones_crm, 2);
    assert.deepStrictEqual(numeroAfiliadoMismaAsesora.body.cotizaciones_por_asesora, [{
        asesora: "vendedora_b",
        cantidad: 2
    }]);

    const [estadosVendedora, estadosAdmin] = await Promise.all([
        request("/primer-contacto", sellerA),
        request("/primer-contacto", admin)
    ]);
    const buscarEstado = (respuesta, telefono) =>
        respuesta.body.find(item => item.telefono_normalizado === telefono);
    const mariaVendedora = buscarEstado(estadosVendedora, "1133445566");
    const mariaAdmin = buscarEstado(estadosAdmin, "1133445566");
    assert.ok(mariaVendedora);
    assert.ok(mariaAdmin);
    assert.strictEqual(mariaVendedora.afiliado, true);
    assert.strictEqual(mariaAdmin.afiliado, true);
    assert.strictEqual(mariaVendedora.cantidad_cotizaciones_crm, 2);
    assert.strictEqual(mariaAdmin.cantidad_cotizaciones_crm, 2);

    const soloPrimerContacto = buscarEstado(estadosVendedora, "1155550001");
    const clienteSinCotizacionListado = buscarEstado(estadosVendedora, "1144556677");
    assert.ok(soloPrimerContacto);
    assert.ok(clienteSinCotizacionListado);
    assert.strictEqual(soloPrimerContacto.cotizado, false);
    assert.strictEqual(soloPrimerContacto.afiliado, false);
    assert.strictEqual(clienteSinCotizacionListado.cotizado, false);
    assert.strictEqual(clienteSinCotizacionListado.afiliado, false);

    const scriptFrontend = fs.readFileSync(
        path.join(repoRoot, "public", "script.js"),
        "utf8"
    );
    const htmlFrontend = fs.readFileSync(
        path.join(repoRoot, "public", "app.html"),
        "utf8"
    );
    assert.ok(!scriptFrontend.includes("wa.me"));
    assert.ok(!htmlFrontend.includes("wa.me"));
    assert.ok(!scriptFrontend.includes("Cliente CRM"));
    assert.ok(scriptFrontend.includes("Cotizado por:"));
    assert.ok(scriptFrontend.includes("estado-afiliado"));
    const inicioFormateadorPrimerContacto = scriptFrontend.indexOf(
        "function formatearFechaHoraPrimerContacto"
    );
    const finFormateadorPrimerContacto = scriptFrontend.indexOf(
        "let cotizacionModalTrigger",
        inicioFormateadorPrimerContacto
    );
    const codigoFormateadorPrimerContacto = scriptFrontend.slice(
        inicioFormateadorPrimerContacto,
        finFormateadorPrimerContacto
    );
    const formatearFechaHoraPrimerContactoPrueba = new Function(
        `${codigoFormateadorPrimerContacto}; return formatearFechaHoraPrimerContacto;`
    )();
    assert.strictEqual(
        formatearFechaHoraPrimerContactoPrueba("2026-10-08T02:54:00.000Z"),
        "07/10/2026 - 23:54"
    );
    assert.strictEqual(
        formatearFechaHoraPrimerContactoPrueba("2026-10-07T03:04:00.000Z"),
        "07/10/2026 - 00:04"
    );
    const codigoPrimerContacto = scriptFrontend.slice(
        scriptFrontend.indexOf("let primerContactoIndividualEnCurso"),
        scriptFrontend.indexOf("// INIT")
    );
    assert.ok(!codigoPrimerContacto.includes("formatearFecha("));
    assert.ok(!/\b(Hoy|Ayer|a\. m\.|p\. m\.)\b/.test(codigoPrimerContacto));

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
            "ocho procedencias seleccionables y Sin informar sólo histórico",
            "procedencia obligatoria y alta individual con cada procedencia",
            "duplicado conserva su procedencia original",
            "completar procedencia histórica sin reemplazo libre",
            "No le interesa reversible y auditado",
            "No enviar mensajes bloquea nuevas gestiones",
            "asesora no retira bloqueo y Administración requiere confirmación y motivo",
            "búsqueda y tanda identifican números bloqueados",
            "carga múltiple acepta 1, 10, 15, 29, 30 y 50 números",
            "confirmación registra exactamente 50 números con una procedencia",
            "rechazo total de 51 números en análisis y confirmación",
            "repetidos dentro de la tanda",
            "número inválido",
            "confirmación registra sólo seleccionados",
            "doble confirmación múltiple idempotente",
            "vendedora lista sólo sus gestiones",
            "admin consulta todas las gestiones",
            "resumen por procedencia cuenta teléfonos únicos",
            "filtro administrativo por asesora",
            "vendedora exporta solo sus propias gestiones",
            "Excel no contiene la columna Observación",
            "los 50 teléfonos de una carga múltiple aparecen una sola vez en el Excel",
            "admin exporta todas las gestiones o filtra por asesora",
            "exportacion respeta el filtro de fecha",
            "cada gestion del mismo telefono ocupa una fila del Excel",
            "no existe edición de gestión ajena",
            "cotización ajena continúa protegida",
            "cotización propia sobre cliente compartido",
            "número cotizado muestra cantidad y asesoras",
            "cliente sin cotización no recibe estado técnico ni Cotizado",
            "varias cotizaciones de una asesora se agrupan por cantidad",
            "cotizaciones de distintas asesoras conservan un único teléfono",
            "Afiliado se deriva del estado comercial existente y tiene prioridad",
            "administradora y vendedora reciben los mismos estados permitidos",
            "fechas visibles de Primer Contacto usan DD/MM/AAAA - HH:mm en Buenos Aires",
            "ausencia de enlaces funcionales de WhatsApp"
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
