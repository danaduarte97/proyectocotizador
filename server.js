const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
const ExcelJS = require("exceljs");

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

function dbRunAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
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

const ESTADO_COTIZACION_SQL = `
    CASE
        WHEN estado IN (${ESTADOS_AFILIADO_LEGACY_SQL}) THEN 'Afiliado'
        ELSE COALESCE(NULLIF(estado, ''), 'Nuevo')
    END
`;

const SELECT_COTIZACIONES = `
    SELECT
        *,
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

function normalizarCotizacion(cotizacion) {
    return {
        ...cotizacion,
        estado: normalizarEstadoCotizacion(cotizacion.estado)
    };
}

function normalizarCotizaciones(cotizaciones) {
    return cotizaciones.map(normalizarCotizacion);
}

function responderCotizacionesConArchivos(res, cotizaciones) {
    const normalizadas = normalizarCotizaciones(cotizaciones);
    const ids = normalizadas.map(cotizacion => cotizacion.id);

    if (ids.length === 0) {
        res.json(normalizadas);
        return;
    }

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
                normalizadas.map(cotizacion => ({
                    ...cotizacion,
                    archivos: archivosPorCotizacion[cotizacion.id] || []
                }))
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
        dni TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE,
        password TEXT,
        rol TEXT,
        orden_login INTEGER
    )
    `);
    db.run(`
    ALTER TABLE usuarios
    ADD COLUMN orden_login INTEGER
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
    const variantes = new Set();

    if (!digitos) return variantes;

    variantes.add(digitos);

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
    const variantes = [...variantesTelefono(termino)];

    if (variantes.length === 0) {
        callback(null, []);
        return;
    }

    const telefonoNormalizado = celularSinFormatoSql();
    const condiciones = variantes.map(() =>
        `${telefonoNormalizado} LIKE ?`
    ).join(" OR ");

    db.all(
        `
        ${SELECT_COTIZACIONES}
        WHERE celular IS NOT NULL
          AND celular != ''
          AND (${condiciones})
        ORDER BY fecha ASC
        `,
        variantes.map(variante => `%${variante}%`),
        (err, cotizaciones) => {
            if (err) {
                callback(err);
                return;
            }

            callback(
                null,
                normalizarCotizaciones(
                    cotizaciones.filter(cotizacion =>
                        coincideTelefono(cotizacion.celular, termino)
                    )
                )
            );
        }
    );
}

function coincideTelefono(celular, termino) {
    const celulares = variantesTelefono(celular);
    const busquedas = variantesTelefono(termino);

    return [...celulares].some(numero =>
        [...busquedas].some(busqueda => numero.includes(busqueda))
    );
}

// 👉 BUSCAR POR DNI O TELÉFONO
app.get("/buscar/:termino", verificarToken, (req, res) => {
    const termino = String(req.params.termino || "").trim();

    db.all(
        `${SELECT_COTIZACIONES} WHERE dni = ? ORDER BY fecha ASC`,
        [termino],
        (err, cotizacionesPorDni) => {
            if (err) return res.status(500).json(err);

            // La coincidencia exacta de DNI conserva la búsqueda original.
            if (cotizacionesPorDni.length > 0) {
                return responderCotizacionesConArchivos(
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

                    responderCotizacionesConArchivos(res, cotizaciones);
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

app.post("/agregar", verificarToken, uploadImagenesNuevaCotizacion, async (req, res) => {

    const {
        dni,
        nombre,
        celular,
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

    const vendedora = req.user.usuario;

    if (!dni) {
        return res.status(400).json({
            error: "DNI obligatorio"
        });
    }

    const archivos = req.files || [];

    try {
        const cotizacionId = await db.transaction(async tx => {
            const resultado = await tx.run(
            `
            INSERT INTO cotizaciones
            (
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                [
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
                ]
            );

            const id = resultado.lastID;

            await insertarArchivosCotizacion(tx, id, archivos);

            return id;
        });

        res.json({
            success: true,
            id: cotizacionId
        });
    } catch (error) {
        eliminarArchivosLocales(archivos);
        res.status(500).json(error);
    }
});

app.post(
    "/subir-archivo/:id",
    verificarToken,
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

app.get("/archivos/:id", verificarToken, (req, res) => {

    db.all(
        `
        SELECT *
        FROM archivos
        WHERE cotizacion_id = ?
        ORDER BY fecha DESC
        `,
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json(err);
            res.json(rows);
        }
    );
});

app.delete("/archivos/:id", verificarToken, (req, res) => {
    db.get(
        "SELECT * FROM archivos WHERE id = ?",
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
        [
            cotizacionId,
            req.user.usuario,
            comentario
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                success: true
            });
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


app.put("/cotizaciones/:id/seguimiento", verificarToken, (req, res) => {
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

    db.get(
        "SELECT vendedora FROM cotizaciones WHERE id = ?",
        [id],
        (err, cotizacion) => {
            if (err) return res.status(500).json(err);

            if (!cotizacion) {
                return res.status(404).json({ error: "Cotización no encontrada" });
            }

            if (
                req.user.rol !== "admin" &&
                cotizacion.vendedora !== req.user.usuario
            ) {
                return res.status(403).json({ error: "No autorizado" });
            }

            db.run(
                `
                UPDATE cotizaciones
                SET estado = ?, fecha_seguimiento = ?
                WHERE id = ?
                `,
                [estado, fechaSeguimiento, id],
                function (errorUpdate) {
                    if (errorUpdate) return res.status(500).json(errorUpdate);

                    res.json({ success: true });
                }
            );
        }
    );
});

app.put("/cotizaciones/:id/anular", verificarToken, (req, res) => {
    if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: "Id de cotizacion invalido" });
    }

    db.get("SELECT id FROM cotizaciones WHERE id = ?", [id], (err, cotizacion) => {
        if (err) return res.status(500).json(err);

        if (!cotizacion) {
            return res.status(404).json({ error: "Cotizacion no encontrada" });
        }

        db.run(
            "UPDATE cotizaciones SET estado = ? WHERE id = ?",
            ["Anulada", id],
            function (errorUpdate) {
                if (errorUpdate) return res.status(500).json(errorUpdate);

                res.json({ success: true });
            }
        );
    });
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

        responderCotizacionesConArchivos(res, rows);
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
