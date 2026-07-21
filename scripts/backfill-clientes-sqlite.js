#!/usr/bin/env node

const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const rootDir = path.resolve(__dirname, "..");
const sqlitePath = path.join(rootDir, "database.db");

function normalizarDni(valor) {
    const dni = String(valor || "").replace(/\D/g, "");
    return dni || null;
}

function normalizarTelefono(valor) {
    let numero = String(valor || "").replace(/\D/g, "");

    if (!numero) return null;

    if (numero.startsWith("549")) {
        numero = numero.slice(3);
    } else if (numero.startsWith("54")) {
        numero = numero.slice(2);
    }

    while (numero.startsWith("0")) {
        numero = numero.slice(1);
    }

    for (let posicion = 2; posicion <= 4; posicion++) {
        if (numero.slice(posicion, posicion + 2) === "15") {
            numero = numero.slice(0, posicion) + numero.slice(posicion + 2);
            break;
        }
    }

    return numero || null;
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve(this);
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

async function ensureColumn(db, table, column, definition) {
    const columns = await all(db, `PRAGMA table_info(${table})`);
    const exists = columns.some(item => item.name === column);

    if (!exists) {
        await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

async function main() {
    const db = new sqlite3.Database(sqlitePath);

    try {
        await run(db, "BEGIN TRANSACTION");

        await run(db, `
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
        `);

        await ensureColumn(db, "cotizaciones", "cliente_id", "INTEGER");

        await run(db, "CREATE INDEX IF NOT EXISTS idx_clientes_dni_normalizado ON clientes (dni_normalizado)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_clientes_telefono_normalizado ON clientes (telefono_normalizado)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes (nombre)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_clientes_vendedora_id ON clientes (vendedora_id)");
        await run(db, "CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id ON cotizaciones (cliente_id)");

        const usuarios = await all(db, "SELECT id, usuario FROM usuarios");
        const usuariosPorNombre = new Map(
            usuarios.map(usuario => [
                String(usuario.usuario || "").trim().toLowerCase(),
                usuario.id
            ])
        );
        const cotizaciones = await all(db, "SELECT * FROM cotizaciones ORDER BY fecha DESC, id DESC");
        const grupos = new Map();

        for (const cotizacion of cotizaciones) {
            const dniNormalizado = normalizarDni(cotizacion.dni);
            const telefonoNormalizado = normalizarTelefono(cotizacion.celular);
            const identidadTipo = dniNormalizado ? "dni" : telefonoNormalizado ? "telefono" : null;
            const identidadValor = dniNormalizado || telefonoNormalizado;

            if (!identidadTipo || !identidadValor) continue;

            const clave = `${identidadTipo}:${identidadValor}`;
            const grupo = grupos.get(clave) || {
                identidadTipo,
                identidadValor,
                cotizaciones: [],
                nombres: new Set(),
                vendedoras: new Set()
            };

            grupo.cotizaciones.push({
                ...cotizacion,
                dniNormalizado,
                telefonoNormalizado
            });

            if (String(cotizacion.vendedora || "").trim()) {
                grupo.vendedoras.add(String(cotizacion.vendedora).trim());
            }

            if (String(cotizacion.nombre || "").trim()) {
                grupo.nombres.add(String(cotizacion.nombre).trim().toLowerCase());
            }

            grupos.set(clave, grupo);
        }

        for (const grupo of grupos.values()) {
            if (grupo.identidadTipo === "telefono" && grupo.nombres.size > 1) {
                continue;
            }

            const principal = grupo.cotizaciones[0];
            const vendedoras = [...grupo.vendedoras];
            const vendedoraAsignada = vendedoras.length === 1 ? vendedoras[0] : null;
            const vendedoraId = vendedoraAsignada
                ? usuariosPorNombre.get(vendedoraAsignada.toLowerCase()) || null
                : null;

            await run(db, `
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
            `, [
                grupo.identidadTipo,
                grupo.identidadValor,
                grupo.identidadTipo === "dni" ? grupo.identidadValor : principal.dni || null,
                grupo.identidadTipo === "dni" ? grupo.identidadValor : normalizarDni(principal.dni),
                principal.nombre || null,
                principal.celular || null,
                grupo.identidadTipo === "telefono" ? grupo.identidadValor : principal.telefonoNormalizado,
                vendedoraId,
                vendedoraAsignada
            ]);

            const cliente = await all(db, `
                SELECT id
                FROM clientes
                WHERE identidad_tipo = ?
                    AND identidad_valor = ?
                LIMIT 1
            `, [grupo.identidadTipo, grupo.identidadValor]);

            if (!cliente[0]) continue;

            for (const cotizacion of grupo.cotizaciones) {
                await run(db, `
                    UPDATE cotizaciones
                    SET cliente_id = ?
                    WHERE id = ?
                        AND (cliente_id IS NULL OR cliente_id <> ?)
                `, [cliente[0].id, cotizacion.id, cliente[0].id]);
            }
        }

        await run(db, "COMMIT");

        const resumen = await all(db, `
            SELECT
                (SELECT COUNT(*) FROM clientes) AS clientes_total,
                (SELECT COUNT(*) FROM cotizaciones WHERE cliente_id IS NOT NULL) AS cotizaciones_relacionadas,
                (SELECT COUNT(*) FROM cotizaciones WHERE cliente_id IS NULL) AS cotizaciones_sin_cliente_id
        `);

        console.log(JSON.stringify(resumen[0], null, 2));
    } catch (error) {
        await run(db, "ROLLBACK").catch(() => {});
        throw error;
    } finally {
        db.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
