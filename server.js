const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
const ExcelJS = require("exceljs");
const {
    CLAVES_TAREAS_POSVENTA,
    ESTADOS_POSVENTA,
    calcularSeguimientoPosventa,
    esFechaIsoValida,
    sumarMesesCalendario
} = require("./lib/posventa");

const app = express();
const SECRET = process.env.JWT_SECRET || "secreto_ultra_seguro";
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDir = path.join(__dirname, "public", "uploads");
const extensionesImagen = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp"
]);
const tiposImagen = new Set([
    "image/jpeg",
    "image/pjpeg",
    "image/png",
    "image/webp"
]);
fs.mkdirSync(uploadsDir, { recursive: true });

// 👉 MIDDLEWARES
app.use(cors());
app.use(express.json());

// Los adjuntos se sirven mediante una ruta autenticada mas abajo. Evitar que
// express.static permita acceder a public/uploads con una URL conocida.
app.use("/uploads", (req, res) => {
    res.status(404).json({ error: "Recurso no encontrado" });
});

function dbRunAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGetAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAllAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

const usuariosOrdenReady = (async () => {
    try {
        if (db.type === "postgres") {
            await dbRunAsync("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS orden_login INTEGER");
        }
    } catch (error) {
        console.error("[usuarios] no se pudo preparar orden_login:", error.message);
    }
})();

const ordenLoginSql = `
    CASE WHEN orden_login IS NULL THEN 1 ELSE 0 END,
    orden_login ASC,
    LOWER(TRIM(usuario)) ASC
`;

app.get("/login-usuarios", async (req, res) => {
    await usuariosOrdenReady;

    db.all(
        `SELECT id, TRIM(usuario) AS usuario, rol FROM usuarios ORDER BY ${ordenLoginSql}`,
        [],
        (err, rows) => {
            if (err) {
                console.error("[login-usuarios] error db:", err.message);
                return res.status(500).json({ error: "No se pudieron cargar los usuarios" });
            }

            console.log("[login-usuarios] usuarios encontrados:", rows.length);
            res.json(rows);
        }
    );
});

app.use(express.static("public"));

// 👉 BASE DE DATOS
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },

    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const nombreUnico = [
            Date.now(),
            Math.round(Math.random() * 1e9)
        ].join("-");

        cb(null, `${nombreUnico}${extension}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const esImagen =
            extensionesImagen.has(extension) &&
            tiposImagen.has(file.mimetype);

        if (!esImagen) {
            const error = new Error(
                "Solo se permiten imágenes JPG, JPEG, PNG o WEBP"
            );
            error.code = "TIPO_ARCHIVO_INVALIDO";
            cb(error);
            return;
        }

        cb(null, true);
    }
});

const ESTADOS_COTIZACION = [
    "Nuevo",
    "Contactado",
    "Pendiente de pago",
    "No responde",
    "Afiliado",
    "Perdido",
    "Anulada"
];

const ETAPAS_PIPELINE = [
    "Nuevos",
    "Contactados",
    "Interesados",
    "Documentación",
    "Auditoría",
    "Afiliados"
];

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

const TIPOS_TAREA_CRM = [
    "tarea",
    "seguimiento",
    "recordatorio"
];

const ESTADOS_TAREA_CRM = [
    "pendiente",
    "realizada",
    "cancelada"
];

const CODIGOS_PROCEDENCIA_SELECCIONABLES = [
    "base",
    "base_clinica",
    "publicidad_oficial",
    "publicidad_estacion",
    "calle",
    "oficina",
    "micaela_calle",
    "referido"
];

const MARCAS_CONTACTABILIDAD = [
    "no_interesa",
    "no_enviar_mensajes"
];

const ESTADOS_AFILIADO_LEGACY = [
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xf3),
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xc3, 0xb3),
    String.fromCharCode(0x41, 0x62, 0x6f, 0x6e, 0xc3, 0x83, 0xc2, 0xb3),
    String.fromCharCode(
        0x41,
        0x62,
        0x6f,
        0x6e,
        0xc3,
        0x83,
        0xc6,
        0x92,
        0xc3,
        0x82,
        0xc2,
        0xb3
    )
];

const ESTADOS_AFILIADO_LEGACY_SQL = ESTADOS_AFILIADO_LEGACY
    .map(estado => `'${estado.replace(/'/g, "''")}'`)
    .join(", ");
const ESTADOS_CIERRE_NEGATIVO_SQL = ESTADOS_CIERRE_NEGATIVO
    .map(estado => `'${estado.replace(/'/g, "''")}'`)
    .join(", ");
const OPORTUNIDAD_ACTIVA_SQL = `
    LOWER(TRIM(COALESCE(cotizaciones.estado, '')))
    NOT IN (${ESTADOS_CIERRE_NEGATIVO_SQL})
`;

const ESTADO_COTIZACION_SQL = `
    CASE
        WHEN estado IN (${ESTADOS_AFILIADO_LEGACY_SQL}) THEN 'Afiliado'
        ELSE COALESCE(NULLIF(estado, ''), 'Nuevo')
    END
`;

const SELECT_COTIZACIONES = `
    SELECT
        cotizaciones.*,
        ${ESTADO_COTIZACION_SQL} AS estado
    FROM cotizaciones
`;

function normalizarEstadoCotizacion(estado) {
    const valor = String(estado || "").trim();

    if (!valor) return "Nuevo";

    return ESTADOS_AFILIADO_LEGACY.includes(valor)
        ? "Afiliado"
        : valor;
}

function normalizarEtapaPipeline(etapa) {
    const valor = String(etapa || "").trim();

    return ETAPAS_PIPELINE.includes(valor)
        ? valor
        : "Nuevos";
}

function normalizarTelefono(valor) {
    let numero = String(valor || "").replace(/\D/g, "");

    if (!numero) return "";

    if (numero.startsWith("00")) {
        numero = numero.slice(2);
    }

    if (numero.startsWith("549")) {
        numero = numero.slice(3);
    } else if (numero.startsWith("54")) {
        numero = numero.slice(2);
    }

    while (numero.startsWith("0")) {
        numero = numero.slice(1);
    }

    const candidatas = new Set();

    if (/^\d{10}$/.test(numero)) {
        candidatas.add(numero);
    }

    // El 15 historico solo se elimina cuando sobran exactamente esos dos
    // digitos y el resultado es un numero nacional argentino de 10 digitos.
    if (numero.length === 12) {
        for (let posicion = 2; posicion <= 4; posicion++) {
            if (numero.slice(posicion, posicion + 2) !== "15") continue;

            const sinPrefijoLocal =
                numero.slice(0, posicion) + numero.slice(posicion + 2);

            if (/^\d{10}$/.test(sinPrefijoLocal)) {
                candidatas.add(sinPrefijoLocal);
            }
        }
    }

    const opciones = [...candidatas];
    return opciones.length === 1 ? opciones[0] : numero;
}

function normalizarDni(valor) {
    const dni = String(valor || "").trim();
    return dni || null;
}

function normalizarDniIdentidad(valor) {
    const dni = String(valor || "").replace(/\D/g, "");
    return dni || null;
}

function identidadClienteDesdeDatos({ dni, celular } = {}) {
    const dniNormalizado = normalizarDniIdentidad(dni);

    if (dniNormalizado) {
        return {
            tipo: "dni",
            valor: dniNormalizado
        };
    }

    const telefonoNormalizado = normalizarTelefono(celular);

    if (telefonoNormalizado) {
        return {
            tipo: "telefono",
            valor: telefonoNormalizado
        };
    }

    return null;
}

function identidadBusquedaSegura(termino) {
    const texto = String(termino || "").trim();
    const digitos = texto.replace(/\D/g, "");

    if (!texto || !digitos) {
        return null;
    }

    const pareceDni =
        /^\d{7,8}$/.test(digitos) &&
        !/[+()]/.test(texto) &&
        normalizarTelefono(texto).length <= 8;

    if (pareceDni) {
        return {
            tipo: "dni",
            valor: digitos
        };
    }

    const telefonoNormalizado = normalizarTelefono(texto);

    if (telefonoNormalizado && telefonoNormalizado.length >= 8) {
        return {
            tipo: "telefono",
            valor: telefonoNormalizado
        };
    }

    return null;
}

function esBusquedaIdentidadValida(termino) {
    return Boolean(identidadBusquedaSegura(termino));
}

function compactarSql(sql) {
    return String(sql || "").replace(/\s+/g, " ").trim();
}

function resumirCotizacionesParaLog(cotizaciones = []) {
    return cotizaciones.slice(0, 5).map(cotizacion => ({
        id: cotizacion.id,
        dni: cotizacion.dni,
        celular: cotizacion.celular,
        celularNormalizado: normalizarTelefono(cotizacion.celular),
        estado: cotizacion.estado,
        vendedora: cotizacion.vendedora
    }));
}

function diagnosticarCoincidenciasTelefono(cotizaciones = [], termino) {
    return cotizaciones.slice(0, 10).map(cotizacion => ({
        id: cotizacion.id,
        dni: cotizacion.dni,
        celular: cotizacion.celular,
        celularNormalizado: normalizarTelefono(cotizacion.celular),
        termino,
        terminoNormalizado: normalizarTelefono(termino),
        coincide: coincideTelefono(cotizacion.celular, termino)
    }));
}

function normalizarCotizacion(cotizacion) {
    return {
        ...cotizacion,
        estado: normalizarEstadoCotizacion(cotizacion.estado)
    };
}

function normalizarCotizaciones(cotizaciones) {
    return cotizaciones.map(normalizarCotizacion);
}

async function obtenerUsuarioPorNombre(nombreUsuario, tx = null) {
    const store = tx || {
        get: dbGetAsync
    };

    return store.get(
        `
        SELECT id, TRIM(usuario) AS usuario, rol
        FROM usuarios
        WHERE LOWER(TRIM(usuario)) = LOWER(TRIM(?))
        LIMIT 1
        `,
        [nombreUsuario]
    );
}

async function buscarClientePorIdentidad(identidad, tx = null) {
    if (!identidad) return null;

    const store = tx || {
        get: dbGetAsync
    };

    const columnaNormalizada = identidad.tipo === "dni"
        ? "dni_normalizado"
        : "telefono_normalizado";

    return store.get(
        `
        SELECT *
        FROM clientes
        WHERE (
                identidad_tipo = ?
                AND identidad_valor = ?
              )
           OR ${columnaNormalizada} = ?
        ORDER BY id ASC
        LIMIT 1
        `,
        [identidad.tipo, identidad.valor, identidad.valor]
    );
}

function identidadesNormalizadasCliente(datosCliente = {}) {
    return {
        dni: normalizarDniIdentidad(datosCliente.dni),
        telefono: normalizarTelefono(datosCliente.celular)
    };
}

function clienteTieneIdentidad(cliente, tipo, valor) {
    if (!cliente || !valor) return false;

    const columna = tipo === "dni" ? "dni_normalizado" : "telefono_normalizado";

    return cliente[columna] === valor
        || (
            cliente.identidad_tipo === tipo
            && cliente.identidad_valor === valor
        );
}

async function buscarClientesPorIdentidades(datosCliente, tx, excluirClienteId = null) {
    const identidades = identidadesNormalizadasCliente(datosCliente);
    const condiciones = [];
    const parametros = [];

    if (identidades.dni) {
        condiciones.push(`(
            dni_normalizado = ?
            OR (identidad_tipo = 'dni' AND identidad_valor = ?)
        )`);
        parametros.push(identidades.dni, identidades.dni);
    }

    if (identidades.telefono) {
        condiciones.push(`(
            telefono_normalizado = ?
            OR (identidad_tipo = 'telefono' AND identidad_valor = ?)
        )`);
        parametros.push(identidades.telefono, identidades.telefono);
    }

    if (!condiciones.length) return [];

    const condicionIdentidades = condiciones.join(" OR ");
    if (excluirClienteId) parametros.push(excluirClienteId);

    return tx.all(
        `
        SELECT *
        FROM clientes
        WHERE (${condicionIdentidades})
        ${excluirClienteId ? "AND id <> ?" : ""}
        ORDER BY id ASC
        `,
        parametros
    );
}

function describirConflictoIdentidad(clientes, identidades) {
    const conflictoDni = identidades.dni && clientes.some(cliente =>
        clienteTieneIdentidad(cliente, "dni", identidades.dni)
    );
    const conflictoTelefono = identidades.telefono && clientes.some(cliente =>
        clienteTieneIdentidad(cliente, "telefono", identidades.telefono)
    );

    if (conflictoDni && conflictoTelefono) {
        return "El DNI y el teléfono ingresados pertenecen a otro cliente";
    }
    if (conflictoDni) return "El DNI ingresado pertenece a otro cliente";
    return "El teléfono ingresado pertenece a otro cliente";
}

async function verificarConflictoPrimerContacto(
    tx,
    telefonoNormalizado,
    clienteId = null
) {
    if (!telefonoNormalizado) return;

    const identidad = await tx.get(
        `
        SELECT id, cliente_id
        FROM primer_contacto_identidades
        WHERE telefono_normalizado = ?
        LIMIT 1
        `,
        [telefonoNormalizado]
    );

    if (
        identidad?.cliente_id
        && String(identidad.cliente_id) !== String(clienteId || "")
    ) {
        throw errorHttp(
            409,
            "El teléfono ingresado ya está vinculado a otro cliente en Primer contacto"
        );
    }
}

