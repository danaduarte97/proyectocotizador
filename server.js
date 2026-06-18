const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const SECRET = "secreto_ultra_seguro";
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDir = path.join(__dirname, "public", "uploads");
const extensionesImagen = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif"
]);
const tiposImagen = new Set([
    "image/jpeg",
    "image/pjpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif"
]);

fs.mkdirSync(uploadsDir, { recursive: true });

// 👉 MIDDLEWARES
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 👉 BASE DE DATOS
const db = new sqlite3.Database(path.join(__dirname, "database.db"));
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
        const esHeic = extension === ".heic" || extension === ".heif";
        const esImagen =
            extensionesImagen.has(extension) &&
            (
                tiposImagen.has(file.mimetype) ||
                (esHeic && (
                    !file.mimetype ||
                    file.mimetype === "application/octet-stream"
                ))
            );

        if (!esImagen) {
            const error = new Error(
                "Solo se permiten imágenes JPG, JPEG, PNG, WEBP, HEIC o HEIF"
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
    "Abonó",
    "Perdido"
];

const SELECT_COTIZACIONES = `
    SELECT
        *,
        COALESCE(NULLIF(estado, ''), 'Nuevo') AS estado
    FROM cotizaciones
`;

function normalizarCotizacion(cotizacion) {
    return {
        ...cotizacion,
        estado: cotizacion.estado || "Nuevo"
    };
}

function normalizarCotizaciones(cotizaciones) {
    return cotizaciones.map(normalizarCotizacion);
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
        rol TEXT
    )
    `);

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

});

// 👉 LOGIN
app.post("/login", (req, res) => {
    const { usuario, password } = req.body;

    db.get(
        "SELECT * FROM usuarios WHERE usuario = ?",
        [usuario],
        async (err, user) => {

            if (err) return res.status(500).json(err);

            if (!user) {
                return res.status(401).json({ success: false });
            }

            const match = await bcrypt.compare(password, user.password);

            if (!match) {
                return res.status(401).json({ success: false });
            }

            const token = jwt.sign(
                {
                    usuario: user.usuario,
                    rol: user.rol
                },
                SECRET,
                { expiresIn: "2h" }
            );

            res.json({
                success: true,
                token,
                usuario: user.usuario,
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
                return res.json(normalizarCotizaciones(cotizacionesPorDni));
            }

            buscarCotizacionesPorTelefono(
                termino,
                (errorTelefono, cotizaciones) => {
                    if (errorTelefono) {
                        return res.status(500).json(errorTelefono);
                    }

                    res.json(cotizaciones);
                }
            );
        }
    );
});

// 👉 AGREGAR
app.post("/agregar", verificarToken, (req, res) => {

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

    db.run(
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
        ],
        function (err) {

            if (err) {

                console.log(err);

                return res.status(500).json(err);
            }

            res.json({
                success: true
            });
        }
    );
});

app.post(
    "/subir-archivo/:id",
    verificarToken,
    (req, res, next) => {
        db.get(
            "SELECT id FROM cotizaciones WHERE id = ?",
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

    const { usuario, password, rol } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        db.run(
            "INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)",
            [usuario, hash, rol],
            function (err) {
                if (err) {
                    return res.status(500).json({ error: "Usuario ya existe" });
                }
                res.json({ success: true });
            }
        );

    } catch (error) {
        res.status(500).json({ error: "Error al encriptar" });
    }
});

// 👉 LISTAR USUARIOS
app.get("/usuarios", verificarToken, (req, res) => {
    db.all("SELECT id, usuario, rol FROM usuarios", [], (err, rows) => {
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

    const { id } = req.params;
    const { password, rol } = req.body;

    if (!password || !rol) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        db.run(
            "UPDATE usuarios SET password = ?, rol = ? WHERE id = ?",
            [hash, rol, id],
            function (err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true });
            }
        );

    } catch (error) {
        res.status(500).json({ error: "Error al encriptar" });
    }
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
    const estado = req.body.estado || "Nuevo";
    const fechaSeguimiento = req.body.fecha_seguimiento || null;

    if (!ESTADOS_COTIZACION.includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
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

app.get("/mis-cotizaciones", verificarToken, (req, res) => {
    const {
        estado,
        asesora,
        fecha_desde,
        fecha_hasta
    } = req.query;

    const condiciones = [];
    const parametros = [];

    if (estado) {
        condiciones.push("COALESCE(NULLIF(estado, ''), 'Nuevo') = ?");
        parametros.push(estado);
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

        db.all(
            `
            ${SELECT_COTIZACIONES}
            ${condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : ""}
            ORDER BY fecha DESC
            `,
            parametros,
            (err, rows) => {
                if (err) return res.status(500).json(err);

                res.json(normalizarCotizaciones(rows));
            }
        );

        return;
    }

    db.all(
        `
        ${SELECT_COTIZACIONES}
        WHERE vendedora = ?
        ${condiciones.length ? `AND ${condiciones.join(" AND ")}` : ""}
        ORDER BY fecha DESC
        `,
        [req.user.usuario, ...parametros],
        (err, rows) => {
            if (err) return res.status(500).json(err);

            res.json(normalizarCotizaciones(rows));
        }
    );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
