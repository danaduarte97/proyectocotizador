const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const SECRET = "secreto_ultra_seguro";

// 👉 MIDDLEWARES
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 👉 BASE DE DATOS
const db = new sqlite3.Database("./database.db");

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
        valor TEXT,
        vendedora TEXT,
        comentarios TEXT,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `);

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

// 👉 BUSCAR
app.get("/buscar/:dni", verificarToken, (req, res) => {
    db.all(
        "SELECT * FROM cotizaciones WHERE dni = ? ORDER BY fecha ASC",
        [req.params.dni],
        (err, rows) => {
            if (err) return res.status(500).json(err);
            res.json(rows);
        }
    );
});

// 👉 AGREGAR
app.post("/agregar", verificarToken, (req, res) => {

    const { dni, nombre, celular, plan, valor, comentarios } = req.body;
    const vendedora = req.user.usuario;

    if (!dni) {
        return res.status(400).json({ error: "DNI obligatorio" });
    }

    db.run(
        `INSERT INTO cotizaciones (dni, nombre, celular, plan, valor, vendedora, comentarios)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dni, nombre, celular, plan, valor, vendedora, comentarios],
        function (err) {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
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
app.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});