async function completarClienteConDatos(tx, cliente, datosCliente) {
    const identidades = identidadesNormalizadasCliente(datosCliente);
    const dniExistente = normalizarDniIdentidad(cliente.dni_normalizado || cliente.dni);
    const telefonoExistente = normalizarTelefono(
        cliente.telefono_normalizado || cliente.celular
    );

    if (identidades.dni && dniExistente && identidades.dni !== dniExistente) {
        throw errorHttp(409, "El DNI no coincide con el cliente seleccionado");
    }
    if (
        identidades.telefono
        && telefonoExistente
        && identidades.telefono !== telefonoExistente
    ) {
        throw errorHttp(409, "El teléfono no coincide con el cliente seleccionado");
    }

    const conflictos = await buscarClientesPorIdentidades(
        datosCliente,
        tx,
        cliente.id
    );
    if (conflictos.length) {
        throw errorHttp(409, describirConflictoIdentidad(conflictos, identidades));
    }

    await verificarConflictoPrimerContacto(
        tx,
        identidades.telefono,
        cliente.id
    );

    await tx.run(
        `
        UPDATE clientes
        SET
            dni = COALESCE(dni, ?),
            dni_normalizado = COALESCE(dni_normalizado, ?),
            nombre = COALESCE(nombre, ?),
            celular = COALESCE(celular, ?),
            telefono_normalizado = COALESCE(telefono_normalizado, ?),
            fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
            datosCliente.dni || null,
            identidades.dni || null,
            datosCliente.nombre || null,
            datosCliente.celular || null,
            identidades.telefono || null,
            cliente.id
        ]
    );

    if (identidades.telefono) {
        await tx.run(
            `
            UPDATE primer_contacto_identidades
            SET
                cliente_id = COALESCE(cliente_id, ?),
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE telefono_normalizado = ?
            `,
            [cliente.id, identidades.telefono]
        );
    }

    return tx.get("SELECT * FROM clientes WHERE id = ?", [cliente.id]);
}

async function crearClienteSiHaceFalta(tx, datosCliente, usuarioAutenticado) {
    const identidad = identidadClienteDesdeDatos(datosCliente);

    if (!identidad) {
        return null;
    }

    const coincidencias = await buscarClientesPorIdentidades(datosCliente, tx);
    const clientesUnicos = [...new Map(
        coincidencias.map(cliente => [String(cliente.id), cliente])
    ).values()];

    if (clientesUnicos.length > 1) {
        throw errorHttp(
            409,
            "El DNI y el teléfono ingresados pertenecen a clientes diferentes"
        );
    }

    const existente = clientesUnicos[0] || null;

    if (existente) {
        return completarClienteConDatos(tx, existente, datosCliente);
    }

    const usuario = await obtenerUsuarioPorNombre(usuarioAutenticado, tx);
    const dniNormalizado = normalizarDniIdentidad(datosCliente.dni);
    const telefonoNormalizado = normalizarTelefono(datosCliente.celular);

    await verificarConflictoPrimerContacto(tx, telefonoNormalizado);
    const valores = [
        identidad.tipo,
        identidad.valor,
        datosCliente.dni || null,
        dniNormalizado,
        datosCliente.nombre || null,
        datosCliente.celular || null,
        telefonoNormalizado || null,
        usuario?.id || null,
        usuario?.usuario || usuarioAutenticado || null
    ];

    let creado;

    if (db.type === "postgres") {
        creado = await tx.get(
            `
            INSERT INTO clientes (
                identidad_tipo,
                identidad_valor,
                dni,
                dni_normalizado,
                nombre,
                celular,
                telefono_normalizado,
                vendedora_id,
                vendedora_asignada,
                etapa_comercial
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Nuevo')
            ON CONFLICT (identidad_tipo, identidad_valor) DO UPDATE
            SET
                dni = COALESCE(clientes.dni, EXCLUDED.dni),
                dni_normalizado = COALESCE(clientes.dni_normalizado, EXCLUDED.dni_normalizado),
                nombre = COALESCE(clientes.nombre, EXCLUDED.nombre),
                celular = COALESCE(clientes.celular, EXCLUDED.celular),
                telefono_normalizado = COALESCE(clientes.telefono_normalizado, EXCLUDED.telefono_normalizado),
                vendedora_id = COALESCE(clientes.vendedora_id, EXCLUDED.vendedora_id),
                vendedora_asignada = COALESCE(clientes.vendedora_asignada, EXCLUDED.vendedora_asignada),
                fecha_actualizacion = now()
            RETURNING *
            `,
            valores
        );
    } else {
        await tx.run(
            `
            INSERT OR IGNORE INTO clientes (
                identidad_tipo,
                identidad_valor,
                dni,
                dni_normalizado,
                nombre,
                celular,
                telefono_normalizado,
                vendedora_id,
                vendedora_asignada,
                etapa_comercial
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Nuevo')
            `,
            valores
        );

        creado = await buscarClientePorIdentidad(identidad, tx);
    }

    if (creado && telefonoNormalizado) {
        await tx.run(
            `
            UPDATE primer_contacto_identidades
            SET
                cliente_id = COALESCE(cliente_id, ?),
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE telefono_normalizado = ?
            `,
            [creado.id, telefonoNormalizado]
        );
    }

    return creado;
}

function whereCotizacionesVisiblesPorListado(req, condiciones, parametros) {
    if (req.user.rol !== "admin") {
        condiciones.push("vendedora = ?");
        parametros.push(req.user.usuario);
    }
}

function opcionDesdeCotizacion(cotizacion) {
    return {
        numero_opcion: 1,
        plan: cotizacion.plan || "",
        tipo_cobertura: cotizacion.tipo_cobertura || "Individual",
        valor: cotizacion.valor || "",
        bonificacion: cotizacion.bonificacion || "0",
        bonificacion_aportes: cotizacion.bonificacion_aportes || "0"
    };
}

function normalizarOpcionCotizacion(opcion, numeroOpcion) {
    return {
        numero_opcion: Number(opcion.numero_opcion || numeroOpcion),
        plan: String(opcion.plan || "").trim(),
        tipo_cobertura: String(opcion.tipo_cobertura || "Individual").trim(),
        valor: String(opcion.valor || "").trim(),
        bonificacion: String(opcion.bonificacion || "0").trim(),
        bonificacion_aportes: String(opcion.bonificacion_aportes || "0").trim()
    };
}

function opcionesDesdeBody(body) {
    let opciones = [];

    if (body.opciones) {
        try {
            opciones = JSON.parse(body.opciones);
        } catch (error) {
            opciones = [];
        }
    }

    if (!Array.isArray(opciones) || opciones.length === 0) {
        opciones = [
            {
                numero_opcion: 1,
                plan: body.plan,
                tipo_cobertura: body.tipo_cobertura,
                valor: body.valor,
                bonificacion: body.bonificacion,
                bonificacion_aportes: body.bonificacion_aportes
            }
        ];
    }

    return opciones
        .slice(0, 2)
        .map((opcion, index) => normalizarOpcionCotizacion(opcion, index + 1))
        .filter(opcion =>
            opcion.numero_opcion === 1 ||
            opcion.plan ||
            opcion.valor ||
            Number(opcion.bonificacion || 0) ||
            Number(opcion.bonificacion_aportes || 0)
        );
}

async function insertarOpcionesCotizacion(tx, cotizacionId, opciones) {
    for (const opcion of opciones) {
        await tx.run(
            `
            INSERT INTO cotizacion_opciones
            (
                cotizacion_id,
                numero_opcion,
                plan,
                tipo_cobertura,
                valor,
                bonificacion,
                bonificacion_aportes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                cotizacionId,
                opcion.numero_opcion,
                opcion.plan,
                opcion.tipo_cobertura,
                opcion.valor,
                opcion.bonificacion,
                opcion.bonificacion_aportes
            ]
        );
    }
}

function puedeGestionarCotizacion(req, cotizacion) {
    return req.user.rol === "admin"
        || cotizacion.vendedora === req.user.usuario;
}

async function obtenerCotizacionParaGestion(req, cotizacionId) {
    if (!/^\d+$/.test(String(cotizacionId))) {
        throw errorHttp(400, "Cotización inválida");
    }

    const cotizacion = await dbGetAsync(
        "SELECT id, vendedora FROM cotizaciones WHERE id = ?",
        [cotizacionId]
    );

    if (!cotizacion) throw errorHttp(404, "Cotización no encontrada");
    if (!puedeGestionarCotizacion(req, cotizacion)) {
        throw errorHttp(403, "No autorizado");
    }

    return cotizacion;
}

function responderCotizacionesConArchivos(req, res, cotizaciones) {
    const normalizadas = normalizarCotizaciones(cotizaciones);
    const ids = normalizadas.map(cotizacion => cotizacion.id);

    if (ids.length === 0) {
        res.json(normalizadas);
        return;
    }

    db.all(
        `
        SELECT *
        FROM cotizacion_opciones
        WHERE cotizacion_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY cotizacion_id ASC, numero_opcion ASC
        `,
        ids,
        (errOpciones, opciones) => {
            if (errOpciones) return res.status(500).json(errOpciones);

            const opcionesPorCotizacion = opciones.reduce((grupo, opcion) => {
                if (!grupo[opcion.cotizacion_id]) {
                    grupo[opcion.cotizacion_id] = [];
                }

                grupo[opcion.cotizacion_id].push(normalizarOpcionCotizacion(
                    opcion,
                    opcion.numero_opcion
                ));

                return grupo;
            }, {});

            const conOpciones = normalizadas.map(cotizacion => ({
                ...cotizacion,
                opciones: opcionesPorCotizacion[cotizacion.id]?.length
                    ? opcionesPorCotizacion[cotizacion.id]
                    : [opcionDesdeCotizacion(cotizacion)]
            }));

            db.all(
        `
        SELECT *
        FROM archivos
        WHERE cotizacion_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY fecha DESC
        `,
        ids,
        (err, archivos) => {
            if (err) return res.status(500).json(err);

            const archivosPorCotizacion = archivos.reduce((grupo, archivo) => {
                if (!grupo[archivo.cotizacion_id]) {
                    grupo[archivo.cotizacion_id] = [];
                }

                grupo[archivo.cotizacion_id].push(archivo);
                return grupo;
            }, {});

            res.json(
                conOpciones.map(cotizacion => ({
                    ...cotizacion,
                    // La información comercial es compartida; los adjuntos no.
                    archivos: puedeGestionarCotizacion(req, cotizacion)
                        ? archivosPorCotizacion[cotizacion.id] || []
                        : []
                }))
            );
        }
    );
        }
    );
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function columnName(index) {
    let name = "";
    let n = index + 1;

    while (n > 0) {
        const remainder = (n - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        n = Math.floor((n - 1) / 26);
    }

    return name;
}

const crcTable = (() => {
    const table = [];

    for (let i = 0; i < 256; i++) {
        let c = i;

        for (let j = 0; j < 8; j++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }

        table[i] = c >>> 0;
    }

    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;

    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
    const year = Math.max(date.getFullYear(), 1980);
    const dosTime =
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        Math.floor(date.getSeconds() / 2);
    const dosDate =
        ((year - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate();

    return { dosDate, dosTime };
}

function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = zipDateTime();

    files.forEach(file => {
        const name = Buffer.from(file.name, "utf8");
        const content = Buffer.isBuffer(file.content)
            ? file.content
            : Buffer.from(file.content, "utf8");
        const crc = crc32(content);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(content.length, 18);
        localHeader.writeUInt32LE(content.length, 22);
        localHeader.writeUInt16LE(name.length, 26);

        localParts.push(localHeader, name, content);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(content.length, 20);
        centralHeader.writeUInt32LE(content.length, 24);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, name);
        offset += localHeader.length + name.length + content.length;
    });

    const centralDirectory = Buffer.concat(centralParts);
    const centralOffset = offset;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(centralOffset, 16);

    return Buffer.concat([...localParts, centralDirectory, end]);
}

function createXlsx(headers, rows) {
    const sheetRows = [headers, ...rows]
        .map((row, rowIndex) => {
            const cells = row.map((value, columnIndex) => {
                const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
                return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
            }).join("");

            return `<row r="${rowIndex + 1}">${cells}</row>`;
        })
        .join("");

    const dimension = `A1:${columnName(headers.length - 1)}${rows.length + 1}`;

    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

    return createZip([
        {
            name: "[Content_Types].xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
        },
        {
            name: "_rels/.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
        },
        {
            name: "xl/workbook.xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Cotizaciones" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
        },
        {
            name: "xl/worksheets/sheet1.xml",
            content: worksheet
        }
    ]);
}

// 🔐 MIDDLEWARE TOKEN
function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(403).json({ error: "Token requerido" });
    }

    // 👇 CLAVE
    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Token mal formado" });
    }

    try {
        const decoded = jwt.verify(token, SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Token inválido" });
    }
}

// 🔥 CREACIÓN DE TABLAS
if (db.type === "sqlite") {
db.serialize(() => {

    db.run(`
    CREATE TABLE IF NOT EXISTS cotizaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dni TEXT,
        nombre TEXT,
        celular TEXT,
        plan TEXT,
        tipo_cobertura TEXT,
        valor TEXT,
        vendedora TEXT,
        comentarios TEXT,
        fecha DATETIME DEFAULT (datetime('now', '-3 hours'))
    )
    `);
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN tipo_cobertura TEXT
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN modalidad TEXT
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN cliente_id INTEGER
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN etapa_pipeline TEXT DEFAULT 'Nuevos'
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN fecha_alta TEXT
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN estado_posventa TEXT
`, () => { });
    db.run(`
    ALTER TABLE cotizaciones
    ADD COLUMN fecha_actualizacion_posventa DATETIME
`, () => { });

    db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE,
        password TEXT,
        rol TEXT,
        telefono TEXT,
        orden_login INTEGER
    )
    `);
    db.run(`
    CREATE TABLE IF NOT EXISTS cotizacion_opciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cotizacion_id INTEGER NOT NULL,
        numero_opcion INTEGER NOT NULL,
        plan TEXT,
        tipo_cobertura TEXT,
        valor TEXT,
        bonificacion TEXT,
        bonificacion_aportes TEXT,
        fecha DATETIME DEFAULT (datetime('now', '-3 hours')),
        UNIQUE (cotizacion_id, numero_opcion)
    )
    `);
    db.run(`
    ALTER TABLE usuarios
    ADD COLUMN orden_login INTEGER
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identidad_tipo TEXT NOT NULL,
        identidad_valor TEXT NOT NULL,
        dni TEXT,
        dni_normalizado TEXT,
        nombre TEXT,
        celular TEXT,
        telefono_normalizado TEXT,
        vendedora_id INTEGER,
        vendedora_asignada TEXT,
        etapa_comercial TEXT NOT NULL DEFAULT 'Nuevo',
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (identidad_tipo, identidad_valor)
    )
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_clientes_dni_normalizado
    ON clientes (dni_normalizado)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_clientes_telefono_normalizado
    ON clientes (telefono_normalizado)
`, () => { });
    db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_dni_normalizado
    ON clientes (dni_normalizado)
    WHERE dni_normalizado IS NOT NULL AND TRIM(dni_normalizado) <> ''
`, () => { });
    db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_telefono_normalizado
    ON clientes (telefono_normalizado)
    WHERE telefono_normalizado IS NOT NULL AND TRIM(telefono_normalizado) <> ''
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_clientes_nombre
    ON clientes (nombre)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_clientes_vendedora_id
    ON clientes (vendedora_id)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id
    ON cotizaciones (cliente_id)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_pipeline
    ON cotizaciones (etapa_pipeline)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_etapa_vendedora
    ON cotizaciones (etapa_pipeline, vendedora)
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS procedencias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL UNIQUE,
        seleccionable INTEGER NOT NULL DEFAULT 1,
        activa INTEGER NOT NULL DEFAULT 1,
        orden INTEGER NOT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `);
    [
        ["base", "Base", 1, 1],
        ["base_clinica", "Base Clínica", 1, 2],
        ["publicidad_oficial", "Publicidad oficial", 1, 3],
        ["publicidad_estacion", "Publicidad Estación", 1, 4],
        ["calle", "Calle", 1, 5],
        ["oficina", "Oficina", 1, 6],
        ["micaela_calle", "Micaela calle", 1, 7],
        ["referido", "Referido", 1, 8],
        ["sin_informar", "Sin informar", 0, 99]
    ].forEach(([codigo, nombre, seleccionable, orden]) => {
        db.run(
            `INSERT OR IGNORE INTO procedencias
             (codigo, nombre, seleccionable, activa, orden)
             VALUES (?, ?, ?, 1, ?)`,
            [codigo, nombre, seleccionable, orden]
        );
    });
    db.run(`
    CREATE TABLE IF NOT EXISTS primer_contacto_identidades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telefono_original TEXT NOT NULL,
        telefono_normalizado TEXT NOT NULL UNIQUE,
        cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
        nombre TEXT,
        procedencia_id INTEGER REFERENCES procedencias(id) ON DELETE RESTRICT,
        no_interesa INTEGER NOT NULL DEFAULT 0,
        no_enviar_mensajes INTEGER NOT NULL DEFAULT 0,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, () => { });
    db.run(`ALTER TABLE primer_contacto_identidades ADD COLUMN procedencia_id INTEGER`, () => { });
    db.run(`ALTER TABLE primer_contacto_identidades ADD COLUMN no_interesa INTEGER NOT NULL DEFAULT 0`, () => { });
    db.run(`ALTER TABLE primer_contacto_identidades ADD COLUMN no_enviar_mensajes INTEGER NOT NULL DEFAULT 0`, () => { });
    db.run(`
        UPDATE primer_contacto_identidades
        SET procedencia_id = (
            SELECT id FROM procedencias WHERE codigo = 'sin_informar'
        )
        WHERE procedencia_id IS NULL
    `, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS primer_contacto_gestiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contacto_id INTEGER NOT NULL
            REFERENCES primer_contacto_identidades(id) ON DELETE CASCADE,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        asesora TEXT NOT NULL,
        observacion TEXT,
        clave_idempotencia TEXT NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (asesora, clave_idempotencia)
    )
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS primer_contacto_procedencia_historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contacto_id INTEGER NOT NULL REFERENCES primer_contacto_identidades(id) ON DELETE CASCADE,
        procedencia_anterior_id INTEGER REFERENCES procedencias(id) ON DELETE RESTRICT,
        procedencia_nueva_id INTEGER NOT NULL REFERENCES procedencias(id) ON DELETE RESTRICT,
        accion TEXT NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario TEXT NOT NULL,
        motivo TEXT,
        clave_idempotencia TEXT NOT NULL UNIQUE,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS primer_contacto_contactabilidad_historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contacto_id INTEGER NOT NULL REFERENCES primer_contacto_identidades(id) ON DELETE CASCADE,
        marca TEXT NOT NULL,
        valor_anterior INTEGER NOT NULL,
        valor_nuevo INTEGER NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario TEXT NOT NULL,
        motivo TEXT,
        clave_idempotencia TEXT NOT NULL UNIQUE,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_primer_contacto_cliente
    ON primer_contacto_identidades (cliente_id)
`, () => { });
    db.run(`CREATE INDEX IF NOT EXISTS idx_primer_contacto_identidades_procedencia
            ON primer_contacto_identidades (procedencia_id)`, () => { });
    db.run(`CREATE INDEX IF NOT EXISTS idx_pc_gestiones_asesora_contacto
            ON primer_contacto_gestiones (asesora, contacto_id, fecha DESC)`, () => { });
    db.run(`CREATE INDEX IF NOT EXISTS idx_pc_procedencia_historial_contacto_fecha
            ON primer_contacto_procedencia_historial (contacto_id, fecha DESC)`, () => { });
    db.run(`CREATE INDEX IF NOT EXISTS idx_pc_contactabilidad_historial_contacto_fecha
            ON primer_contacto_contactabilidad_historial (contacto_id, fecha DESC)`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_contacto_fecha
    ON primer_contacto_gestiones (contacto_id, fecha DESC)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_primer_contacto_gestiones_asesora_fecha
    ON primer_contacto_gestiones (asesora, fecha DESC)
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS tareas_crm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descripcion TEXT,
        fecha TEXT NOT NULL,
        hora TEXT,
        tipo TEXT NOT NULL DEFAULT 'tarea',
        estado TEXT NOT NULL DEFAULT 'pendiente',
        usuario_responsable_id INTEGER,
        usuario_responsable TEXT NOT NULL,
        cotizacion_id INTEGER,
        cliente_id INTEGER,
        clave_automatica TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, () => { });
    db.run(`
    ALTER TABLE tareas_crm
    ADD COLUMN clave_automatica TEXT
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_tareas_crm_responsable_id
    ON tareas_crm (usuario_responsable_id)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_tareas_crm_responsable_texto
    ON tareas_crm (usuario_responsable)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_tareas_crm_fecha_estado
    ON tareas_crm (fecha, estado)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_tareas_crm_cotizacion_id
    ON tareas_crm (cotizacion_id)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_tareas_crm_cliente_id
    ON tareas_crm (cliente_id)
`, () => { });
    db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_crm_posventa
    ON tareas_crm (cotizacion_id, clave_automatica)
    WHERE clave_automatica IS NOT NULL
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_alta
    ON cotizaciones (fecha_alta)
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado_posventa
    ON cotizaciones (estado_posventa)
`, () => { });
    db.run(`
    CREATE TABLE IF NOT EXISTS cotizaciones_posventa_historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cotizacion_id INTEGER NOT NULL,
        estado_anterior TEXT,
        estado_nuevo TEXT NOT NULL,
        fecha_alta TEXT,
        usuario_id INTEGER,
        usuario TEXT NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, () => { });
    db.run(`
    CREATE INDEX IF NOT EXISTS idx_posventa_historial_cotizacion_fecha
    ON cotizaciones_posventa_historial (cotizacion_id, fecha DESC)
`, () => { });

    const passwordHash = bcrypt.hashSync("1234", 10);

    db.run(`
    INSERT OR IGNORE INTO usuarios (usuario, password, rol)
    VALUES ('admin', ?, 'admin')
    `, [passwordHash]);

    const fecha = new Date().toLocaleString("sv-SE", {
        timeZone: "America/Argentina/Buenos_Aires"
    });

    db.run(`
CREATE TABLE IF NOT EXISTS archivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cotizacion_id INTEGER,
    nombre TEXT,
    archivo TEXT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);
    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN vigencia TEXT
`, () => { });

    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN referido TEXT
`, () => { });

    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN congelamiento TEXT
`, () => { });

    db.run(`
CREATE TABLE IF NOT EXISTS comentarios_cotizacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cotizacion_id INTEGER,
    usuario TEXT,
    comentario TEXT,
    fecha DATETIME DEFAULT (datetime('now', '-3 hours'))
)
`);
    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN bonificacion TEXT
`, () => { });

    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN bonificacion_aportes TEXT
`, () => { });

    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN estado TEXT DEFAULT 'Nuevo'
`, () => { });

    db.run(`
ALTER TABLE cotizaciones
ADD COLUMN fecha_seguimiento TEXT
`, () => { });

    db.run(`
UPDATE cotizaciones
SET estado = 'Nuevo'
WHERE estado IS NULL OR estado = ''
`, () => { });

    db.run(`
UPDATE cotizaciones
SET estado = 'Afiliado'
WHERE estado IN (${ESTADOS_AFILIADO_LEGACY.map(() => "?").join(", ")})
`, ESTADOS_AFILIADO_LEGACY, () => { });
    db.run(`
UPDATE cotizaciones
SET etapa_pipeline = CASE
    WHEN LOWER(TRIM(COALESCE(estado, ''))) IN (${ESTADOS_CIERRE_NEGATIVO_SQL}) THEN NULL
    WHEN estado IN (${ESTADOS_AFILIADO_LEGACY.map(() => "?").join(", ")}, 'Afiliado') THEN 'Afiliados'
    WHEN estado = 'Contactado' THEN 'Contactados'
    ELSE 'Nuevos'
END
WHERE LOWER(TRIM(COALESCE(estado, ''))) IN (${ESTADOS_CIERRE_NEGATIVO_SQL})
   OR etapa_pipeline IS NULL
   OR TRIM(etapa_pipeline) = ''
`, ESTADOS_AFILIADO_LEGACY, () => { });

});
}

// 👉 LOGIN
app.post("/login", (req, res) => {
    const { password } = req.body;
    const usuario = req.body.usuario?.trim();
    const loginSql = "SELECT * FROM usuarios WHERE TRIM(usuario) = ?";

    if (!usuario || !password) {
        return res.status(400).json({ success: false });
    }

    console.log("[login] motor base:", db.type);
    console.log("[login] sql:", db.toNativeSql(loginSql));

    db.get(
        loginSql,
        [usuario],
        async (err, user) => {

            if (err) {
                console.error("[login] error db:", err.message);
                return res.status(500).json(err);
            }

            console.log("[login] usuario encontrado:", user ? "si" : "no");

            if (!user) {
                return res.status(401).json({ success: false });
            }

            console.log(
                "[login] largo hash:",
                typeof user.password === "string" ? user.password.length : "no-string"
            );
            console.log(
                "[login] password recibido:",
                typeof password === "string" ? "string" : typeof password
            );

            let match = false;

            try {
                match = await bcrypt.compare(password, user.password);
            } catch (errorCompare) {
                console.error("[login] bcrypt.compare error:", errorCompare.message);
                return res.status(500).json({ error: "Error al validar credenciales" });
            }

            console.log("[login] bcrypt.compare:", match);

            if (!match) {
                return res.status(401).json({ success: false });
            }

            const usuarioLimpio = user.usuario.trim();

            const token = jwt.sign(
                {
                    usuario: usuarioLimpio,
                    rol: user.rol
                },
                SECRET,
                { expiresIn: "2h" }
            );

            res.json({
                success: true,
                token,
                usuario: usuarioLimpio,
                rol: user.rol
            });
        }
    );
});


// 👉 HOME
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/login.html");
});

function variantesTelefono(valor) {
    const digitos = String(valor || "").replace(/\D/g, "");
    const normalizado = normalizarTelefono(valor);
    const variantes = new Set();

    if (!digitos) return variantes;

    variantes.add(digitos);
    if (normalizado) variantes.add(normalizado);

    let huboCambios = true;

    while (huboCambios) {
        const cantidadAnterior = variantes.size;

        [...variantes].forEach(numero => {
            if (numero.startsWith("549")) variantes.add(numero.slice(3));
            if (numero.startsWith("54")) variantes.add(numero.slice(2));
            if (numero.startsWith("0")) variantes.add(numero.slice(1));

            // El 15 puede estar guardado después de un código de área de 2 a 4 dígitos.
            for (let posicion = 2; posicion <= 4; posicion++) {
                if (numero.slice(posicion, posicion + 2) === "15") {
                    variantes.add(
                        numero.slice(0, posicion) + numero.slice(posicion + 2)
                    );
                }
            }
        });

        huboCambios = variantes.size !== cantidadAnterior;
    }

    [...variantes].forEach(numero => {
        if (numero.length > 8) variantes.add(numero.slice(-8));
        if (numero.length > 7) variantes.add(numero.slice(-7));
    });

    return new Set(
        [...variantes].filter(numero => {
            // Evita que términos demasiado cortos produzcan resultados accidentales.
            return numero.length >= 4;
        })
    );
}

function celularSinFormatoSql() {
    return `
        REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(celular, ' ', ''),
                            '-', ''
                        ),
                        '(', ''
                    ),
                    ')', ''
                ),
                '+', ''
            ),
            '.', ''
        )
    `;
}

function buscarCotizacionesPorTelefono(termino, callback) {
    const terminoNormalizado = normalizarTelefono(termino);
    const sqlExacto = `
        ${SELECT_COTIZACIONES}
        WHERE celular = ?
           OR TRIM(celular) = ?
        ORDER BY fecha ASC
    `;
    const sqlNormalizada = `
        ${SELECT_COTIZACIONES}
        WHERE celular IS NOT NULL
          AND TRIM(celular) != ''
        ORDER BY fecha ASC
    `;

    if (!terminoNormalizado) {
        console.log("[buscar telefono]", {
            motor: db.type,
            termino,
            terminoNormalizado,
            busqueda: "sin termino telefonico normalizable",
            sql: compactarSql(
                db.toNativeSql ? db.toNativeSql(sqlExacto) : sqlExacto
            ),
            candidatos: 0,
            resultados: 0,
            primerasColumnas: []
        });
        callback(null, []);
        return;
    }

    db.all(
        sqlExacto,
        [termino, termino],
        (errExacto, cotizacionesExactas) => {
            if (errExacto) {
                callback(errExacto);
                return;
            }

            console.log("[buscar telefono exacto]", {
                motor: db.type,
                termino,
                terminoNormalizado,
                busqueda: "celular = termino OR TRIM(celular) = termino",
                sql: compactarSql(
                    db.toNativeSql ? db.toNativeSql(sqlExacto) : sqlExacto
                ),
                resultados: cotizacionesExactas.length,
                primerasColumnas: resumirCotizacionesParaLog(cotizacionesExactas)
            });

            if (cotizacionesExactas.length > 0) {
                callback(null, normalizarCotizaciones(cotizacionesExactas));
                return;
            }

            db.all(
                sqlNormalizada,
                [],
                (err, cotizaciones) => {
            if (err) {
                callback(err);
                return;
            }

            console.log("[buscar telefono candidatos]", {
                motor: db.type,
                termino,
                terminoNormalizado,
                cantidadAntesDeFiltrar: cotizaciones.length,
                primerasColumnas: resumirCotizacionesParaLog(cotizaciones),
                diagnosticoCoincidencias: diagnosticarCoincidenciasTelefono(
                    cotizaciones,
                    termino
                )
            });

            const resultados = cotizaciones.filter(cotizacion =>
                coincideTelefono(cotizacion.celular, termino)
            );

            console.log("[buscar telefono]", {
                motor: db.type,
                termino,
                terminoNormalizado,
                busqueda: "comparacion normalizada en memoria sobre columna celular",
                sql: compactarSql(
                    db.toNativeSql ? db.toNativeSql(sqlNormalizada) : sqlNormalizada
                ),
                candidatos: cotizaciones.length,
                resultados: resultados.length,
                primerasColumnas: resumirCotizacionesParaLog(resultados),
                diagnosticoCoincidencias: diagnosticarCoincidenciasTelefono(
                    resultados,
                    termino
                )
            });

            callback(
                null,
                normalizarCotizaciones(resultados)
            );
                }
            );
        }
    );
}

function coincideTelefono(celular, termino) {
    const celularTexto = String(celular || "").trim();
    const terminoTexto = String(termino || "").trim();
    const celularDigitos = celularTexto.replace(/\D/g, "");
    const terminoDigitos = terminoTexto.replace(/\D/g, "");
    const celularNormalizado = normalizarTelefono(celular);
    const busquedaNormalizada = normalizarTelefono(termino);

    if (!celularTexto || !terminoTexto) return false;

    return celularTexto === terminoTexto
        || (Boolean(celularDigitos) && celularDigitos === terminoDigitos)
        || (
            Boolean(celularNormalizado)
            && Boolean(busquedaNormalizada)
            && celularNormalizado === busquedaNormalizada
        );
}

// 👉 BUSCAR POR DNI O TELÉFONO
async function buscarClientesPorIdentidadSegura(termino) {
    const identidad = identidadBusquedaSegura(termino);

    if (!identidad) {
        return {
            identidad: null,
            clientes: []
        };
    }

    const condicion = identidad.tipo === "telefono"
        ? `
            (
                clientes.identidad_tipo = ?
                AND clientes.identidad_valor = ?
            )
            OR clientes.telefono_normalizado = ?
        `
        : `
            (
                clientes.identidad_tipo = ?
                AND clientes.identidad_valor = ?
            )
            OR clientes.dni_normalizado = ?
        `;
    const parametros = [identidad.tipo, identidad.valor, identidad.valor];
    const clientes = await dbAllAsync(
        `
        SELECT
            clientes.*,
            COUNT(cotizaciones.id) AS total_cotizaciones
        FROM clientes
        LEFT JOIN cotizaciones
            ON cotizaciones.cliente_id = clientes.id
        WHERE ${condicion}
        GROUP BY clientes.id
        ORDER BY clientes.fecha_actualizacion DESC, clientes.id DESC
        `,
        parametros
    );

    return {
        identidad,
        clientes
    };
}

async function buscarCotizacionesPorIdentidadSegura(termino) {
    const identidad = identidadBusquedaSegura(termino);

    if (!identidad) {
        return {
            identidad: null,
            cotizaciones: []
        };
    }

    const condicion = identidad.tipo === "telefono"
        ? `
            (
                clientes.identidad_tipo = ?
                AND clientes.identidad_valor = ?
            )
            OR clientes.telefono_normalizado = ?
        `
        : `
            (
                clientes.identidad_tipo = ?
                AND clientes.identidad_valor = ?
            )
            OR clientes.dni_normalizado = ?
        `;
    const parametros = [identidad.tipo, identidad.valor, identidad.valor];
    const cotizaciones = await dbAllAsync(
        `
        SELECT q.*
        FROM (${SELECT_COTIZACIONES}) q
        JOIN clientes
            ON clientes.id = q.cliente_id
        WHERE ${condicion}
        ORDER BY q.fecha ASC
        `,
        parametros
    );

    return {
        identidad,
        cotizaciones
    };
}

function clienteCoincideConBusqueda(cliente, termino) {
    const identidad = identidadBusquedaSegura(termino);

    return Boolean(
        identidad &&
        cliente &&
        (
            (
                cliente.identidad_tipo === identidad.tipo &&
                cliente.identidad_valor === identidad.valor
            ) ||
            (
                identidad.tipo === "telefono" &&
                cliente.telefono_normalizado === identidad.valor
            ) ||
            (
                identidad.tipo === "dni" &&
                cliente.dni_normalizado === identidad.valor
            )
        )
    );
}

app.get("/clientes/buscar", verificarToken, async (req, res) => {
    const termino = String(req.query.termino || "").trim();

    try {
        const resultado = await buscarClientesPorIdentidadSegura(termino);

        if (!resultado.identidad) {
            return res.status(400).json({
                error: "Ingresá un DNI o teléfono completo"
            });
        }

        res.json({
            identidad: resultado.identidad,
            clientes: resultado.clientes
        });
    } catch (error) {
        res.status(500).json({ error: "No se pudo buscar el cliente" });
    }
});

app.get("/clientes/:id/cotizaciones", verificarToken, async (req, res) => {
    const clienteId = req.params.id;
    const termino = String(req.query.termino || "").trim();

    if (!/^\d+$/.test(clienteId)) {
        return res.status(400).json({ error: "Cliente inválido" });
    }

    try {
        const cliente = await dbGetAsync(
            "SELECT * FROM clientes WHERE id = ?",
            [clienteId]
        );

        if (!cliente) {
            return res.status(404).json({ error: "Cliente no encontrado" });
        }

        if (!clienteCoincideConBusqueda(cliente, termino)) {
            return res.status(403).json({
                error: "Búsqueda específica requerida"
            });
        }

        const cotizaciones = await dbAllAsync(
            `
            ${SELECT_COTIZACIONES}
            WHERE cliente_id = ?
            ORDER BY fecha ASC
            `,
            [clienteId]
        );

        responderCotizacionesConArchivos(req, res, cotizaciones);
    } catch (error) {
        res.status(500).json({ error: "No se pudieron cargar las cotizaciones" });
    }
});

app.get("/buscar/:termino", verificarToken, async (req, res) => {
    const termino = String(req.params.termino || "").trim();

    try {
        const resultado = await buscarCotizacionesPorIdentidadSegura(termino);

        console.log("[buscar resultado final]", {
            usuario: req.user?.usuario,
            termino,
            identidad: resultado.identidad,
            resultados: resultado.cotizaciones.length,
            primerasColumnas: resumirCotizacionesParaLog(resultado.cotizaciones)
        });

        if (!resultado.identidad) {
            return res.status(400).json({
                error: "Ingresá un DNI o teléfono completo"
            });
        }

        return responderCotizacionesConArchivos(req, res, resultado.cotizaciones);
    } catch (error) {
        return res.status(500).json({ error: "No se pudo realizar la búsqueda" });
    }

    db.all(
        sqlDni,
        [termino],
        (err, cotizacionesPorDni) => {
            if (err) return res.status(500).json(err);

            console.log("[buscar dni]", {
                motor: db.type,
                termino,
                terminoNormalizado: normalizarTelefono(termino),
                sql: compactarSql(db.toNativeSql ? db.toNativeSql(sqlDni) : sqlDni),
                resultados: cotizacionesPorDni.length,
                primerasColumnas: resumirCotizacionesParaLog(cotizacionesPorDni)
            });

            // La coincidencia exacta de DNI conserva la búsqueda original.
            if (cotizacionesPorDni.length > 0) {
                console.log("[buscar resultado final]", {
                    usuario: req.user?.usuario,
                    termino,
                    tipo: "dni",
                    resultados: cotizacionesPorDni.length,
                    primerasColumnas: resumirCotizacionesParaLog(cotizacionesPorDni)
                });

                return responderCotizacionesConArchivos(
                    req,
                    res,
                    cotizacionesPorDni
                );
            }

            buscarCotizacionesPorTelefono(
                termino,
                (errorTelefono, cotizaciones) => {
                    if (errorTelefono) {
                        return res.status(500).json(errorTelefono);
                    }

                    console.log("[buscar resultado final]", {
                        usuario: req.user?.usuario,
                        termino,
                        tipo: "celular",
                        resultados: cotizaciones.length,
                        primerasColumnas: resumirCotizacionesParaLog(cotizaciones)
                    });

                    responderCotizacionesConArchivos(req, res, cotizaciones);
                }
            );
        }
    );
});

// 👉 AGREGAR
function eliminarArchivosLocales(archivos = []) {
    archivos.forEach(archivo => {
        if (archivo?.path) {
            fs.unlink(archivo.path, () => { });
        }
    });
}

function manejarErrorMulter(err, res) {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
                error: "La imagen supera el máximo permitido de 5 MB"
            });
        }

        if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({
                error: "Podés adjuntar hasta 5 imágenes por cotización"
            });
        }
    }

    if (err?.code === "TIPO_ARCHIVO_INVALIDO") {
        return res.status(400).json({ error: err.message });
    }

    console.error("Error al procesar imagen:", err);
    return res.status(500).json({
        error: "No se pudo procesar la imagen"
    });
}

async function insertarArchivosCotizacion(tx, cotizacionId, archivos) {
    for (const archivo of archivos) {
        await tx.run(
            `INSERT INTO archivos (cotizacion_id, nombre, archivo)
             VALUES (?, ?, ?)`,
            [
                cotizacionId,
                archivo.originalname,
                archivo.filename
            ]
        );
    }
}

const uploadImagenesNuevaCotizacion = (req, res, next) => {
    upload.array("imagenes", 5)(req, res, err => {
        if (err) {
            eliminarArchivosLocales(req.files);
            manejarErrorMulter(err, res);
            return;
        }

        next();
    });
};

function errorHttp(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const MAX_PRIMER_CONTACTO_TANDA = 50;

function textoOpcionalPrimerContacto(valor, maximo) {
    const texto = String(valor || "").trim();

    if (!texto) return null;
    if (texto.length > maximo) {
        throw errorHttp(400, `El texto supera el máximo de ${maximo} caracteres`);
    }

    return texto;
}

function telefonoPrimerContacto(telefono) {
    const original = String(telefono || "").trim();
    const normalizado = normalizarTelefono(original);
    const valido = original.length <= 50 && /^\d{10}$/.test(normalizado);

    return {
        telefono_original: original,
        telefono_normalizado: normalizado,
        valido
    };
}

function validarClavePrimerContacto(clave, campo = "clave_idempotencia") {
    const valor = String(clave || "").trim();

    if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(valor)) {
        throw errorHttp(400, `${campo} inválida`);
    }

    return valor;
}

function storePrimerContacto(tx = null) {
    return tx || {
        get: dbGetAsync,
        all: dbAllAsync,
        run: dbRunAsync
    };
}

async function cargarContextoTelefonosCrm(tx = null) {
    const store = storePrimerContacto(tx);
    const [clientes, cotizaciones] = await Promise.all([
        store.all(
            `
            SELECT
                id, identidad_tipo, identidad_valor, dni, nombre, celular,
                telefono_normalizado
            FROM clientes
            ORDER BY id ASC
            `
        ),
        store.all(
            `
            SELECT
                id, cliente_id, dni, nombre, celular, plan, vendedora, fecha,
                estado, etapa_pipeline
            FROM cotizaciones
            ORDER BY fecha DESC, id DESC
            `
        )
    ]);

    return { clientes, cotizaciones };
}

function telefonoCoincideConCanonico(telefonoNormalizado, ...valores) {
    return valores.some(valor =>
        valor && normalizarTelefono(valor) === telefonoNormalizado
    );
}

function buscarContextoCrmPrimerContacto(telefonoNormalizado, contextoCrm) {
    const clientes = contextoCrm.clientes || [];
    const cotizaciones = contextoCrm.cotizaciones || [];
    const clienteDirecto = clientes.find(cliente =>
        telefonoCoincideConCanonico(
            telefonoNormalizado,
            cliente.celular,
            cliente.telefono_normalizado,
            cliente.identidad_tipo === "telefono" ? cliente.identidad_valor : null
        )
    ) || null;
    const cotizacionesCoincidentes = cotizaciones.filter(cotizacion =>
        telefonoCoincideConCanonico(telefonoNormalizado, cotizacion.celular)
    );
    const clienteVinculado = clienteDirecto || clientes.find(cliente =>
        cotizacionesCoincidentes.some(cotizacion =>
            String(cotizacion.cliente_id || "") === String(cliente.id)
        )
    ) || null;
    const cotizacionesCliente = clienteVinculado
        ? cotizaciones.filter(cotizacion =>
            String(cotizacion.cliente_id || "") === String(clienteVinculado.id)
        )
        : [];
    const cotizacionesRelacionadas = [...new Map(
        [...cotizacionesCoincidentes, ...cotizacionesCliente]
            .map(cotizacion => [String(cotizacion.id), cotizacion])
    ).values()];

    return {
        cliente: clienteVinculado,
        cotizaciones: cotizacionesRelacionadas,
        cotizacionTelefono: cotizacionesCoincidentes[0] || null
    };
}

function resumirCotizacionesPrimerContacto(cotizaciones = []) {
    const cantidadesPorAsesora = new Map();

    cotizaciones.forEach(cotizacion => {
        const asesora = String(cotizacion.vendedora || "").trim() || "Sin asesora";
        cantidadesPorAsesora.set(
            asesora,
            (cantidadesPorAsesora.get(asesora) || 0) + 1
        );
    });

    const cotizacionesPorAsesora = [...cantidadesPorAsesora.entries()]
        .map(([asesora, cantidad]) => ({ asesora, cantidad }))
        .sort((a, b) =>
            b.cantidad - a.cantidad
            || a.asesora.localeCompare(b.asesora, "es")
        );

    return {
        cotizado: cotizaciones.length > 0,
        cantidad_cotizaciones_crm: cotizaciones.length,
        asesoras_cotizaciones: cotizacionesPorAsesora
            .filter(item => item.asesora !== "Sin asesora")
            .map(item => item.asesora),
        cotizaciones_por_asesora: cotizacionesPorAsesora,
        afiliado: cotizaciones.some(cotizacion =>
            normalizarEstadoCotizacion(cotizacion.estado) === "Afiliado"
        )
    };
}

async function buscarIdentidadPrimerContacto(telefonoNormalizado, tx = null) {
    const store = storePrimerContacto(tx);
    const exacta = await store.get(
        `
        SELECT *
        FROM primer_contacto_identidades
        WHERE telefono_normalizado = ?
        LIMIT 1
        `,
        [telefonoNormalizado]
    );

    if (exacta) return exacta;

    const historicas = await store.all(
        `SELECT * FROM primer_contacto_identidades ORDER BY id ASC`
    );

    return historicas.find(identidad =>
        telefonoCoincideConCanonico(
            telefonoNormalizado,
            identidad.telefono_original,
            identidad.telefono_normalizado
        )
    ) || null;
}

async function analizarTelefonoPrimerContacto(
    telefono,
    asesora,
    tx = null,
    contextoCrm = null
) {
    const datosTelefono = telefonoPrimerContacto(telefono);

    if (!datosTelefono.valido) {
        return {
            ...datosTelefono,
            estado: "invalido",
            cantidad_contactos: 0,
            ya_contactado_por_mi: false,
            seleccion_recomendada: false,
            asesoras: [],
            historial: [],
            historial_procedencia: [],
            historial_contactabilidad: [],
            procedencia: null,
            no_interesa: false,
            no_enviar_mensajes: false,
            cotizado: false,
            afiliado: false,
            cantidad_cotizaciones_crm: 0,
            asesoras_cotizaciones: [],
            cotizaciones_por_asesora: [],
            cotizaciones: [],
            cliente: null,
            existe_en_crm: false,
            ultima_cotizacion_crm: null
        };
    }

    const store = storePrimerContacto(tx);
    const [identidad, contexto] = await Promise.all([
        buscarIdentidadPrimerContacto(datosTelefono.telefono_normalizado, tx),
        contextoCrm || cargarContextoTelefonosCrm(tx)
    ]);
    const coincidenciaCrm = buscarContextoCrmPrimerContacto(
        datosTelefono.telefono_normalizado,
        contexto
    );
    const cliente = coincidenciaCrm.cliente;
    const cotizacionReferencia = coincidenciaCrm.cotizacionTelefono
        || coincidenciaCrm.cotizaciones[0]
        || null;
    const historial = identidad
        ? await store.all(
            `
            SELECT id, contacto_id, usuario_id, asesora, observacion, fecha
            FROM primer_contacto_gestiones
            WHERE contacto_id = ?
            ORDER BY fecha DESC, id DESC
            `,
            [identidad.id]
        )
        : [];
    const detalleIdentidad = await cargarDetalleIdentidadPrimerContacto(
        identidad,
        tx
    );
    const propios = historial.filter(gestion => gestion.asesora === asesora);
    const asesoras = [...new Set(historial.map(gestion => gestion.asesora))];
    const resumenCotizaciones = resumirCotizacionesPrimerContacto(
        coincidenciaCrm.cotizaciones
    );
    const estado = propios.length
        ? "contactado_por_mi"
        : historial.length
            ? "contactado_por_otra"
            : cliente || coincidenciaCrm.cotizaciones.length
                ? "existe_en_crm"
                : "nuevo";

    return {
        ...datosTelefono,
        contacto_id: identidad?.id || null,
        nombre: cliente?.nombre || cotizacionReferencia?.nombre || identidad?.nombre || null,
        estado,
        cantidad_contactos: historial.length,
        ya_contactado_por_mi: propios.length > 0,
        ultimo_contacto: historial[0]?.fecha || null,
        ultimo_contacto_propio: propios[0]?.fecha || null,
        seleccion_recomendada:
            !identidad
            && !detalleIdentidad.no_enviar_mensajes,
        asesoras,
        historial,
        ...detalleIdentidad,
        existe_en_crm: Boolean(cliente || coincidenciaCrm.cotizaciones.length),
        ...resumenCotizaciones,
        cotizaciones: coincidenciaCrm.cotizaciones.map(cotizacion => ({
            id: cotizacion.id,
            asesora: cotizacion.vendedora,
            fecha: cotizacion.fecha,
            estado: cotizacion.estado,
            etapa_pipeline: cotizacion.etapa_pipeline
        })),
        ultima_cotizacion_crm: cotizacionReferencia?.fecha
            ? { fecha: cotizacionReferencia.fecha }
            : null,
        cliente: cliente
            ? {
                id: cliente.id,
                dni: cliente.dni,
                nombre: cliente.nombre,
                celular: cliente.celular,
                telefono_normalizado: cliente.telefono_normalizado,
                cantidad_cotizaciones: coincidenciaCrm.cotizaciones.length
            }
            : null
    };
}

function numerosPrimerContactoDesdeBody(numeros) {
    const lineas = (Array.isArray(numeros)
        ? numeros
        : String(numeros || "").split(/\r?\n/))
        .map(numero => String(numero || "").trim())
        .filter(Boolean);

    if (lineas.length > MAX_PRIMER_CONTACTO_TANDA) {
        throw errorHttp(
            400,
            `Podés cargar un máximo de ${MAX_PRIMER_CONTACTO_TANDA} números por vez.`
        );
    }

    return lineas;
}

async function analizarTandaPrimerContacto(numeros, asesora, tx = null) {
    const lineas = numerosPrimerContactoDesdeBody(numeros);
    const contextoCrm = await cargarContextoTelefonosCrm(tx);
    const vistos = new Map();
    const resultados = [];

    for (let indice = 0; indice < lineas.length; indice++) {
        const resultado = await analizarTelefonoPrimerContacto(
            lineas[indice],
            asesora,
            tx,
            contextoCrm
        );
        const repetido = resultado.valido
            ? vistos.get(resultado.telefono_normalizado)
            : undefined;

        if (repetido !== undefined) {
            resultados.push({
                ...resultado,
                estado: "duplicado_tanda",
                duplicado_de: repetido,
                seleccion_recomendada: false
            });
            continue;
        }

        if (resultado.valido) {
            vistos.set(resultado.telefono_normalizado, indice);
        }

        resultados.push(resultado);
    }

    return resultados;
}

async function obtenerOCrearIdentidadPrimerContacto(
    tx,
    datos,
    cliente,
    nombre,
    contactoId = null,
    procedencia = null
) {
    const clienteId = cliente?.id || null;

    if (contactoId) {
        await tx.run(
            `
            UPDATE primer_contacto_identidades
            SET
                cliente_id = COALESCE(cliente_id, ?),
                nombre = COALESCE(nombre, ?),
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [clienteId, nombre, contactoId]
        );

        return tx.get(
            `SELECT * FROM primer_contacto_identidades WHERE id = ?`,
            [contactoId]
        );
    }

    if (db.type === "postgres") {
        return tx.get(
            `
            INSERT INTO primer_contacto_identidades (
                telefono_original,
                telefono_normalizado,
                cliente_id,
                nombre,
                procedencia_id
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (telefono_normalizado) DO UPDATE
            SET
                cliente_id = COALESCE(
                    primer_contacto_identidades.cliente_id,
                    EXCLUDED.cliente_id
                ),
                nombre = COALESCE(
                    primer_contacto_identidades.nombre,
                    EXCLUDED.nombre
                ),
                fecha_actualizacion = CURRENT_TIMESTAMP
            RETURNING *
            `,
            [
                datos.telefono_original,
                datos.telefono_normalizado,
                clienteId,
                nombre,
                procedencia?.id || null
            ]
        );
    }

    await tx.run(
        `
        INSERT OR IGNORE INTO primer_contacto_identidades (
            telefono_original,
            telefono_normalizado,
            cliente_id,
            nombre,
            procedencia_id
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
            datos.telefono_original,
            datos.telefono_normalizado,
            clienteId,
            nombre,
            procedencia?.id || null
        ]
    );
    await tx.run(
        `
        UPDATE primer_contacto_identidades
        SET
            cliente_id = COALESCE(cliente_id, ?),
            nombre = COALESCE(nombre, ?),
            fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE telefono_normalizado = ?
        `,
        [clienteId, nombre, datos.telefono_normalizado]
    );

    return tx.get(
        `
        SELECT *
        FROM primer_contacto_identidades
        WHERE telefono_normalizado = ?
        `,
        [datos.telefono_normalizado]
    );
}

async function registrarGestionPrimerContacto(
    tx,
    req,
    {
        telefono,
        nombre,
        observacion,
        procedencia_codigo,
        confirmar_repetido = false,
        clave_idempotencia
    },
    contextoCrm = null
) {
    const datosTelefono = telefonoPrimerContacto(telefono);

    if (!datosTelefono.valido) {
        throw errorHttp(400, "Número de teléfono inválido");
    }

    const clave = validarClavePrimerContacto(clave_idempotencia);
    const nombreLimpio = textoOpcionalPrimerContacto(nombre, 120);
    const observacionLimpia = textoOpcionalPrimerContacto(observacion, 1000);
    const existentePorClave = await tx.get(
        `
        SELECT
            primer_contacto_gestiones.id,
            primer_contacto_identidades.telefono_normalizado
        FROM primer_contacto_gestiones
        JOIN primer_contacto_identidades
            ON primer_contacto_identidades.id = primer_contacto_gestiones.contacto_id
        WHERE primer_contacto_gestiones.asesora = ?
          AND primer_contacto_gestiones.clave_idempotencia = ?
        LIMIT 1
        `,
        [req.user.usuario, clave]
    );

    if (existentePorClave) {
        if (
            existentePorClave.telefono_normalizado
            !== datosTelefono.telefono_normalizado
        ) {
            throw errorHttp(409, "La confirmación ya fue usada para otro número");
        }

        return {
            creada: false,
            idempotente: true,
            gestion_id: existentePorClave.id,
            analisis: await analizarTelefonoPrimerContacto(
                telefono,
                req.user.usuario,
                tx,
                contextoCrm
            )
        };
    }

    const analisis = await analizarTelefonoPrimerContacto(
        telefono,
        req.user.usuario,
        tx,
        contextoCrm
    );

    if (analisis.no_enviar_mensajes) {
        throw errorHttp(
            409,
            "NO ENVIAR MENSAJES: este teléfono tiene una restricción activa"
        );
    }

    const procedencia = analisis.contacto_id
        ? await obtenerProcedenciaPorCodigo(
            analisis.procedencia?.codigo || "sin_informar",
            tx
        )
        : await requerirProcedenciaSeleccionable(procedencia_codigo, tx);

    if (analisis.ya_contactado_por_mi && !confirmar_repetido) {
        throw errorHttp(
            409,
            "Ya registraste un contacto con este número. Confirmá el nuevo intento."
        );
    }

    const identidad = await obtenerOCrearIdentidadPrimerContacto(
        tx,
        datosTelefono,
        analisis.cliente,
        nombreLimpio,
        analisis.contacto_id,
        procedencia
    );
    const usuario = await obtenerUsuarioPorNombre(req.user.usuario, tx);

    if (!analisis.contacto_id) {
        await tx.run(
            `
            INSERT INTO primer_contacto_procedencia_historial (
                contacto_id,
                procedencia_anterior_id,
                procedencia_nueva_id,
                accion,
                usuario_id,
                usuario,
                motivo,
                clave_idempotencia
            )
            VALUES (?, NULL, ?, 'asignacion_inicial', ?, ?, NULL, ?)
            ON CONFLICT (clave_idempotencia) DO NOTHING
            `,
            [
                identidad.id,
                identidad.procedencia_id,
                usuario?.id || null,
                req.user.usuario,
                `procedencia-inicial:${identidad.id}`
            ]
        );
    }
    let gestionId = null;
    let creada = false;

    if (db.type === "postgres") {
        const insertada = await tx.get(
            `
            INSERT INTO primer_contacto_gestiones (
                contacto_id,
                usuario_id,
                asesora,
                observacion,
                clave_idempotencia
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (asesora, clave_idempotencia) DO NOTHING
            RETURNING id
            `,
            [
                identidad.id,
                usuario?.id || null,
                req.user.usuario,
                observacionLimpia,
                clave
            ]
        );
        gestionId = insertada?.id || null;
        creada = Boolean(insertada);
    } else {
        const insertada = await tx.run(
            `
            INSERT OR IGNORE INTO primer_contacto_gestiones (
                contacto_id,
                usuario_id,
                asesora,
                observacion,
                clave_idempotencia
            )
            VALUES (?, ?, ?, ?, ?)
            `,
            [
                identidad.id,
                usuario?.id || null,
                req.user.usuario,
                observacionLimpia,
                clave
            ]
        );
        gestionId = insertada.lastID || null;
        creada = insertada.changes > 0;
    }

    if (!gestionId) {
        const existente = await tx.get(
            `
            SELECT id
            FROM primer_contacto_gestiones
            WHERE asesora = ? AND clave_idempotencia = ?
            `,
            [req.user.usuario, clave]
        );
        gestionId = existente?.id || null;
    }

    return {
        creada,
        idempotente: !creada,
        gestion_id: gestionId,
        analisis: await analizarTelefonoPrimerContacto(
            telefono,
            req.user.usuario,
            tx
        )
    };
}

async function obtenerClienteParaCotizacion(tx, datosCliente, clienteId, terminoBusqueda = "") {
    if (clienteId) {
        if (!/^\d+$/.test(String(clienteId))) {
            throw errorHttp(400, "Cliente inválido");
        }

        const cliente = await tx.get(
            "SELECT * FROM clientes WHERE id = ?",
            [clienteId]
        );

        if (!cliente) {
            throw errorHttp(404, "Cliente no encontrado");
        }

        const identidadesDatos = identidadesNormalizadasCliente(datosCliente);
        const coincideDatos = clienteTieneIdentidad(
            cliente,
            "dni",
            identidadesDatos.dni
        ) || clienteTieneIdentidad(
            cliente,
            "telefono",
            identidadesDatos.telefono
        );
        const coincideBusqueda = clienteCoincideConBusqueda(
            cliente,
            terminoBusqueda
        );

        if (!coincideDatos && !coincideBusqueda) {
            throw errorHttp(400, "Los datos no coinciden con el cliente");
        }

        return completarClienteConDatos(tx, cliente, datosCliente);
    }

    return crearClienteSiHaceFalta(
        tx,
        datosCliente,
        datosCliente.vendedora
    );
}

function datosIdentidadCotizacionDesdeBody(body = {}) {
    const dni = normalizarDni(body.dni);
    const dniNormalizado = normalizarDniIdentidad(dni);
    const celularIngresado = String(body.celular || "").trim();
    const celular = celularIngresado ? normalizarTelefono(celularIngresado) : null;

    if (!celular) {
        throw errorHttp(400, "Ingresá un teléfono");
    }
    if (dni && !/^\d{7,8}$/.test(dniNormalizado || "")) {
        throw errorHttp(400, "Ingresá un DNI válido de 7 u 8 dígitos");
    }
    if (!/^\d{10}$/.test(celular || "")) {
        throw errorHttp(400, "Ingresá un teléfono argentino válido");
    }

    return {
        dni,
        dni_normalizado: dniNormalizado,
        celular
    };
}

async function crearCotizacionDesdeRequest(req, archivos, clienteIdParam = null) {
    const {
        nombre,
        plan,
        tipo_cobertura,
        valor,
        bonificacion,
        bonificacion_aportes,
        modalidad,
        vigencia,
        referido,
        congelamiento,
        comentarios
    } = req.body;
    const { dni, celular } = datosIdentidadCotizacionDesdeBody(req.body);
    const opcionesCotizacion = opcionesDesdeBody(req.body);
    const opcionPrincipal = opcionesCotizacion[0] || normalizarOpcionCotizacion({}, 1);

    const vendedora = req.user.usuario;

    console.log("[agregar cotizacion]", {
        motor: db.type,
        campoTelefono: "celular",
        dniPresente: Boolean(dni),
        celularNormalizado: celular
    });

    return db.transaction(async tx => {
        const cliente = await obtenerClienteParaCotizacion(
            tx,
            {
                dni,
                nombre,
                celular,
                vendedora
            },
            clienteIdParam || req.body.cliente_id || null,
            req.body.termino_busqueda || req.query.termino || ""
        );
        const dniCotizacion = dni || cliente?.dni || null;
        const nombreCotizacion = nombre || cliente?.nombre || "";
        const celularCotizacion = celular
            || cliente?.telefono_normalizado
            || cliente?.celular
            || null;

        const resultado = await tx.run(
            `
            INSERT INTO cotizaciones
            (
                cliente_id,
                dni,
                nombre,
                celular,
                plan,
                tipo_cobertura,
                valor,
                bonificacion,
                bonificacion_aportes,
                modalidad,
                vendedora,
                vigencia,
                referido,
                congelamiento,
                comentarios
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                [
                    cliente?.id || null,
                    dniCotizacion,
                    nombreCotizacion,
                    celularCotizacion,
                    opcionPrincipal.plan,
                    opcionPrincipal.tipo_cobertura,
                    opcionPrincipal.valor,
                    opcionPrincipal.bonificacion,
                    opcionPrincipal.bonificacion_aportes,
                    modalidad,
                    vendedora,
                    vigencia,
                    referido,
                    congelamiento,
                    comentarios
                ]
            );

            const id = resultado.lastID;

            await insertarOpcionesCotizacion(tx, id, opcionesCotizacion);
            await insertarArchivosCotizacion(tx, id, archivos);

        return {
            id,
            cliente_id: cliente?.id || null
        };
    });
}

async function responderCreacionCotizacion(req, res, clienteIdParam = null) {
    const archivos = req.files || [];

    try {
        const resultado = await crearCotizacionDesdeRequest(
            req,
            archivos,
            clienteIdParam
        );

        res.json({
            success: true,
            id: resultado.id,
            cliente_id: resultado.cliente_id
        });
    } catch (error) {
        eliminarArchivosLocales(archivos);
        console.error("[agregar cotizacion] error:", {
            message: error.message,
            code: error.code,
            detail: error.detail,
            constraint: error.constraint,
            table: error.table,
            column: error.column
        });
        const conflictoUnico = error.code === "23505"
            || String(error.code || "").startsWith("SQLITE_CONSTRAINT");

        res.status(conflictoUnico ? 409 : error.status || 500).json({
            error: conflictoUnico
                ? "El DNI o teléfono ingresado ya pertenece a otro cliente"
                : error.status
                    ? error.message
                    : "No se pudo guardar la cotización"
        });
    }
}

async function editarPerfilCotizacion(req) {
    if (!/^\d+$/.test(String(req.params.id))) {
        throw errorHttp(400, "Cotización inválida");
    }

    const identidad = datosIdentidadCotizacionDesdeBody(req.body);
    const nombre = textoOpcionalPrimerContacto(req.body.nombre, 120);
    const congelamientoDefinido = Object.prototype.hasOwnProperty.call(
        req.body,
        "congelamiento"
    );
    const vigenciaDefinida = Object.prototype.hasOwnProperty.call(req.body, "vigencia");
    const opcionesDefinidas = Object.prototype.hasOwnProperty.call(req.body, "opciones");
    const congelamiento = congelamientoDefinido
        ? String(req.body.congelamiento || "").trim()
        : undefined;
    const vigencia = vigenciaDefinida
        ? String(req.body.vigencia || "").trim() || null
        : undefined;
    const opciones = opcionesDefinidas && Array.isArray(req.body.opciones)
        ? req.body.opciones.slice(0, 2).map((opcion, index) => ({
            numero_opcion: index + 1,
            plan: String(opcion.plan || "").trim(),
            tipo_cobertura: String(opcion.tipo_cobertura || "Individual").trim(),
            valor: validarImporteCotizacion(opcion.valor, "El subtotal"),
            bonificacion: validarImporteCotizacion(
                opcion.bonificacion ?? "0",
                "La bonificación comercial"
            ),
            bonificacion_aportes: validarImporteCotizacion(
                opcion.bonificacion_aportes ?? "0",
                "La bonificación de aportes"
            )
        }))
        : [];

    if (vigencia && !/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) {
        throw errorHttp(400, "La vigencia no es válida");
    }
    if (opcionesDefinidas && !opciones.length) {
        throw errorHttp(400, "Ingresá al menos una opción");
    }

    return db.transaction(async tx => {
        const cotizacion = await tx.get(
            `
            SELECT id, cliente_id, dni, nombre, celular, vendedora,
                   plan, tipo_cobertura
            FROM cotizaciones
            WHERE id = ?
            `,
            [req.params.id]
        );

        if (!cotizacion) throw errorHttp(404, "Cotización no encontrada");
        if (!puedeGestionarCotizacion(req, cotizacion)) {
            throw errorHttp(403, "No autorizado");
        }

        let cliente = cotizacion.cliente_id
            ? await tx.get("SELECT * FROM clientes WHERE id = ?", [cotizacion.cliente_id])
            : null;
        const datosCliente = {
            dni: identidad.dni,
            celular: identidad.celular,
            nombre,
            vendedora: cotizacion.vendedora
        };
        const identidades = identidadesNormalizadasCliente(datosCliente);
        const conflictos = await buscarClientesPorIdentidades(
            datosCliente,
            tx,
            cliente?.id || null
        );

        if (conflictos.length) {
            throw errorHttp(
                409,
                describirConflictoIdentidad(conflictos, identidades)
            );
        }

        await verificarConflictoPrimerContacto(
            tx,
            identidades.telefono,
            cliente?.id || null
        );

        if (!cliente) {
            cliente = await crearClienteSiHaceFalta(
                tx,
                datosCliente,
                cotizacion.vendedora
            );
        } else {
            const tipoIdentidad = cliente.identidad_tipo === "dni"
                && identidades.dni
                ? "dni"
                : cliente.identidad_tipo === "telefono" && identidades.telefono
                    ? "telefono"
                    : identidades.dni
                        ? "dni"
                        : "telefono";
            const valorIdentidad = tipoIdentidad === "dni"
                ? identidades.dni
                : identidades.telefono;

            await tx.run(
                `
                UPDATE clientes
                SET
                    identidad_tipo = ?,
                    identidad_valor = ?,
                    dni = ?,
                    dni_normalizado = ?,
                    nombre = ?,
                    celular = ?,
                    telefono_normalizado = ?,
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [
                    tipoIdentidad,
                    valorIdentidad,
                    identidad.dni,
                    identidades.dni,
                    nombre,
                    identidad.celular,
                    identidades.telefono,
                    cliente.id
                ]
            );
        }

        if (identidades.telefono) {
            await tx.run(
                `
                UPDATE primer_contacto_identidades
                SET
                    cliente_id = COALESCE(cliente_id, ?),
                    nombre = COALESCE(nombre, ?),
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE telefono_normalizado = ?
                `,
                [cliente.id, nombre, identidades.telefono]
            );
        }

        await tx.run(
            `
            UPDATE cotizaciones
            SET cliente_id = ?, dni = ?, nombre = ?, celular = ?
            WHERE cliente_id = ? OR id = ?
            `,
            [
                cliente.id,
                identidad.dni,
                nombre,
                identidad.celular,
                cliente.id,
                cotizacion.id
            ]
        );

        for (const opcion of opciones) {
            const plan = opcion.plan
                || (opcion.numero_opcion === 1 ? cotizacion.plan : "");
            const tipoCobertura = opcion.tipo_cobertura
                || (opcion.numero_opcion === 1
                    ? cotizacion.tipo_cobertura || "Individual"
                    : "Individual");

            await tx.run(
                `INSERT INTO cotizacion_opciones
                 (cotizacion_id, numero_opcion, plan, tipo_cobertura,
                  valor, bonificacion, bonificacion_aportes)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (cotizacion_id, numero_opcion) DO UPDATE SET
                    plan = EXCLUDED.plan,
                    tipo_cobertura = EXCLUDED.tipo_cobertura,
                    valor = EXCLUDED.valor,
                    bonificacion = EXCLUDED.bonificacion,
                    bonificacion_aportes = EXCLUDED.bonificacion_aportes`,
                [
                    cotizacion.id,
                    opcion.numero_opcion,
                    plan,
                    tipoCobertura,
                    opcion.valor,
                    opcion.bonificacion,
                    opcion.bonificacion_aportes
                ]
            );
        }

        const camposComerciales = [];
        const valoresComerciales = [];
        const principal = opciones[0];

        if (principal) {
            camposComerciales.push(
                "valor = ?",
                "bonificacion = ?",
                "bonificacion_aportes = ?"
            );
            valoresComerciales.push(
                principal.valor,
                principal.bonificacion,
                principal.bonificacion_aportes
            );
        }
        if (congelamientoDefinido) {
            camposComerciales.push("congelamiento = ?");
            valoresComerciales.push(congelamiento || null);
        }
        if (vigenciaDefinida) {
            camposComerciales.push("vigencia = ?");
            valoresComerciales.push(vigencia);
        }
        if (camposComerciales.length) {
            valoresComerciales.push(cotizacion.id);
            await tx.run(
                `UPDATE cotizaciones
                 SET ${camposComerciales.join(", ")}
                 WHERE id = ?`,
                valoresComerciales
            );
        }

        return {
            id: cotizacion.id,
            cliente_id: cliente.id,
            dni: identidad.dni,
            dni_normalizado: identidades.dni,
            nombre,
            celular: identidad.celular,
            telefono_normalizado: identidades.telefono,
            congelamiento,
            vigencia,
            opciones
        };
    });
}

app.post("/agregar", verificarToken, uploadImagenesNuevaCotizacion, async (req, res) => {
    responderCreacionCotizacion(req, res);
});

app.post("/clientes/:id/cotizaciones", verificarToken, uploadImagenesNuevaCotizacion, async (req, res) => {
    responderCreacionCotizacion(req, res, req.params.id);
});

app.put("/cotizaciones/:id/perfil", verificarToken, async (req, res) => {
    try {
        const perfil = await editarPerfilCotizacion(req);
        res.json({ success: true, perfil });
    } catch (error) {
        const conflictoUnico = error.code === "23505"
            || String(error.code || "").startsWith("SQLITE_CONSTRAINT");

        res.status(conflictoUnico ? 409 : error.status || 500).json({
            error: conflictoUnico
                ? "El DNI o teléfono ingresado ya pertenece a otro cliente"
                : error.status
                    ? error.message
                    : "No se pudo actualizar el perfil de la cotización"
        });
    }
});

function validarImporteCotizacion(valor, etiqueta) {
    const texto = String(valor ?? "").trim();
    const numero = Number(texto.replace(/\./g, "").replace(",", "."));

    if (!texto || !Number.isFinite(numero) || numero < 0) {
        throw errorHttp(400, `${etiqueta} debe ser un importe válido`);
    }

    return texto;
}

function booleanoBase(valor) {
    return valor === true || valor === 1 || valor === "1";
}

async function obtenerProcedenciaPorCodigo(
    codigo,
    tx = null,
    { seleccionable = false } = {}
) {
    const valor = String(codigo || "").trim();
    if (!valor) return null;

    const store = storePrimerContacto(tx);
    return store.get(
        `
        SELECT id, codigo, nombre, seleccionable, activa, orden
        FROM procedencias
        WHERE codigo = ?
          AND activa = TRUE
          ${seleccionable ? "AND seleccionable = TRUE" : ""}
        LIMIT 1
        `,
        [valor]
    );
}

async function requerirProcedenciaSeleccionable(codigo, tx = null) {
    if (!CODIGOS_PROCEDENCIA_SELECCIONABLES.includes(String(codigo || ""))) {
        throw errorHttp(400, "Seleccioná una procedencia válida");
    }

    const procedencia = await obtenerProcedenciaPorCodigo(
        codigo,
        tx,
        { seleccionable: true }
    );
    if (!procedencia) {
        throw errorHttp(400, "La procedencia no está disponible");
    }

    return procedencia;
}

async function cargarDetalleIdentidadPrimerContacto(identidad, tx = null) {
    if (!identidad) {
        return {
            procedencia: null,
            no_interesa: false,
            no_enviar_mensajes: false,
            historial_procedencia: [],
            historial_contactabilidad: []
        };
    }

    const store = storePrimerContacto(tx);
    const procedencia = identidad.procedencia_id
        ? await store.get(
            `SELECT id, codigo, nombre, seleccionable
             FROM procedencias WHERE id = ?`,
            [identidad.procedencia_id]
        )
        : null;
    const historialProcedencia = await store.all(
        `
        SELECT
            historial.id,
            historial.accion,
            historial.usuario,
            historial.motivo,
            historial.fecha,
            anterior.nombre AS procedencia_anterior,
            nueva.nombre AS procedencia_nueva
        FROM primer_contacto_procedencia_historial historial
        LEFT JOIN procedencias anterior
            ON anterior.id = historial.procedencia_anterior_id
        JOIN procedencias nueva
            ON nueva.id = historial.procedencia_nueva_id
        WHERE historial.contacto_id = ?
        ORDER BY historial.fecha DESC, historial.id DESC
        `,
        [identidad.id]
    );
    const historialContactabilidad = await store.all(
        `
        SELECT id, marca, valor_anterior, valor_nuevo, usuario, motivo, fecha
        FROM primer_contacto_contactabilidad_historial
        WHERE contacto_id = ?
        ORDER BY fecha DESC, id DESC
        `,
        [identidad.id]
    );

    return {
        procedencia,
        no_interesa: booleanoBase(identidad.no_interesa),
        no_enviar_mensajes: booleanoBase(identidad.no_enviar_mensajes),
        historial_procedencia: historialProcedencia,
        historial_contactabilidad: historialContactabilidad.map(item => ({
            ...item,
            valor_anterior: booleanoBase(item.valor_anterior),
            valor_nuevo: booleanoBase(item.valor_nuevo)
        }))
    };
}

app.put("/cotizaciones/:id/importes", verificarToken, async (req, res) => {
    try {
        const opciones = Array.isArray(req.body.opciones)
            ? req.body.opciones.slice(0, 2)
            : [];

        if (!opciones.length) throw errorHttp(400, "Ingresá al menos una opción");

        const normalizadas = opciones.map((opcion, index) => ({
            numero_opcion: index + 1,
            valor: validarImporteCotizacion(opcion.valor, "El subtotal"),
            bonificacion: validarImporteCotizacion(opcion.bonificacion ?? "0", "La bonificación comercial"),
            bonificacion_aportes: validarImporteCotizacion(opcion.bonificacion_aportes ?? "0", "La bonificación de aportes")
        }));

        await db.transaction(async tx => {
            const cotizacion = await tx.get(
                "SELECT id, vendedora FROM cotizaciones WHERE id = ?",
                [req.params.id]
            );
            if (!cotizacion) throw errorHttp(404, "Cotización no encontrada");
            if (!puedeGestionarCotizacion(req, cotizacion)) {
                throw errorHttp(403, "No autorizado");
            }

            for (const opcion of normalizadas) {
                const resultado = await tx.run(
                    `UPDATE cotizacion_opciones
                     SET valor = ?, bonificacion = ?, bonificacion_aportes = ?
                     WHERE cotizacion_id = ? AND numero_opcion = ?`,
                    [opcion.valor, opcion.bonificacion, opcion.bonificacion_aportes,
                        cotizacion.id, opcion.numero_opcion]
                );
                if (!resultado.changes && opcion.numero_opcion === 1) {
                    throw errorHttp(404, "No se encontró la opción principal");
                }
            }

            const principal = normalizadas[0];
            await tx.run(
                `UPDATE cotizaciones
                 SET valor = ?, bonificacion = ?, bonificacion_aportes = ?
                 WHERE id = ?`,
                [principal.valor, principal.bonificacion,
                    principal.bonificacion_aportes, cotizacion.id]
            );
        });

        res.json({ success: true, opciones: normalizadas });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudieron actualizar los importes"
        });
    }
});

app.delete("/cotizaciones/:id", verificarToken, async (req, res) => {
    try {
        const archivos = await db.transaction(async tx => {
            const cotizacion = await tx.get(
                "SELECT id, vendedora FROM cotizaciones WHERE id = ?",
                [req.params.id]
            );
            if (!cotizacion) throw errorHttp(404, "Cotización no encontrada");
            if (!puedeGestionarCotizacion(req, cotizacion)) {
                throw errorHttp(403, "No autorizado");
            }

            const adjuntos = await tx.all(
                "SELECT archivo FROM archivos WHERE cotizacion_id = ?",
                [cotizacion.id]
            );

            await tx.run(
                "UPDATE tareas_crm SET cotizacion_id = NULL, clave_automatica = NULL WHERE cotizacion_id = ?",
                [cotizacion.id]
            );
            await tx.run("DELETE FROM cotizaciones_posventa_historial WHERE cotizacion_id = ?", [cotizacion.id]);
            await tx.run("DELETE FROM comentarios_cotizacion WHERE cotizacion_id = ?", [cotizacion.id]);
            await tx.run("DELETE FROM archivos WHERE cotizacion_id = ?", [cotizacion.id]);
            await tx.run("DELETE FROM cotizacion_opciones WHERE cotizacion_id = ?", [cotizacion.id]);
            await tx.run("DELETE FROM cotizaciones WHERE id = ?", [cotizacion.id]);
            return adjuntos;
        });

        archivos.forEach(archivo => {
            const ruta = path.join(uploadsDir, path.basename(archivo.archivo || ""));
            fs.unlink(ruta, error => {
                if (error && error.code !== "ENOENT") {
                    console.error("No se pudo eliminar un adjunto de la cotización:", error);
                }
            });
        });
        res.json({ success: true });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo eliminar la cotización"
        });
    }
});

app.get("/primer-contacto/procedencias", verificarToken, async (req, res) => {
    try {
        const incluirHistorica = req.query.incluir_historica === "1";
        const rows = await dbAllAsync(
            `
            SELECT id, codigo, nombre, seleccionable, orden
            FROM procedencias
            WHERE activa = TRUE
              ${incluirHistorica ? "" : "AND seleccionable = TRUE"}
            ORDER BY orden ASC, id ASC
            `
        );

        res.json(rows.map(row => ({
            ...row,
            seleccionable: booleanoBase(row.seleccionable)
        })));
    } catch (error) {
        res.status(500).json({ error: "No se pudieron cargar las procedencias" });
    }
});

app.get("/primer-contacto/resumen", verificarToken, async (req, res) => {
    const condicionesGestion = ["resumen_gestiones.contacto_id = identidades.id"];
    const parametros = [];
    const asesora = String(req.query.asesora || "").trim();
    const procedencia = String(req.query.procedencia || "").trim();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();

    if (req.user.rol !== "admin" || req.query.vista === "mis") {
        condicionesGestion.push("resumen_gestiones.asesora = ?");
        parametros.push(req.user.usuario);
    } else if (asesora) {
        condicionesGestion.push("resumen_gestiones.asesora = ?");
        parametros.push(asesora);
    }

    for (const [valor, operador, sufijo] of [
        [fechaDesde, ">=", " 00:00:00"],
        [fechaHasta, "<=", " 23:59:59.999"]
    ]) {
        if (!valor) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
            return res.status(400).json({ error: "Fecha inválida" });
        }
        condicionesGestion.push(`resumen_gestiones.fecha ${operador} ?`);
        parametros.push(`${valor}${sufijo}`);
    }

    const condicionProcedencia = procedencia
        ? "AND procedencias.codigo = ?"
        : "";
    if (procedencia) parametros.push(procedencia);

    try {
        const rows = await dbAllAsync(
            `
            SELECT
                procedencias.codigo,
                procedencias.nombre,
                procedencias.seleccionable,
                procedencias.orden,
                COUNT(DISTINCT identidades.id) AS cantidad
            FROM procedencias
            LEFT JOIN primer_contacto_identidades identidades
                ON identidades.procedencia_id = procedencias.id
               AND EXISTS (
                    SELECT 1
                    FROM primer_contacto_gestiones resumen_gestiones
                    WHERE ${condicionesGestion.join(" AND ")}
               )
            WHERE procedencias.activa = TRUE
              ${condicionProcedencia}
            GROUP BY
                procedencias.id,
                procedencias.codigo,
                procedencias.nombre,
                procedencias.seleccionable,
                procedencias.orden
            ORDER BY procedencias.orden ASC, procedencias.id ASC
            `,
            parametros
        );
        const procedencias = rows
            .map(row => ({
                codigo: row.codigo,
                nombre: row.nombre,
                seleccionable: booleanoBase(row.seleccionable),
                cantidad: Number(row.cantidad || 0)
            }))
            .filter(item => item.codigo !== "sin_informar" || item.cantidad > 0);

        res.json({
            total: procedencias.reduce((total, item) => total + item.cantidad, 0),
            procedencias
        });
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el resumen" });
    }
});

app.put("/primer-contacto/:id/procedencia", verificarToken, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(400).json({ error: "Contacto inválido" });
    }

    try {
        const resultado = await db.transaction(async tx => {
            const nueva = await requerirProcedenciaSeleccionable(
                req.body.procedencia_codigo,
                tx
            );
            const identidad = await tx.get(
                `
                SELECT identidades.*, procedencias.codigo AS procedencia_codigo
                FROM primer_contacto_identidades identidades
                JOIN procedencias ON procedencias.id = identidades.procedencia_id
                WHERE identidades.id = ?
                `,
                [req.params.id]
            );
            if (!identidad) throw errorHttp(404, "Contacto no encontrado");
            if (String(identidad.procedencia_id) === String(nueva.id)) {
                return { actualizada: false, procedencia: nueva };
            }
            if (identidad.procedencia_codigo !== "sin_informar") {
                throw errorHttp(
                    409,
                    "La procedencia original no puede reemplazarse desde Primer Contacto"
                );
            }

            const usuario = await obtenerUsuarioPorNombre(req.user.usuario, tx);
            await tx.run(
                `UPDATE primer_contacto_identidades
                 SET procedencia_id = ?, fecha_actualizacion = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [nueva.id, identidad.id]
            );
            await tx.run(
                `
                INSERT INTO primer_contacto_procedencia_historial (
                    contacto_id, procedencia_anterior_id, procedencia_nueva_id,
                    accion, usuario_id, usuario, motivo, clave_idempotencia
                )
                VALUES (?, ?, ?, 'completado', ?, ?, NULL, ?)
                ON CONFLICT (clave_idempotencia) DO NOTHING
                `,
                [
                    identidad.id,
                    identidad.procedencia_id,
                    nueva.id,
                    usuario?.id || null,
                    req.user.usuario,
                    `procedencia-completada:${identidad.id}`
                ]
            );

            return { actualizada: true, procedencia: nueva };
        });

        res.json({ success: true, ...resultado });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo actualizar la procedencia"
        });
    }
});

app.put("/primer-contacto/:id/contactabilidad", verificarToken, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(400).json({ error: "Contacto inválido" });
    }

    const marca = String(req.body.marca || "").trim();
    const valor = req.body.valor;
    if (!MARCAS_CONTACTABILIDAD.includes(marca) || typeof valor !== "boolean") {
        return res.status(400).json({ error: "Cambio de contactabilidad inválido" });
    }
    if (marca === "no_enviar_mensajes" && !valor && req.user.rol !== "admin") {
        return res.status(403).json({
            error: "Sólo Administración puede retirar No enviar mensajes"
        });
    }
    if (
        marca === "no_enviar_mensajes"
        && !valor
        && req.body.confirmar_retiro !== true
    ) {
        return res.status(400).json({
            error: "Debés confirmar expresamente el retiro de la restricción"
        });
    }

    try {
        const motivo = textoOpcionalPrimerContacto(req.body.motivo, 500);
        if (marca === "no_enviar_mensajes" && !valor && !motivo) {
            throw errorHttp(400, "El motivo es obligatorio");
        }
        const clave = validarClavePrimerContacto(req.body.clave_idempotencia);
        const resultado = await db.transaction(async tx => {
            const previo = await tx.get(
                `SELECT id FROM primer_contacto_contactabilidad_historial
                 WHERE clave_idempotencia = ?`,
                [clave]
            );
            const identidad = await tx.get(
                "SELECT * FROM primer_contacto_identidades WHERE id = ?",
                [req.params.id]
            );
            if (!identidad) throw errorHttp(404, "Contacto no encontrado");

            const anterior = booleanoBase(identidad[marca]);
            if (previo || anterior === valor) {
                return { actualizada: false, marca, valor: anterior };
            }

            const usuario = await obtenerUsuarioPorNombre(req.user.usuario, tx);
            await tx.run(
                `UPDATE primer_contacto_identidades
                 SET ${marca} = ?, fecha_actualizacion = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [valor, identidad.id]
            );
            await tx.run(
                `
                INSERT INTO primer_contacto_contactabilidad_historial (
                    contacto_id, marca, valor_anterior, valor_nuevo,
                    usuario_id, usuario, motivo, clave_idempotencia
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    identidad.id,
                    marca,
                    anterior,
                    valor,
                    usuario?.id || null,
                    req.user.usuario,
                    motivo,
                    clave
                ]
            );

            return { actualizada: true, marca, valor };
        });

        res.json({ success: true, ...resultado });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo actualizar la contactabilidad"
        });
    }
});

app.get("/primer-contacto", verificarToken, async (req, res) => {
    const condiciones = [];
    const parametros = [];
    const telefono = String(req.query.telefono || "").trim();
    const vista = String(req.query.vista || "").trim();
    const asesora = String(req.query.asesora || "").trim();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();
    const procedencia = String(req.query.procedencia || "").trim();

    if (req.user.rol !== "admin" || vista === "mis") {
        condiciones.push("gestiones.asesora = ?");
        parametros.push(req.user.usuario);
    } else if (asesora) {
        condiciones.push("gestiones.asesora = ?");
        parametros.push(asesora);
    }

    if (telefono) {
        const normalizado = normalizarTelefono(telefono);

        if (!normalizado) {
            return res.status(400).json({ error: "Teléfono inválido" });
        }

        condiciones.push("identidades.telefono_normalizado = ?");
        parametros.push(normalizado);
    }

    if (fechaDesde) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
            return res.status(400).json({ error: "Fecha desde inválida" });
        }

        condiciones.push("gestiones.fecha >= ?");
        parametros.push(`${fechaDesde} 00:00:00`);
    }

    if (fechaHasta) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
            return res.status(400).json({ error: "Fecha hasta inválida" });
        }

        condiciones.push("gestiones.fecha <= ?");
        parametros.push(`${fechaHasta} 23:59:59.999`);
    }

    if (procedencia) {
        condiciones.push("procedencias.codigo = ?");
        parametros.push(procedencia);
    }

    try {
        const gestiones = await dbAllAsync(
            `
            SELECT
                gestiones.id,
                gestiones.contacto_id,
                gestiones.usuario_id,
                gestiones.asesora,
                gestiones.observacion,
                gestiones.fecha,
                identidades.telefono_original,
                identidades.telefono_normalizado,
                identidades.cliente_id,
                identidades.procedencia_id,
                identidades.no_interesa,
                identidades.no_enviar_mensajes,
                procedencias.codigo AS procedencia_codigo,
                procedencias.nombre AS procedencia_nombre,
                COALESCE(clientes.nombre, identidades.nombre) AS nombre,
                clientes.dni AS cliente_dni,
                (
                    SELECT COUNT(*)
                    FROM primer_contacto_gestiones historial
                    WHERE historial.contacto_id = identidades.id
                ) AS cantidad_contactos,
                (
                    SELECT COUNT(*)
                    FROM cotizaciones
                    WHERE cotizaciones.cliente_id = identidades.cliente_id
                ) AS cantidad_cotizaciones
            FROM primer_contacto_gestiones gestiones
            JOIN primer_contacto_identidades identidades
                ON identidades.id = gestiones.contacto_id
            JOIN procedencias
                ON procedencias.id = identidades.procedencia_id
            LEFT JOIN clientes
                ON clientes.id = identidades.cliente_id
            ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
            ORDER BY gestiones.fecha DESC, gestiones.id DESC
            LIMIT 200
            `,
            parametros
        );

        const contextoCrm = await cargarContextoTelefonosCrm();

        res.json(gestiones.map(gestion => {
            const coincidenciaCrm = buscarContextoCrmPrimerContacto(
                gestion.telefono_normalizado,
                contextoCrm
            );
            const resumenCotizaciones = resumirCotizacionesPrimerContacto(
                coincidenciaCrm.cotizaciones
            );

            return {
                ...gestion,
                no_interesa: booleanoBase(gestion.no_interesa),
                no_enviar_mensajes: booleanoBase(gestion.no_enviar_mensajes),
                cantidad_contactos: Number(gestion.cantidad_contactos || 0),
                cantidad_cotizaciones: resumenCotizaciones.cantidad_cotizaciones_crm,
                ...resumenCotizaciones
            };
        }));
    } catch (error) {
        res.status(500).json({ error: "No se pudieron cargar los primeros contactos" });
    }
});

app.get("/primer-contacto/exportar-excel", verificarToken, async (req, res) => {
    const condiciones = [];
    const parametros = [];
    const vista = String(req.query.vista || "").trim();
    const asesora = String(req.query.asesora || "").trim();
    const fechaDesde = String(req.query.fecha_desde || "").trim();
    const fechaHasta = String(req.query.fecha_hasta || "").trim();

    if (req.user.rol !== "admin" || vista === "mis") {
        condiciones.push("gestiones.asesora = ?");
        parametros.push(req.user.usuario);
    } else if (asesora) {
        condiciones.push("gestiones.asesora = ?");
        parametros.push(asesora);
    }

    if (fechaDesde) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
            return res.status(400).json({ error: "Fecha desde invalida" });
        }
        condiciones.push("gestiones.fecha >= ?");
        parametros.push(`${fechaDesde} 00:00:00`);
    }

    if (fechaHasta) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
            return res.status(400).json({ error: "Fecha hasta invalida" });
        }
        condiciones.push("gestiones.fecha <= ?");
        parametros.push(`${fechaHasta} 23:59:59.999`);
    }

    try {
        const gestiones = await dbAllAsync(
            `
            SELECT
                gestiones.id AS gestion_id,
                gestiones.contacto_id,
                gestiones.fecha,
                gestiones.asesora,
                identidades.nombre AS nombre_identidad,
                identidades.telefono_original,
                identidades.telefono_normalizado,
                identidades.cliente_id,
                clientes.nombre AS nombre_cliente,
                (
                    SELECT COUNT(*)
                    FROM cotizaciones
                    WHERE cotizaciones.cliente_id = identidades.cliente_id
                ) AS cantidad_cotizaciones
            FROM primer_contacto_gestiones gestiones
            JOIN primer_contacto_identidades identidades
                ON identidades.id = gestiones.contacto_id
            LEFT JOIN clientes
                ON clientes.id = identidades.cliente_id
            ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
            ORDER BY gestiones.fecha DESC, gestiones.id DESC
            `,
            parametros
        );
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Primer contacto");
        const headers = [
            "Fecha",
            "Hora",
            "Asesora",
            "Nombre",
            "Tel\u00e9fono",
            "Tel\u00e9fono normalizado",
            "Cliente vinculado",
            "Cliente ID",
            "Cotizaciones vinculadas"
        ];
        const formatoFecha = new Intl.DateTimeFormat("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
        const formatoHora = new Intl.DateTimeFormat("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });

        workbook.creator = "Asismed";
        workbook.created = new Date();
        worksheet.addRow(headers);
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.alignment = { horizontal: "center", vertical: "middle" };
        headerRow.eachCell(cell => {
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF2E86C1" }
            };
        });

        gestiones.forEach(gestion => {
            const fecha = new Date(gestion.fecha);
            const fechaValida = !Number.isNaN(fecha.getTime());
            const clienteVinculado = gestion.cliente_id !== null
                && gestion.cliente_id !== undefined;
            const row = worksheet.addRow([
                fechaValida ? formatoFecha.format(fecha) : String(gestion.fecha || ""),
                fechaValida ? formatoHora.format(fecha) : "",
                gestion.asesora || "",
                gestion.nombre_cliente || gestion.nombre_identidad || "",
                gestion.telefono_original || gestion.telefono_normalizado || "",
                gestion.telefono_normalizado || "",
                clienteVinculado ? "S\u00ed" : "No",
                clienteVinculado ? gestion.cliente_id : "",
                Number(gestion.cantidad_cotizaciones || 0)
            ]);

            row.eachCell(cell => {
                cell.alignment = { vertical: "top", wrapText: true };
                cell.border = {
                    top: { style: "thin", color: { argb: "FFD9E2EC" } },
                    left: { style: "thin", color: { argb: "FFD9E2EC" } },
                    bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
                    right: { style: "thin", color: { argb: "FFD9E2EC" } }
                };
            });
        });

        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: Math.max(1, worksheet.rowCount), column: headers.length }
        };
        worksheet.views = [{ state: "frozen", ySplit: 1 }];
        [13, 9, 20, 26, 20, 22, 19, 12, 24].forEach((width, index) => {
            worksheet.getColumn(index + 1).width = width;
        });

        const fechaArchivo = new Date().toISOString().slice(0, 10);
        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="primer-contacto-${fechaArchivo}.xlsx"`
        );
        res.send(Buffer.from(buffer));
    } catch (error) {
        console.error("[primer-contacto-excel] error:", error.message);
        res.status(500).json({ error: "No se pudo generar el Excel" });
    }
});

app.get("/primer-contacto/buscar", verificarToken, async (req, res) => {
    try {
        const resultado = await analizarTelefonoPrimerContacto(
            req.query.telefono,
            req.user.usuario
        );

        res.json(resultado);
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo buscar el teléfono"
        });
    }
});

app.post("/primer-contacto/analizar-multiple", verificarToken, async (req, res) => {
    try {
        const procedencia = req.body.procedencia_codigo
            ? await requerirProcedenciaSeleccionable(req.body.procedencia_codigo)
            : null;
        const resultados = await analizarTandaPrimerContacto(
            req.body.numeros,
            req.user.usuario
        );

        res.json({
            limite: MAX_PRIMER_CONTACTO_TANDA,
            cantidad: resultados.length,
            procedencia,
            resultados
        });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudieron analizar los números"
        });
    }
});

app.post("/primer-contacto", verificarToken, async (req, res) => {
    try {
        const resultado = await db.transaction(tx =>
            registrarGestionPrimerContacto(tx, req, req.body)
        );

        res.status(resultado.creada ? 201 : 200).json({
            success: true,
            ...resultado
        });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo registrar el contacto"
        });
    }
});

app.post("/primer-contacto/confirmar-multiple", verificarToken, async (req, res) => {
    try {
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        const operacion = validarClavePrimerContacto(
            req.body.clave_operacion,
            "clave_operacion"
        );
        const procedenciaCodigo = String(req.body.procedencia_codigo || "").trim();
        await requerirProcedenciaSeleccionable(procedenciaCodigo);

        if (!items.length) {
            throw errorHttp(400, "Seleccioná al menos un número");
        }
        if (items.length > MAX_PRIMER_CONTACTO_TANDA) {
            throw errorHttp(
                400,
                `Podés cargar un máximo de ${MAX_PRIMER_CONTACTO_TANDA} números por vez.`
            );
        }

        const normalizados = new Set();
        const preparados = items.map(item => {
            const telefono = telefonoPrimerContacto(item.telefono);

            if (!telefono.valido) {
                throw errorHttp(400, "La selección contiene un número inválido");
            }
            if (normalizados.has(telefono.telefono_normalizado)) {
                throw errorHttp(400, "La selección contiene números repetidos");
            }

            normalizados.add(telefono.telefono_normalizado);

            return {
                telefono: item.telefono,
                nombre: item.nombre,
                observacion: item.observacion,
                procedencia_codigo: procedenciaCodigo,
                confirmar_repetido: Boolean(item.confirmar_repetido),
                clave_idempotencia:
                    `lote:${operacion}:${telefono.telefono_normalizado}`
            };
        });
        const resultados = await db.transaction(async tx => {
            const guardados = [];
            const contextoCrm = await cargarContextoTelefonosCrm(tx);

            for (const item of preparados) {
                guardados.push(await registrarGestionPrimerContacto(
                    tx,
                    req,
                    item,
                    contextoCrm
                ));
            }

            return guardados;
        });

        res.json({
            success: true,
            creadas: resultados.filter(resultado => resultado.creada).length,
            idempotentes: resultados.filter(resultado => resultado.idempotente).length,
            resultados
        });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudieron registrar los contactos"
        });
    }
});

app.post(
    "/subir-archivo/:id",
    verificarToken,
    async (req, res, next) => {
        try {
            await obtenerCotizacionParaGestion(req, req.params.id);
            next();
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.status ? error.message : "No se pudo verificar la cotización"
            });
        }
    },
    (req, res, next) => {
        db.get(
            `
            SELECT
                cotizaciones.id,
                COUNT(archivos.id) AS total_archivos
            FROM cotizaciones
            LEFT JOIN archivos
                ON archivos.cotizacion_id = cotizaciones.id
            WHERE cotizaciones.id = ?
            GROUP BY cotizaciones.id
            `,
            [req.params.id],
            (err, cotizacion) => {
                if (err) {
                    return res.status(500).json({
                        error: "No se pudo verificar la cotización"
                    });
                }

                if (!cotizacion) {
                    return res.status(404).json({
                        error: "Cotización no encontrada"
                    });
                }

                if (Number(cotizacion.total_archivos || 0) >= 5) {
                    return res.status(400).json({
                        error: "La cotización ya tiene el máximo de 5 imágenes"
                    });
                }

                next();
            }
        );
    },
    (req, res, next) => {
        upload.single("archivo")(req, res, err => {
            if (!err) {
                next();
                return;
            }

            if (err instanceof multer.MulterError &&
                err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({
                    error: "La imagen supera el máximo permitido de 5 MB"
                });
            }

            if (err.code === "TIPO_ARCHIVO_INVALIDO") {
                return res.status(400).json({ error: err.message });
            }

            console.error("Error al procesar imagen:", err);
            return res.status(500).json({
                error: "No se pudo procesar la imagen"
            });
        });
    },
    (req, res) => {

        const cotizacionId = req.params.id;

        if (!req.file) {
            return res.status(400).json({ error: "Archivo requerido" });
        }

        db.run(
            `INSERT INTO archivos (cotizacion_id, nombre, archivo)
             VALUES (?, ?, ?)`,
            [
                cotizacionId,
                req.file.originalname,
                req.file.filename
            ],
            function (err) {
                if (err) {
                    fs.unlink(req.file.path, () => { });
                    return res.status(500).json({
                        error: "No se pudo guardar el adjunto"
                    });
                }

                res.json({
                    success: true,
                    archivo: {
                        nombre: req.file.originalname,
                        archivo: req.file.filename
                    }
                });
            }
        );
    }
);

app.get("/archivos/:id", verificarToken, async (req, res) => {
    try {
        await obtenerCotizacionParaGestion(req, req.params.id);
        const rows = await dbAllAsync(
            `
            SELECT *
            FROM archivos
            WHERE cotizacion_id = ?
            ORDER BY fecha DESC
            `,
            [req.params.id]
        );
        res.json(rows);
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudieron cargar los adjuntos"
        });
    }
});

app.get("/archivos/:id/descargar", verificarToken, async (req, res) => {
    try {
        const archivo = await dbGetAsync(
            `
            SELECT archivos.*, cotizaciones.vendedora
            FROM archivos
            JOIN cotizaciones ON cotizaciones.id = archivos.cotizacion_id
            WHERE archivos.id = ?
            `,
            [req.params.id]
        );

        if (!archivo) throw errorHttp(404, "Adjunto no encontrado");
        if (!puedeGestionarCotizacion(req, archivo)) {
            throw errorHttp(403, "No autorizado");
        }

        res.sendFile(path.join(uploadsDir, path.basename(archivo.archivo || "")));
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo descargar el adjunto"
        });
    }
});

app.delete("/archivos/:id", verificarToken, (req, res) => {
    db.get(
        `
        SELECT archivos.*, cotizaciones.vendedora
        FROM archivos
        JOIN cotizaciones ON cotizaciones.id = archivos.cotizacion_id
        WHERE archivos.id = ?
        `,
        [req.params.id],
        (err, archivo) => {
            if (err) {
                return res.status(500).json({
                    error: "No se pudo buscar el adjunto"
                });
            }

            if (!archivo) {
                return res.status(404).json({
                    error: "Adjunto no encontrado"
                });
            }

            if (!puedeGestionarCotizacion(req, archivo)) {
                return res.status(403).json({ error: "No autorizado" });
            }

            const nombreSeguro = path.basename(archivo.archivo || "");
            const rutaArchivo = path.join(uploadsDir, nombreSeguro);

            fs.unlink(rutaArchivo, errorArchivo => {
                if (errorArchivo && errorArchivo.code !== "ENOENT") {
                    console.error("Error al eliminar adjunto:", errorArchivo);
                    return res.status(500).json({
                        error: "No se pudo eliminar la imagen guardada"
                    });
                }

                db.run(
                    "DELETE FROM archivos WHERE id = ?",
                    [archivo.id],
                    function (errorBase) {
                        if (errorBase) {
                            return res.status(500).json({
                                error: "No se pudo eliminar el registro del adjunto"
                            });
                        }

                        res.json({ success: true });
                    }
                );
            });
        }
    );
});

// 👉 EDITAR COMENTARIO
app.put("/editar-comentario/:id", verificarToken, (req, res) => {

    const { id } = req.params;
    const { comentarios } = req.body;

    const usuario = req.user.usuario;
    const rol = req.user.rol;

    db.get("SELECT * FROM cotizaciones WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json(err);

        if (!row) {
            return res.status(404).json({ error: "No encontrado" });
        }

        if (row.vendedora !== usuario && rol !== "admin") {
            return res.status(403).json({ error: "No autorizado" });
        }

        db.run(
            "UPDATE cotizaciones SET comentarios = ? WHERE id = ?",
            [comentarios, id],
            function (err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true });
            }
        );
    });
});
// 👉 AGREGAR COMENTARIO INTERNO
app.post("/comentarios/:id", verificarToken, (req, res) => {

    const cotizacionId = req.params.id;

    const { comentario } = req.body;

    if (!comentario) {
        return res.status(400).json({
            error: "Comentario vacío"
        });
    }

    db.get(
        "SELECT id FROM cotizaciones WHERE id = ?",
        [cotizacionId],
        (errorCotizacion, cotizacion) => {
            if (errorCotizacion) return res.status(500).json(errorCotizacion);
            if (!cotizacion) {
                return res.status(404).json({ error: "Cotización no encontrada" });
            }

            db.run(
                `
                INSERT INTO comentarios_cotizacion
                (
                    cotizacion_id,
                    usuario,
                    comentario
                )
                VALUES (?, ?, ?)
                `,
                [cotizacionId, req.user.usuario, comentario],
                function (err) {
                    if (err) return res.status(500).json(err);
                    res.json({ success: true, id: this.lastID });
                }
            );
        }
    );
});
// 👉 OBTENER COMENTARIOS
app.get("/comentarios/:id", verificarToken, (req, res) => {

    db.all(
        `
        SELECT *
        FROM comentarios_cotizacion
        WHERE cotizacion_id = ?
        ORDER BY fecha ASC
        `,
        [req.params.id],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);
        }
    );
});

// =======================
// 👥 USUARIOS
// =======================

// 👉 CREAR USUARIO
app.post("/crear-usuario", verificarToken, async (req, res) => {

    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    const { password, rol } = req.body;
    const usuario = req.body.usuario?.trim();

    if (!usuario || !password) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        const existente = await new Promise((resolve, reject) => {
            db.get(
                "SELECT id FROM usuarios WHERE TRIM(usuario) = ?",
                [usuario],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        if (existente) {
            return res.status(409).json({ error: "Usuario ya existe" });
        }

        const hash = await bcrypt.hash(password, 10);

        db.run(
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)",
            [usuario, hash, rol],
            function (err) {
                if (err) {
                    return res.status(409).json({ error: "Usuario ya existe" });
                }
                res.json({ success: true });
            }
        );

    } catch (error) {
        res.status(500).json({ error: "Error al encriptar" });
    }
});

// 👉 LISTAR USUARIOS
app.get("/usuarios", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    await usuariosOrdenReady;

    db.all(`SELECT id, TRIM(usuario) AS usuario, rol, orden_login FROM usuarios ORDER BY ${ordenLoginSql}`, [], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

// 👉 ELIMINAR USUARIO
app.delete("/usuarios/:id", verificarToken, (req, res) => {

    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: "Id de usuario invalido" });
    }

    db.get("SELECT * FROM usuarios WHERE id = ?", [id], (err, user) => {
        if (err) return res.status(500).json(err);

        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (user.usuario === "admin") {
            return res.status(403).json({ error: "No podés eliminar el admin" });
        }

        db.run("DELETE FROM usuarios WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        });
    });
});

// 👉 EDITAR USUARIO
app.put("/usuarios/:id", verificarToken, async (req, res) => {

    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    await usuariosOrdenReady;

    const { id } = req.params;
    const { password, rol } = req.body;
    const usuario = req.body.usuario?.trim();
    const tieneOrdenLogin = Object.prototype.hasOwnProperty.call(req.body, "orden_login");
    const ordenLogin = tieneOrdenLogin && req.body.orden_login !== "" && req.body.orden_login !== null
        ? Number(req.body.orden_login)
        : null;

    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: "Id de usuario invalido" });
    }

    if (req.body.usuario !== undefined && !usuario) {
        return res.status(400).json({ error: "El usuario no puede estar vacio" });
    }

    if (tieneOrdenLogin && ordenLogin !== null && (!Number.isInteger(ordenLogin) || ordenLogin < 1)) {
        return res.status(400).json({ error: "El orden debe ser un numero positivo" });
    }

    if (!usuario && !password && !rol && !tieneOrdenLogin) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    db.get("SELECT * FROM usuarios WHERE id = ?", [id], async (err, user) => {
        if (err) return res.status(500).json(err);

        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const actualizarUsuario = async () => {
            try {
                const campos = [];
                const valores = [];

                if (usuario && usuario !== user.usuario.trim()) {
                    campos.push("usuario = ?");
                    valores.push(usuario);
                }

                if (password) {
                    const hash = await bcrypt.hash(password, 10);
                    campos.push("password = ?");
                    valores.push(hash);
                }

                if (rol) {
                    campos.push("rol = ?");
                    valores.push(rol);
                }

                if (tieneOrdenLogin) {
                    campos.push("orden_login = ?");
                    valores.push(ordenLogin);
                }

                if (campos.length === 0) {
                    return res.json({ success: true });
                }

                valores.push(id);

                db.run(
                    `UPDATE usuarios SET ${campos.join(", ")} WHERE id = ?`,
                    valores,
                    function (errUpdate) {
                        if (errUpdate) return res.status(500).json(errUpdate);
                        res.json({ success: true });
                    }
                );
            } catch (error) {
                res.status(500).json({ error: "Error al encriptar" });
            }
        };

        if (!usuario || usuario === user.usuario.trim()) {
            await actualizarUsuario();
            return;
        }

        db.get(
            "SELECT id FROM usuarios WHERE TRIM(usuario) = ? AND id <> ?",
            [usuario, id],
            async (errDuplicado, duplicado) => {
                if (errDuplicado) return res.status(500).json(errDuplicado);

                if (duplicado) {
                    return res.status(409).json({ error: "Ya existe otro usuario con ese nombre" });
                }

                await actualizarUsuario();
            }
        );
    });
});

// 👉 SERVIDOR
app.put("/cambiar-password", verificarToken, async (req, res) => {

    const { actual, nueva } = req.body;

    if (!actual || !nueva) {
        return res.status(400).json({
            error: "Completá todos los campos"
        });
    }

    db.get(
        "SELECT * FROM usuarios WHERE usuario = ?",
        [req.user.usuario],
        async (err, user) => {

            if (err) {
                return res.status(500).json(err);
            }

            if (!user) {
                return res.status(404).json({
                    error: "Usuario no encontrado"
                });
            }

            const coincide = await bcrypt.compare(
                actual,
                user.password
            );

            if (!coincide) {
                return res.status(401).json({
                    error: "Contraseña actual incorrecta"
                });
            }

            const hash = await bcrypt.hash(nueva, 10);

            db.run(
                "UPDATE usuarios SET password = ? WHERE id = ?",
                [hash, user.id],
                function (err) {

                    if (err) {
                        return res.status(500).json(err);
                    }

                    res.json({
                        success: true
                    });
                }
            );
        }
    );
});

app.get("/mi-telefono", verificarToken, async (req, res) => {
    if (req.user.rol !== "vendedora") {
        return res.status(403).json({ error: "Disponible únicamente para asesoras" });
    }

    try {
        const usuario = await dbGetAsync(
            "SELECT telefono FROM usuarios WHERE TRIM(usuario) = TRIM(?) AND rol = 'vendedora'",
            [req.user.usuario]
        );
        if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json({ telefono: usuario.telefono || "" });
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el teléfono" });
    }
});

app.put("/mi-telefono", verificarToken, async (req, res) => {
    if (req.user.rol !== "vendedora") {
        return res.status(403).json({ error: "Disponible únicamente para asesoras" });
    }

    const telefono = String(req.body.telefono || "").trim();
    if (telefono.length > 40 || (telefono && !/^[+0-9()\-\s]+$/.test(telefono))) {
        return res.status(400).json({ error: "Teléfono inválido" });
    }

    try {
        const resultado = await dbRunAsync(
            "UPDATE usuarios SET telefono = ? WHERE TRIM(usuario) = TRIM(?) AND rol = 'vendedora'",
            [telefono || null, req.user.usuario]
        );
        if (!resultado.changes) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json({ success: true, telefono });
    } catch (error) {
        res.status(500).json({ error: "No se pudo actualizar el teléfono" });
    }
});

app.delete("/comentarios/:id", verificarToken, (req, res) => {
    db.get(
        "SELECT * FROM comentarios_cotizacion WHERE id = ?",
        [req.params.id],
        (err, comentario) => {
            if (err) return res.status(500).json(err);
            if (!comentario) {
                return res.status(404).json({ error: "Comentario no encontrado" });
            }

            if (
                req.user.rol !== "admin"
                && comentario.usuario !== req.user.usuario
            ) {
                return res.status(403).json({ error: "No autorizado" });
            }

            db.run(
                "DELETE FROM comentarios_cotizacion WHERE id = ?",
                [comentario.id],
                errorDelete => {
                    if (errorDelete) return res.status(500).json(errorDelete);
                    res.json({ success: true });
                }
            );
        }
    );
});

function rangoMesActual() {
    const ahora = new Date();
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

    return {
        inicio: inicio.toISOString().slice(0, 10),
        fin: fin.toISOString().slice(0, 10),
        hoy: ahora.toISOString().slice(0, 10)
    };
}

function rangoMesDesdeQuery(mes) {
    const match = String(mes || "").match(/^(\d{4})-(\d{2})$/);
    const base = match
        ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
        : new Date();
    const inicio = new Date(base.getFullYear(), base.getMonth(), 1);
    const fin = new Date(base.getFullYear(), base.getMonth() + 1, 1);

    return {
        inicio: inicio.toISOString().slice(0, 10),
        fin: fin.toISOString().slice(0, 10)
    };
}

function filtroCotizacionesPorRol(req, alias = "cotizaciones") {
    if (req.user.rol === "admin") {
        const asesora = String(req.query.asesora || "").trim();

        return {
            sql: asesora
                ? `${alias}.vendedora = ? AND EXISTS (
                    SELECT 1 FROM usuarios
                    WHERE usuarios.rol = 'vendedora'
                      AND TRIM(usuarios.usuario) = TRIM(?)
                )`
                : `${alias}.vendedora IN (
                    SELECT usuarios.usuario FROM usuarios
                    WHERE usuarios.rol = 'vendedora'
                )`,
            params: asesora ? [asesora, asesora] : []
        };
    }

    return {
        sql: `${alias}.vendedora = ?`,
        params: [req.user.usuario]
    };
}

function agregarFiltroTareasPorRol(req, condiciones, parametros) {
    if (req.user.rol !== "admin") {
        condiciones.push("tareas_crm.usuario_responsable = ?");
        parametros.push(req.user.usuario);
        return;
    }

    const asesora = String(req.query.asesora || "").trim();

    if (asesora) {
        condiciones.push(`
            tareas_crm.usuario_responsable = ?
            AND EXISTS (
                SELECT 1 FROM usuarios
                WHERE usuarios.rol = 'vendedora'
                  AND TRIM(usuarios.usuario) = TRIM(?)
            )
        `);
        parametros.push(asesora, asesora);
        return;
    }

    condiciones.push(`
        tareas_crm.usuario_responsable IN (
            SELECT usuarios.usuario FROM usuarios
            WHERE usuarios.rol = 'vendedora'
        )
    `);
}

function agregarFiltroRol(req, condiciones, parametros, alias = "cotizaciones") {
    const filtro = filtroCotizacionesPorRol(req, alias);

    if (filtro.sql) {
        condiciones.push(filtro.sql);
        parametros.push(...filtro.params);
    }
}

async function obtenerUsuarioAutenticado(req, tx = null) {
    return obtenerUsuarioPorNombre(req.user.usuario, tx);
}

async function obtenerCotizacionPermitida(req, cotizacionId, tx = null) {
    if (!cotizacionId) return null;

    if (!/^\d+$/.test(String(cotizacionId))) {
        throw errorHttp(400, "Cotización inválida");
    }

    const executor = tx || {
        get: dbGetAsync
    };
    const cotizacion = await executor.get(
        `
        SELECT
            id,
            cliente_id,
            nombre,
            vendedora,
            estado,
            etapa_pipeline,
            fecha_alta,
            estado_posventa
        FROM cotizaciones
        WHERE id = ?
        `,
        [cotizacionId]
    );

    if (!cotizacion) {
        throw errorHttp(404, "Cotización no encontrada");
    }

    if (req.user.rol !== "admin" && cotizacion.vendedora !== req.user.usuario) {
        throw errorHttp(403, "No autorizado");
    }

    return cotizacion;
}

async function registrarHistorialPosventa(
    tx,
    cotizacion,
    estadoAnterior,
    estadoNuevo,
    fechaAlta,
    req
) {
    if (estadoAnterior === estadoNuevo) return;

    const usuario = await obtenerUsuarioAutenticado(req, tx);

    await tx.run(
        `
        INSERT INTO cotizaciones_posventa_historial
        (
            cotizacion_id,
            estado_anterior,
            estado_nuevo,
            fecha_alta,
            usuario_id,
            usuario
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            cotizacion.id,
            estadoAnterior || null,
            estadoNuevo,
            fechaAlta,
            usuario?.id || null,
            req.user.usuario
        ]
    );
}

async function sincronizarTareaAutomaticaPosventa(
    tx,
    cotizacion,
    usuarioResponsable,
    clave,
    titulo,
    fecha
) {
    await tx.run(
        `
        INSERT INTO tareas_crm
        (
            titulo,
            descripcion,
            fecha,
            hora,
            tipo,
            estado,
            usuario_responsable_id,
            usuario_responsable,
            cotizacion_id,
            cliente_id,
            clave_automatica
        )
        VALUES (?, ?, ?, NULL, 'seguimiento', 'pendiente', ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        `,
        [
            titulo,
            "Seguimiento automático de posventa",
            fecha,
            usuarioResponsable?.id || null,
            cotizacion.vendedora,
            cotizacion.id,
            cotizacion.cliente_id || null,
            clave
        ]
    );

    await tx.run(
        `
        UPDATE tareas_crm
        SET
            titulo = ?,
            descripcion = ?,
            fecha = ?,
            usuario_responsable_id = ?,
            usuario_responsable = ?,
            cliente_id = ?,
            fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE cotizacion_id = ?
          AND clave_automatica = ?
        `,
        [
            titulo,
            "Seguimiento automático de posventa",
            fecha,
            usuarioResponsable?.id || null,
            cotizacion.vendedora,
            cotizacion.cliente_id || null,
            cotizacion.id,
            clave
        ]
    );
}

async function sincronizarTareasPosventa(tx, cotizacion, fechaAlta) {
    if (!fechaAlta) return;

    const usuarioResponsable = await obtenerUsuarioPorNombre(
        cotizacion.vendedora,
        tx
    );
    const nombre = cotizacion.nombre || `cotización #${cotizacion.id}`;

    await sincronizarTareaAutomaticaPosventa(
        tx,
        cotizacion,
        usuarioResponsable,
        CLAVES_TAREAS_POSVENTA.segundaCuota,
        `Verificar segunda cuota de ${nombre}`,
        sumarMesesCalendario(fechaAlta, 1)
    );
    await sincronizarTareaAutomaticaPosventa(
        tx,
        cotizacion,
        usuarioResponsable,
        CLAVES_TAREAS_POSVENTA.terceraCuota,
        `Confirmar pago de las 3 cuotas de ${nombre}`,
        sumarMesesCalendario(fechaAlta, 2)
    );
}

async function cerrarTareasPosventa(tx, cotizacionId, estadoPosventa) {
    const estadoTarea = estadoPosventa === "pago_3_meses"
        ? "realizada"
        : estadoPosventa === "baja_mora"
            ? "cancelada"
            : null;

    if (!estadoTarea) return;

    await tx.run(
        `
        UPDATE tareas_crm
        SET estado = ?,
            fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE cotizacion_id = ?
          AND clave_automatica IS NOT NULL
          AND estado = 'pendiente'
        `,
        [estadoTarea, cotizacionId]
    );
}

function esEstadoCierreNegativo(estado) {
    return ESTADOS_CIERRE_NEGATIVO.includes(
        String(estado || "").trim().toLowerCase()
    );
}

function estadoCompatibleConEtapa(etapa) {
    return etapa === "Contactados" ? "Contactado" : "Nuevo";
}

function etapaCompatibleConEstado(estado) {
    return estado === "Contactado" ? "Contactados" : "Nuevos";
}

async function actualizarCamposTransicion(
    tx,
    cotizacionId,
    campos,
    valores
) {
    await tx.run(
        `UPDATE cotizaciones SET ${campos.join(", ")} WHERE id = ?`,
        [...valores, cotizacionId]
    );
}

async function aplicarTransicionComercial(
    tx,
    req,
    cotizacion,
    {
        estadoSolicitado,
        etapaSolicitada,
        fechaSeguimiento
    } = {}
) {
    const solicitaAfiliacion = estadoSolicitado === "Afiliado"
        || etapaSolicitada === "Afiliados";
    const campos = [];
    const valores = [];

    if (solicitaAfiliacion) {
        const fechaAlta = cotizacion.fecha_alta || null;
        const estadoPosventa = cotizacion.estado_posventa
            || (fechaAlta ? "en_seguimiento" : null);

        campos.push("estado = ?", "etapa_pipeline = ?");
        valores.push("Afiliado", "Afiliados");

        if (fechaSeguimiento !== undefined) {
            campos.push("fecha_seguimiento = ?");
            valores.push(fechaSeguimiento);
        }

        if (fechaAlta && !cotizacion.estado_posventa) {
            campos.push("estado_posventa = ?", "fecha_actualizacion_posventa = CURRENT_TIMESTAMP");
            valores.push(estadoPosventa);
        }

        await actualizarCamposTransicion(
            tx,
            cotizacion.id,
            campos,
            valores
        );

        if (fechaAlta) {
            await registrarHistorialPosventa(
                tx,
                cotizacion,
                cotizacion.estado_posventa,
                estadoPosventa,
                fechaAlta,
                req
            );
            await sincronizarTareasPosventa(tx, cotizacion, fechaAlta);
            await cerrarTareasPosventa(tx, cotizacion.id, estadoPosventa);
        }

        return {
            estado: "Afiliado",
            etapa_pipeline: "Afiliados",
            fecha_alta: fechaAlta,
            requiere_fecha_alta: !fechaAlta,
            ...calcularSeguimientoPosventa(fechaAlta, estadoPosventa),
            estado_posventa: estadoPosventa
        };
    }

    if (estadoSolicitado !== undefined) {
        campos.push("estado = ?");
        valores.push(estadoSolicitado);

        if (fechaSeguimiento !== undefined) {
            campos.push("fecha_seguimiento = ?");
            valores.push(fechaSeguimiento);
        }

        if (esEstadoCierreNegativo(estadoSolicitado)) {
            campos.push("etapa_pipeline = ?");
            valores.push(null);
        } else if (cotizacion.etapa_pipeline === "Afiliados") {
            campos.push("etapa_pipeline = ?");
            valores.push(etapaCompatibleConEstado(estadoSolicitado));
        }

        await actualizarCamposTransicion(
            tx,
            cotizacion.id,
            campos,
            valores
        );

        return {
            estado: estadoSolicitado,
            etapa_pipeline: esEstadoCierreNegativo(estadoSolicitado)
                ? null
                : cotizacion.etapa_pipeline === "Afiliados"
                    ? etapaCompatibleConEstado(estadoSolicitado)
                    : cotizacion.etapa_pipeline
        };
    }

    if (etapaSolicitada !== undefined) {
        const estado = cotizacion.estado === "Afiliado"
            ? estadoCompatibleConEtapa(etapaSolicitada)
            : cotizacion.estado;

        campos.push("etapa_pipeline = ?");
        valores.push(etapaSolicitada);

        if (estado !== cotizacion.estado) {
            campos.push("estado = ?");
            valores.push(estado);
        }

        await actualizarCamposTransicion(
            tx,
            cotizacion.id,
            campos,
            valores
        );

        return {
            estado,
            etapa_pipeline: etapaSolicitada
        };
    }

    return {
        estado: cotizacion.estado,
        etapa_pipeline: cotizacion.etapa_pipeline
    };
}

function detalleCalculadoPosventa(cotizacion) {
    const estado = cotizacion.estado_posventa
        || (cotizacion.fecha_alta ? "en_seguimiento" : null);

    return {
        ...calcularSeguimientoPosventa(
            cotizacion.fecha_alta,
            estado || "en_seguimiento"
        ),
        estado_posventa: estado
    };
}

async function obtenerDetallePosventa(req) {
    const cotizacion = await obtenerCotizacionPermitida(req, req.params.id);
    const aplica = cotizacion.estado === "Afiliado"
        && cotizacion.etapa_pipeline === "Afiliados";

    if (!aplica) {
        return {
            aplica: false,
            puede_editar: true
        };
    }

    const [proximaTarea, historial] = await Promise.all([
        dbGetAsync(
            `
            SELECT id, titulo, fecha, hora, estado
            FROM tareas_crm
            WHERE cotizacion_id = ?
              AND clave_automatica IS NOT NULL
              AND estado = 'pendiente'
            ORDER BY fecha ASC, hora ASC, id ASC
            LIMIT 1
            `,
            [cotizacion.id]
        ),
        dbAllAsync(
            `
            SELECT
                id,
                estado_anterior,
                estado_nuevo,
                fecha_alta,
                usuario,
                fecha
            FROM cotizaciones_posventa_historial
            WHERE cotizacion_id = ?
            ORDER BY fecha DESC, id DESC
            `,
            [cotizacion.id]
        )
    ]);

    return {
        aplica: true,
        puede_editar: true,
        cotizacion_id: cotizacion.id,
        fecha_alta: cotizacion.fecha_alta,
        etapa_pipeline: cotizacion.etapa_pipeline,
        requiere_fecha_alta: !cotizacion.fecha_alta,
        proxima_tarea: proximaTarea || null,
        historial,
        ...detalleCalculadoPosventa(cotizacion)
    };
}

async function resolverClienteTarea(req, cotizacionId, clienteId, tx) {
    const cotizacion = await obtenerCotizacionPermitida(req, cotizacionId, tx);

    if (cotizacion) {
        return {
            cotizacion_id: cotizacion.id,
            cliente_id: cotizacion.cliente_id || null
        };
    }

    if (!clienteId) {
        return {
            cotizacion_id: null,
            cliente_id: null
        };
    }

    if (!/^\d+$/.test(String(clienteId))) {
        throw errorHttp(400, "Cliente inválido");
    }

    const cliente = await tx.get(
        "SELECT id FROM clientes WHERE id = ?",
        [clienteId]
    );

    if (!cliente) {
        throw errorHttp(404, "Cliente no encontrado");
    }

    return {
        cotizacion_id: null,
        cliente_id: cliente.id
    };
}

function normalizarTareaBody(body, parcial = false) {
    const tarea = {
        titulo: body.titulo === undefined ? undefined : String(body.titulo || "").trim(),
        descripcion: body.descripcion === undefined ? undefined : String(body.descripcion || "").trim(),
        fecha: body.fecha === undefined ? undefined : String(body.fecha || "").trim(),
        hora: body.hora === undefined ? undefined : String(body.hora || "").trim(),
        tipo: body.tipo === undefined ? undefined : String(body.tipo || "").trim(),
        estado: body.estado === undefined ? undefined : String(body.estado || "").trim()
    };

    if (!parcial || tarea.titulo !== undefined) {
        if (!tarea.titulo) throw errorHttp(400, "El título es obligatorio");
    }

    if (!parcial || tarea.fecha !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tarea.fecha || "")) {
            throw errorHttp(400, "Fecha inválida");
        }
    }

    if (tarea.hora && !/^\d{2}:\d{2}$/.test(tarea.hora)) {
        throw errorHttp(400, "Hora inválida");
    }

    if (!parcial && !tarea.tipo) tarea.tipo = "tarea";
    if (!parcial && !tarea.estado) tarea.estado = "pendiente";

    if (tarea.tipo !== undefined && !TIPOS_TAREA_CRM.includes(tarea.tipo)) {
        throw errorHttp(400, "Tipo inválido");
    }

    if (tarea.estado !== undefined && !ESTADOS_TAREA_CRM.includes(tarea.estado)) {
        throw errorHttp(400, "Estado inválido");
    }

    return tarea;
}

function selectTareasCrm() {
    return `
        SELECT
            tareas_crm.*,
            cotizaciones.nombre AS cotizacion_nombre,
            cotizaciones.plan AS cotizacion_plan,
            cotizaciones.celular AS cotizacion_celular,
            cotizaciones.vendedora AS cotizacion_vendedora,
            COALESCE(NULLIF(cotizaciones.etapa_pipeline, ''), 'Nuevos') AS etapa_pipeline,
            clientes.nombre AS cliente_nombre
        FROM tareas_crm
        LEFT JOIN cotizaciones
            ON cotizaciones.id = tareas_crm.cotizacion_id
        LEFT JOIN clientes
            ON clientes.id = tareas_crm.cliente_id
    `;
}

async function obtenerEstadisticasInicio(req) {
    const rango = rangoMesActual();
    const filtro = filtroCotizacionesPorRol(req);
    const whereRol = filtro.sql ? `AND ${filtro.sql}` : "";
    const paramsRol = filtro.params;

    const cotizacionesMes = await dbGetAsync(
        `
        SELECT COUNT(*) AS total
        FROM cotizaciones
        WHERE date(fecha) >= date(?)
          AND date(fecha) < date(?)
          ${whereRol}
        `,
        [rango.inicio, rango.fin, ...paramsRol]
    );

    const nuevosClientesMes = await dbGetAsync(
        `
        SELECT COUNT(DISTINCT cliente_id) AS total
        FROM cotizaciones
        WHERE cliente_id IS NOT NULL
          AND date(fecha) >= date(?)
          AND date(fecha) < date(?)
          ${whereRol}
        `,
        [rango.inicio, rango.fin, ...paramsRol]
    );

    const afiliadosMes = await dbGetAsync(
        `
        SELECT COUNT(*) AS total
        FROM cotizaciones
        WHERE ${ESTADO_COTIZACION_SQL} = 'Afiliado'
          AND date(fecha) >= date(?)
          AND date(fecha) < date(?)
          ${whereRol}
        `,
        [rango.inicio, rango.fin, ...paramsRol]
    );

    const condicionesTareas = [];
    const parametrosTareas = [];
    agregarFiltroTareasPorRol(req, condicionesTareas, parametrosTareas);
    const condicionesCotizaciones = [];
    const parametrosCotizaciones = [];
    agregarFiltroRol(req, condicionesCotizaciones, parametrosCotizaciones);
    const seguimientosParams = [
        rango.hoy,
        ...parametrosTareas,
        rango.hoy,
        ...parametrosCotizaciones
    ];
    const seguimientosWhereTareas = condicionesTareas.length
        ? `AND ${condicionesTareas.join(" AND ")}`
        : "";
    const seguimientosWhereCotizaciones = condicionesCotizaciones.length
        ? `AND ${condicionesCotizaciones.join(" AND ")}`
        : "";
    const seguimientosPendientes = await dbGetAsync(
        `
        SELECT COUNT(*) AS total
        FROM (
            SELECT
                CASE
                    WHEN tareas_crm.cotizacion_id IS NOT NULL THEN 'cot-' || tareas_crm.cotizacion_id
                    ELSE 'task-' || tareas_crm.id
                END AS clave
            FROM tareas_crm
            WHERE tareas_crm.estado = 'pendiente'
              AND tareas_crm.tipo = 'seguimiento'
              AND date(tareas_crm.fecha) <= date(?)
              ${seguimientosWhereTareas}

            UNION

            SELECT 'cot-' || cotizaciones.id AS clave
            FROM cotizaciones
            WHERE cotizaciones.fecha_seguimiento IS NOT NULL
              AND date(cotizaciones.fecha_seguimiento) <= date(?)
              ${seguimientosWhereCotizaciones}
        ) pendientes
        `,
        seguimientosParams
    );

    return {
        cotizaciones_mes: Number(cotizacionesMes?.total || 0),
        nuevos_clientes_mes: Number(nuevosClientesMes?.total || 0),
        seguimientos_pendientes: Number(seguimientosPendientes?.total || 0),
        afiliados_mes: Number(afiliadosMes?.total || 0),
        comisiones_estimadas_mes: null
    };
}

async function obtenerPipelineInicio(req) {
    const condiciones = [OPORTUNIDAD_ACTIVA_SQL];
    const parametros = [];

    agregarFiltroRol(req, condiciones, parametros);

    const rows = await dbAllAsync(
        `
        SELECT
            cotizaciones.id,
            cotizaciones.cliente_id,
            cotizaciones.nombre,
            cotizaciones.celular,
            cotizaciones.plan,
            cotizaciones.fecha,
            cotizaciones.fecha_seguimiento,
            cotizaciones.vendedora,
            cotizaciones.fecha_alta,
            cotizaciones.estado_posventa,
            ${ESTADO_COTIZACION_SQL} AS estado,
            COALESCE(NULLIF(cotizaciones.etapa_pipeline, ''), 'Nuevos') AS etapa_pipeline
        FROM cotizaciones
        ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
        ORDER BY cotizaciones.fecha DESC
        `,
        parametros
    );

    return ETAPAS_PIPELINE.map(etapa => ({
        etapa,
        cotizaciones: rows
            .filter(row => normalizarEtapaPipeline(row.etapa_pipeline) === etapa)
            .map(row => ({
                ...row,
                etapa_pipeline: normalizarEtapaPipeline(row.etapa_pipeline),
                ...(row.fecha_alta || row.estado_posventa
                    ? detalleCalculadoPosventa(row)
                    : {})
            }))
    }));
}

async function obtenerTareasInicio(req, limite = 50) {
    const condiciones = [];
    const parametros = [];

    agregarFiltroTareasPorRol(req, condiciones, parametros);

    const rows = await dbAllAsync(
        `
        ${selectTareasCrm()}
        ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
        ORDER BY
            CASE tareas_crm.estado WHEN 'pendiente' THEN 0 ELSE 1 END,
            tareas_crm.fecha ASC,
            tareas_crm.hora ASC,
            tareas_crm.id DESC
        LIMIT ?
        `,
        [...parametros, limite]
    );

    return rows.map(row => ({
        ...row,
        etapa_pipeline: row.cotizacion_id
            ? normalizarEtapaPipeline(row.etapa_pipeline)
            : null
    }));
}

app.get("/inicio/resumen", verificarToken, async (req, res) => {
    try {
        const [estadisticas, pipeline, tareas] = await Promise.all([
            obtenerEstadisticasInicio(req),
            obtenerPipelineInicio(req),
            obtenerTareasInicio(req, 60)
        ]);

        res.json({
            estadisticas,
            pipeline,
            tareas,
            etapas: ETAPAS_PIPELINE
        });
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el inicio" });
    }
});

app.get("/pipeline", verificarToken, async (req, res) => {
    try {
        res.json(await obtenerPipelineInicio(req));
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el pipeline" });
    }
});

app.get("/cotizaciones/:id/telefono-asesora", verificarToken, async (req, res) => {
    try {
        const cotizacion = await obtenerCotizacionPermitida(req, req.params.id);
        const usuario = await dbGetAsync(
            `SELECT telefono FROM usuarios
             WHERE rol = 'vendedora' AND TRIM(usuario) = TRIM(?)`,
            [cotizacion.vendedora]
        );
        res.json({ telefono: usuario?.telefono || "" });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo cargar el teléfono"
        });
    }
});

app.put("/cotizaciones/:id/etapa-pipeline", verificarToken, async (req, res) => {
    const etapa = normalizarEtapaPipeline(req.body.etapa_pipeline);

    if (!ETAPAS_PIPELINE.includes(String(req.body.etapa_pipeline || "").trim())) {
        return res.status(400).json({ error: "Etapa inválida" });
    }

    try {
        const resultado = await db.transaction(async tx => {
            const cotizacion = await obtenerCotizacionPermitida(
                req,
                req.params.id,
                tx
            );

            return aplicarTransicionComercial(tx, req, cotizacion, {
                etapaSolicitada: etapa
            });
        });

        res.json({ success: true, ...resultado });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo actualizar la etapa"
        });
    }
});

app.get("/cotizaciones/:id/posventa", verificarToken, async (req, res) => {
    try {
        res.json(await obtenerDetallePosventa(req));
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status
                ? error.message
                : "No se pudo cargar el seguimiento de posventa"
        });
    }
});

app.put("/cotizaciones/:id/posventa", verificarToken, async (req, res) => {
    const fechaAltaSolicitada = req.body.fecha_alta === undefined
        ? undefined
        : String(req.body.fecha_alta || "").trim();
    const estadoSolicitado = req.body.estado_posventa === undefined
        ? undefined
        : String(req.body.estado_posventa || "").trim();

    if (
        fechaAltaSolicitada !== undefined
        && !esFechaIsoValida(fechaAltaSolicitada)
    ) {
        return res.status(400).json({ error: "Fecha de alta inválida" });
    }

    if (
        estadoSolicitado !== undefined
        && !ESTADOS_POSVENTA.includes(estadoSolicitado)
    ) {
        return res.status(400).json({ error: "Estado de posventa inválido" });
    }

    try {
        await db.transaction(async tx => {
            const cotizacion = await obtenerCotizacionPermitida(
                req,
                req.params.id,
                tx
            );
            const aplica = cotizacion.estado === "Afiliado"
                && cotizacion.etapa_pipeline === "Afiliados";

            if (!aplica) {
                throw errorHttp(
                    400,
                    "La cotización todavía no se encuentra en Afiliados"
                );
            }

            const fechaAlta = fechaAltaSolicitada ?? cotizacion.fecha_alta;
            const estadoPosventa = estadoSolicitado
                ?? cotizacion.estado_posventa
                ?? "en_seguimiento";

            if (!fechaAlta) {
                throw errorHttp(400, "La fecha de alta es obligatoria");
            }

            await tx.run(
                `
                UPDATE cotizaciones
                SET
                    fecha_alta = ?,
                    estado_posventa = ?,
                    fecha_actualizacion_posventa = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [fechaAlta, estadoPosventa, cotizacion.id]
            );

            await registrarHistorialPosventa(
                tx,
                cotizacion,
                cotizacion.estado_posventa,
                estadoPosventa,
                fechaAlta,
                req
            );
            await sincronizarTareasPosventa(tx, cotizacion, fechaAlta);
            await cerrarTareasPosventa(
                tx,
                cotizacion.id,
                estadoPosventa
            );
        });

        res.json({
            success: true,
            ...(await obtenerDetallePosventa(req))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status
                ? error.message
                : "No se pudo actualizar el seguimiento de posventa"
        });
    }
});

app.get("/tareas", verificarToken, async (req, res) => {
    const condiciones = [];
    const parametros = [];

    agregarFiltroTareasPorRol(req, condiciones, parametros);

    if (req.query.estado && !ESTADOS_TAREA_CRM.includes(String(req.query.estado))) {
        return res.status(400).json({ error: "Estado de tarea inválido" });
    }

    if (req.query.estado) {
        condiciones.push("tareas_crm.estado = ?");
        parametros.push(String(req.query.estado));
    }

    if (req.query.tipo && !TIPOS_TAREA_CRM.includes(String(req.query.tipo))) {
        return res.status(400).json({ error: "Tipo de tarea inválido" });
    }

    if (req.query.tipo) {
        condiciones.push("tareas_crm.tipo = ?");
        parametros.push(String(req.query.tipo));
    }

    if (req.query.fecha) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha))) {
            return res.status(400).json({ error: "Fecha inválida" });
        }

        condiciones.push("date(tareas_crm.fecha) = date(?)");
        parametros.push(String(req.query.fecha));
    }

    for (const campo of ["fecha_desde", "fecha_hasta"]) {
        if (
            req.query[campo]
            && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[campo]))
        ) {
            return res.status(400).json({ error: "Rango de fechas inválido" });
        }
    }

    if (
        req.query.fecha_desde
        && req.query.fecha_hasta
        && String(req.query.fecha_desde) > String(req.query.fecha_hasta)
    ) {
        return res.status(400).json({ error: "Rango de fechas inválido" });
    }

    if (req.query.fecha_desde) {
        condiciones.push("date(tareas_crm.fecha) >= date(?)");
        parametros.push(String(req.query.fecha_desde));
    }

    if (req.query.fecha_hasta) {
        condiciones.push("date(tareas_crm.fecha) <= date(?)");
        parametros.push(String(req.query.fecha_hasta));
    }

    if (req.query.mes) {
        const rango = rangoMesDesdeQuery(req.query.mes);
        condiciones.push("date(tareas_crm.fecha) >= date(?)");
        condiciones.push("date(tareas_crm.fecha) < date(?)");
        parametros.push(rango.inicio, rango.fin);
    }

    if (req.query.cliente) {
        condiciones.push(`
            LOWER(
                COALESCE(
                    NULLIF(clientes.nombre, ''),
                    NULLIF(cotizaciones.nombre, ''),
                    ''
                )
            ) LIKE LOWER(?)
        `);
        parametros.push(`%${String(req.query.cliente).trim()}%`);
    }

    if (req.query.cotizacion_id) {
        if (!/^\d+$/.test(String(req.query.cotizacion_id))) {
            return res.status(400).json({ error: "Cotización inválida" });
        }

        condiciones.push("tareas_crm.cotizacion_id = ?");
        parametros.push(String(req.query.cotizacion_id));
    }

    if (req.query.etapa_pipeline) {
        const etapa = String(req.query.etapa_pipeline).trim();

        if (!ETAPAS_PIPELINE.includes(etapa)) {
            return res.status(400).json({ error: "Etapa inválida" });
        }

        condiciones.push(`
            COALESCE(NULLIF(cotizaciones.etapa_pipeline, ''), 'Nuevos') = ?
        `);
        parametros.push(etapa);
    }

    if (req.query.responsable && req.user.rol === "admin") {
        condiciones.push("LOWER(tareas_crm.usuario_responsable) LIKE LOWER(?)");
        parametros.push(`%${String(req.query.responsable).trim()}%`);
    }

    try {
        const rows = await dbAllAsync(
            `
            ${selectTareasCrm()}
            ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
            ORDER BY
                tareas_crm.fecha ASC,
                CASE
                    WHEN tareas_crm.hora IS NULL
                        OR CAST(tareas_crm.hora AS TEXT) = '' THEN 1
                    ELSE 0
                END ASC,
                tareas_crm.hora ASC,
                tareas_crm.id DESC
            `,
            parametros
        );

        res.json(rows.map(row => ({
            ...row,
            etapa_pipeline: row.cotizacion_id
                ? normalizarEtapaPipeline(row.etapa_pipeline)
                : null
        })));
    } catch (error) {
        res.status(500).json({ error: "No se pudieron cargar las tareas" });
    }
});

app.post("/tareas", verificarToken, async (req, res) => {
    try {
        const tarea = normalizarTareaBody(req.body);

        const resultado = await db.transaction(async tx => {
            const asesora = req.user.rol === "admin"
                ? String(req.query.asesora || "").trim()
                : req.user.usuario;
            if (!asesora) {
                throw errorHttp(400, "Seleccioná una asesora para crear la tarea");
            }
            const usuario = await obtenerUsuarioPorNombre(asesora, tx);
            if (!usuario || usuario.rol !== "vendedora") {
                throw errorHttp(400, "La responsable debe ser una asesora");
            }
            const vinculo = await resolverClienteTarea(
                req,
                req.body.cotizacion_id || null,
                req.body.cliente_id || null,
                tx
            );

            return tx.run(
                `
                INSERT INTO tareas_crm
                (
                    titulo,
                    descripcion,
                    fecha,
                    hora,
                    tipo,
                    estado,
                    usuario_responsable_id,
                    usuario_responsable,
                    cotizacion_id,
                    cliente_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    tarea.titulo,
                    tarea.descripcion || null,
                    tarea.fecha,
                    tarea.hora || null,
                    tarea.tipo,
                    tarea.estado,
                    usuario?.id || null,
                    asesora,
                    vinculo.cotizacion_id,
                    vinculo.cliente_id
                ]
            );
        });

        res.json({ success: true, id: resultado.lastID });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo guardar la tarea"
        });
    }
});

app.put("/tareas/:id", verificarToken, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(400).json({ error: "Tarea inválida" });
    }

    try {
        const tarea = normalizarTareaBody(req.body, true);

        await db.transaction(async tx => {
            const actual = await tx.get(
                "SELECT * FROM tareas_crm WHERE id = ?",
                [req.params.id]
            );

            if (!actual) throw errorHttp(404, "Tarea no encontrada");
            if (req.user.rol !== "admin" && actual.usuario_responsable !== req.user.usuario) {
                throw errorHttp(403, "No autorizado");
            }

            const cambiaCotizacion = Object.prototype.hasOwnProperty.call(req.body, "cotizacion_id");
            const cambiaCliente = Object.prototype.hasOwnProperty.call(req.body, "cliente_id");
            const vinculo = cambiaCotizacion || cambiaCliente
                ? await resolverClienteTarea(
                    req,
                    req.body.cotizacion_id || null,
                    req.body.cliente_id || null,
                    tx
                )
                : {
                    cotizacion_id: actual.cotizacion_id,
                    cliente_id: actual.cliente_id
                };

            await tx.run(
                `
                UPDATE tareas_crm
                SET
                    titulo = ?,
                    descripcion = ?,
                    fecha = ?,
                    hora = ?,
                    tipo = ?,
                    estado = ?,
                    cotizacion_id = ?,
                    cliente_id = ?,
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [
                    tarea.titulo ?? actual.titulo,
                    tarea.descripcion ?? actual.descripcion,
                    tarea.fecha ?? actual.fecha,
                    tarea.hora ?? actual.hora,
                    tarea.tipo ?? actual.tipo,
                    tarea.estado ?? actual.estado,
                    vinculo.cotizacion_id,
                    vinculo.cliente_id,
                    req.params.id
                ]
            );
        });

        res.json({ success: true });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo actualizar la tarea"
        });
    }
});

app.put("/tareas/:id/realizada", verificarToken, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(400).json({ error: "Tarea inválida" });
    }

    try {
        const condiciones = ["id = ?"];
        const parametros = [req.params.id];

        if (req.user.rol !== "admin") {
            condiciones.push("usuario_responsable = ?");
            parametros.push(req.user.usuario);
        }

        const resultado = await dbRunAsync(
            `
            UPDATE tareas_crm
            SET estado = 'realizada',
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE ${condiciones.join(" AND ")}
            `,
            parametros
        );

        if (!resultado.changes) {
            return res.status(404).json({ error: "Tarea no encontrada" });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "No se pudo actualizar la tarea" });
    }
});

app.put("/tareas/:id/cancelar", verificarToken, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(400).json({ error: "Tarea inválida" });
    }

    try {
        const condiciones = ["id = ?"];
        const parametros = [req.params.id];

        if (req.user.rol !== "admin") {
            condiciones.push("usuario_responsable = ?");
            parametros.push(req.user.usuario);
        }

        const resultado = await dbRunAsync(
            `
            UPDATE tareas_crm
            SET estado = 'cancelada',
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE ${condiciones.join(" AND ")}
            `,
            parametros
        );

        if (!resultado.changes) {
            return res.status(404).json({ error: "Tarea no encontrada" });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "No se pudo cancelar la tarea" });
    }
});

app.get("/calendario", verificarToken, async (req, res) => {
    const rango = rangoMesDesdeQuery(req.query.mes);
    const condiciones = [
        "date(tareas_crm.fecha) >= date(?)",
        "date(tareas_crm.fecha) < date(?)"
    ];
    const parametros = [rango.inicio, rango.fin];

    agregarFiltroTareasPorRol(req, condiciones, parametros);

    try {
        const tareas = await dbAllAsync(
            `
            ${selectTareasCrm()}
            WHERE ${condiciones.join(" AND ")}
            ORDER BY tareas_crm.fecha ASC, tareas_crm.hora ASC
            `,
            parametros
        );

        const dias = tareas.reduce((grupo, tarea) => {
            const fecha = String(tarea.fecha).slice(0, 10);

            if (!grupo[fecha]) grupo[fecha] = [];

            grupo[fecha].push({
                id: tarea.id,
                titulo: tarea.titulo,
                tipo: tarea.tipo,
                estado: tarea.estado,
                etapa_pipeline: tarea.cotizacion_id
                    ? normalizarEtapaPipeline(tarea.etapa_pipeline)
                    : null
            });

            return grupo;
        }, {});

        res.json({
            mes: req.query.mes || null,
            dias
        });
    } catch (error) {
        res.status(500).json({ error: "No se pudo cargar el calendario" });
    }
});

app.put("/cotizaciones/:id/seguimiento", verificarToken, async (req, res) => {
    const id = req.params.id;
    const estado = normalizarEstadoCotizacion(req.body.estado);
    const fechaSeguimiento = req.body.fecha_seguimiento || null;

    if (!ESTADOS_COTIZACION.includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    if (estado === "Anulada" && req.user.rol !== "admin") {
        return res.status(403).json({ error: "Solo admin puede anular cotizaciones" });
    }

    if (
        fechaSeguimiento &&
        !/^\d{4}-\d{2}-\d{2}$/.test(fechaSeguimiento)
    ) {
        return res.status(400).json({ error: "Fecha de seguimiento inválida" });
    }

    try {
        const resultado = await db.transaction(async tx => {
            const cotizacion = await obtenerCotizacionPermitida(req, id, tx);

            return aplicarTransicionComercial(tx, req, cotizacion, {
                estadoSolicitado: estado,
                fechaSeguimiento
            });
        });

        res.json({ success: true, ...resultado });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo actualizar el seguimiento"
        });
    }
});

app.put("/cotizaciones/:id/anular", verificarToken, async (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: "Id de cotizacion invalido" });
    }

    try {
        const resultado = await db.transaction(async tx => {
            const cotizacion = await obtenerCotizacionPermitida(req, id, tx);

            return aplicarTransicionComercial(tx, req, cotizacion, {
                estadoSolicitado: "Anulada"
            });
        });

        res.json({ success: true, ...resultado });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.status ? error.message : "No se pudo anular la cotización"
        });
    }
});

function consultarCotizacionesFiltradas(req, callback) {
    const {
        estado,
        asesora,
        fecha_desde,
        fecha_hasta
    } = req.query;

    const condiciones = [];
    const parametros = [];

    if (estado) {
        condiciones.push(`${ESTADO_COTIZACION_SQL} = ?`);
        parametros.push(normalizarEstadoCotizacion(estado));
    }

    if (fecha_desde) {
        condiciones.push("date(fecha) >= date(?)");
        parametros.push(fecha_desde);
    }

    if (fecha_hasta) {
        condiciones.push("date(fecha) <= date(?)");
        parametros.push(fecha_hasta);
    }

    if (req.user.rol === "admin") {
        if (asesora) {
            condiciones.push("vendedora = ?");
            parametros.push(asesora);
        }

        return db.all(
            `
            ${SELECT_COTIZACIONES}
            ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
            ORDER BY fecha DESC
            `,
            parametros,
            callback
        );
    }

    return db.all(
        `
        ${SELECT_COTIZACIONES}
        WHERE vendedora = ?
        ${condiciones.length ? `AND ${condiciones.join(" AND ")}` : ""}
        ORDER BY fecha DESC
        `,
        [req.user.usuario, ...parametros],
        callback
    );
}

app.get("/mis-cotizaciones", verificarToken, (req, res) => {
    consultarCotizacionesFiltradas(req, (err, rows) => {
        if (err) return res.status(500).json(err);

        console.log("[mis-cotizaciones resultado]", {
            motor: db.type,
            usuario: req.user?.usuario,
            rol: req.user?.rol,
            filtros: req.query,
            resultados: rows.length,
            primerasColumnas: resumirCotizacionesParaLog(rows)
        });

        responderCotizacionesConArchivos(req, res, rows);
    });
});

app.get("/cotizaciones-excel", verificarToken, (req, res) => {
    consultarCotizacionesFiltradas(req, (err, rows) => {
        if (err) {
            res.status(500).json(err);
            return;
        }

        (async () => {
            const cotizaciones = normalizarCotizaciones(rows);
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Cotizaciones");
            const headers = [
                "Fecha",
                "DNI",
                "Nombre",
                "Telefono",
                "Plan",
                "Cobertura",
                "Valor",
                "Bonificacion comercial",
                "Bonificacion por aportes",
                "Modalidad",
                "Vigencia",
                "Referido",
                "Congelamiento",
                "Estado",
                "Fecha seguimiento",
                "Asesora",
                "Comentarios"
            ];
            const estadoFill = {
                Nuevo: "DDEBFF",
                Contactado: "E8F3FF",
                "Pendiente de pago": "FFF3CD",
                "No responde": "F8D7DA",
                Afiliado: "D4EDDA",
                Perdido: "E2E3E5",
                Anulada: "F5C6CB"
            };

            workbook.creator = "Asismed";
            workbook.created = new Date();

            worksheet.mergeCells(1, 1, 1, headers.length);
            const title = worksheet.getCell("A1");
            title.value = "Cotizaciones Asismed";
            title.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
            title.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF1B4F72" }
            };
            title.alignment = { horizontal: "center", vertical: "middle" };
            worksheet.getRow(1).height = 28;

            worksheet.addRow(headers);
            const headerRow = worksheet.getRow(2);
            headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
            headerRow.alignment = { horizontal: "center", vertical: "middle" };
            headerRow.eachCell(cell => {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FF2E86C1" }
                };
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" }
                };
            });

            cotizaciones.forEach(cotizacion => {
                const row = worksheet.addRow([
                    cotizacion.fecha || "",
                    cotizacion.dni || "",
                    cotizacion.nombre || "",
                    cotizacion.celular || "",
                    cotizacion.plan || "",
                    cotizacion.tipo_cobertura || "",
                    cotizacion.valor || "",
                    cotizacion.bonificacion || "",
                    cotizacion.bonificacion_aportes || "",
                    cotizacion.modalidad || "",
                    cotizacion.vigencia || "",
                    cotizacion.referido || "",
                    cotizacion.congelamiento || "",
                    cotizacion.estado || "",
                    cotizacion.fecha_seguimiento || "",
                    cotizacion.vendedora || "",
                    cotizacion.comentarios || ""
                ]);
                const fillColor = estadoFill[cotizacion.estado];

                row.eachCell(cell => {
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFD9E2EC" } },
                        left: { style: "thin", color: { argb: "FFD9E2EC" } },
                        bottom: { style: "thin", color: { argb: "FFD9E2EC" } },
                        right: { style: "thin", color: { argb: "FFD9E2EC" } }
                    };
                    cell.alignment = { vertical: "top", wrapText: true };
                });

                if (fillColor) {
                    row.getCell(14).fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: `FF${fillColor}` }
                    };
                }
            });

            worksheet.autoFilter = {
                from: { row: 2, column: 1 },
                to: { row: Math.max(2, worksheet.rowCount), column: headers.length }
            };
            worksheet.views = [{ state: "frozen", ySplit: 2 }];

            worksheet.columns.forEach((column, index) => {
                let maxLength = headers[index]?.length || 10;

                column.eachCell({ includeEmpty: true }, cell => {
                    const value = cell.value ? String(cell.value) : "";
                    maxLength = Math.max(maxLength, value.length);
                });

                column.width = Math.min(Math.max(maxLength + 2, 12), 36);
            });

            const fecha = new Date().toISOString().slice(0, 10);
            const buffer = await workbook.xlsx.writeBuffer();

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="cotizaciones-${fecha}.xlsx"`
            );
            res.send(Buffer.from(buffer));
        })().catch(error => {
            console.error("[cotizaciones-excel] error:", error.message);
            res.status(500).json({ error: "No se pudo generar el Excel" });
        });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
