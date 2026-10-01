#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const assert = require("assert");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";

function formulario(datos) {
    const form = new FormData();
    const opcion = {
        numero_opcion: 1,
        plan: "Oro",
        tipo_cobertura: "Individual",
        valor: "160000",
        bonificacion: "0",
        bonificacion_aportes: "0"
    };
    const opciones = [
        opcion,
        {
            numero_opcion: 2,
            plan: "Plata",
            tipo_cobertura: "Grupo Familiar",
            valor: "190000",
            bonificacion: "5000",
            bonificacion_aportes: "2000"
        }
    ];
    const campos = {
        dni: datos.dni || "",
        celular: datos.celular,
        nombre: datos.nombre,
        ...opcion,
        modalidad: "PARTICULAR",
        vigencia: "",
        referido: "No",
        congelamiento: "",
        comentarios: "Prueba PostgreSQL temporal",
        opciones: JSON.stringify(opciones)
    };
    Object.entries(campos).forEach(([clave, valor]) => form.append(clave, valor));
    return form;
}

async function request(ruta, token, opciones = {}) {
    const response = await fetch(`${baseUrl}${ruta}`, {
        ...opciones,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(opciones.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            ...(opciones.headers || {})
        }
    });
    return {
        status: response.status,
        body: await response.json().catch(() => null)
    };
}

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const sufijo = crypto.randomInt(10000000, 99999999).toString();
    const telefono = `11${sufijo}`;
    const dni = crypto.randomInt(30000000, 39999999).toString();
    let idsCotizacion = [];
    let clienteId = null;

    try {
        const vendedores = (await pool.query(
            "SELECT usuario FROM usuarios WHERE rol = 'vendedora' ORDER BY id LIMIT 2"
        )).rows;
        const usuario = vendedores[0];
        assert.ok(usuario, "No hay una vendedora disponible");
        const token = jwt.sign(
            { usuario: usuario.usuario, rol: "vendedora" },
            process.env.JWT_SECRET,
            { expiresIn: "10m" }
        );

        const primera = await request("/agregar", token, {
            method: "POST",
            body: formulario({ celular: telefono, nombre: "Prueba solo telefono" })
        });
        assert.strictEqual(primera.status, 200, JSON.stringify(primera.body));
        clienteId = primera.body.cliente_id;
        idsCotizacion.push(primera.body.id);

        const segunda = await request("/agregar", token, {
            method: "POST",
            body: formulario({ celular: telefono, nombre: "Prueba segundo presupuesto" })
        });
        assert.strictEqual(segunda.status, 200, JSON.stringify(segunda.body));
        assert.strictEqual(String(segunda.body.cliente_id), String(clienteId));
        idsCotizacion.push(segunda.body.id);

        const legacyActiva = await request("/agregar", token, {
            method: "POST",
            body: formulario({ celular: telefono, nombre: "Prueba legacy activa" })
        });
        assert.strictEqual(legacyActiva.status, 200, JSON.stringify(legacyActiva.body));
        idsCotizacion.push(legacyActiva.body.id);

        const legacyAnulada = await request("/agregar", token, {
            method: "POST",
            body: formulario({ celular: telefono, nombre: "Prueba legacy anulada" })
        });
        assert.strictEqual(legacyAnulada.status, 200, JSON.stringify(legacyAnulada.body));
        idsCotizacion.push(legacyAnulada.body.id);
        await pool.query(
            "DELETE FROM cotizacion_opciones WHERE cotizacion_id = ANY($1::bigint[])",
            [[legacyActiva.body.id, legacyAnulada.body.id]]
        );
        await pool.query(
            "UPDATE cotizaciones SET estado = 'Anulada', etapa_pipeline = NULL WHERE id = $1",
            [legacyAnulada.body.id]
        );

        const antesDni = (await pool.query(
            `SELECT COUNT(*)::int AS clientes,
                    COUNT(*) FILTER (WHERE dni IS NULL)::int AS sin_dni
             FROM clientes WHERE telefono_normalizado = $1`,
            [telefono]
        )).rows[0];
        assert.deepStrictEqual(antesDni, { clientes: 1, sin_dni: 1 });

        const perfil = await request(`/cotizaciones/${primera.body.id}/perfil`, token, {
            method: "PUT",
            body: JSON.stringify({
                nombre: "Prueba telefono con DNI",
                dni,
                celular: telefono,
                congelamiento: "Cuota congelada 3 meses",
                vigencia: "2026-12-31",
                opciones: [
                    {
                        valor: "170000",
                        bonificacion: "12000",
                        bonificacion_aportes: "7000"
                    },
                    {
                        valor: "210000",
                        bonificacion: "15000",
                        bonificacion_aportes: "9000"
                    }
                ]
            })
        });
        assert.strictEqual(perfil.status, 200, JSON.stringify(perfil.body));
        assert.strictEqual(String(perfil.body.perfil.cliente_id), String(clienteId));

        const despuesDni = (await pool.query(
            `SELECT id, dni_normalizado, telefono_normalizado
             FROM clientes
             WHERE telefono_normalizado = $1 OR dni_normalizado = $2`,
            [telefono, dni]
        )).rows;
        assert.strictEqual(despuesDni.length, 1);
        assert.strictEqual(String(despuesDni[0].id), String(clienteId));
        assert.strictEqual(despuesDni[0].dni_normalizado, dni);

        const cotizacionEditada = (await pool.query(
            `SELECT id, valor, bonificacion, bonificacion_aportes, congelamiento, vigencia::text
             FROM cotizaciones WHERE id = $1`,
            [primera.body.id]
        )).rows[0];
        assert.deepStrictEqual(cotizacionEditada, {
            id: primera.body.id,
            valor: "170000",
            bonificacion: "12000",
            bonificacion_aportes: "7000",
            congelamiento: "Cuota congelada 3 meses",
            vigencia: "2026-12-31"
        });
        const opcionesEditadas = (await pool.query(
            `SELECT numero_opcion, valor, bonificacion, bonificacion_aportes
             FROM cotizacion_opciones WHERE cotizacion_id = $1 ORDER BY numero_opcion`,
            [primera.body.id]
        )).rows;
        assert.deepStrictEqual(opcionesEditadas, [
            { numero_opcion: 1, valor: "170000", bonificacion: "12000", bonificacion_aportes: "7000" },
            { numero_opcion: 2, valor: "210000", bonificacion: "15000", bonificacion_aportes: "9000" }
        ]);

        const busquedaActualizada = await request(`/buscar/${telefono}`, token);
        assert.strictEqual(busquedaActualizada.status, 200);
        const resultadoEditado = busquedaActualizada.body.find(item => item.id === primera.body.id);
        assert.ok(resultadoEditado);
        assert.strictEqual(resultadoEditado.valor, "170000");
        assert.strictEqual(resultadoEditado.congelamiento, "Cuota congelada 3 meses");
        assert.strictEqual(String(resultadoEditado.vigencia).slice(0, 10), "2026-12-31");
        assert.strictEqual(resultadoEditado.opciones[1].valor, "210000");

        for (const escenario of [
            { cotizacion: legacyActiva, valor: "175000" },
            { cotizacion: legacyAnulada, valor: "180000" }
        ]) {
            const editarLegacy = await request(
                `/cotizaciones/${escenario.cotizacion.body.id}/perfil`,
                token,
                {
                    method: "PUT",
                    body: JSON.stringify({
                        nombre: "Prueba legacy editada",
                        dni,
                        celular: telefono,
                        congelamiento: "Legacy actualizado",
                        vigencia: "2027-01-31",
                        opciones: [{
                            plan: "Oro",
                            tipo_cobertura: "Individual",
                            valor: escenario.valor,
                            bonificacion: "1000",
                            bonificacion_aportes: "500"
                        }]
                    })
                }
            );
            assert.strictEqual(editarLegacy.status, 200, JSON.stringify(editarLegacy.body));
            const opcionCreada = (await pool.query(
                `SELECT numero_opcion, valor FROM cotizacion_opciones
                 WHERE cotizacion_id = $1`,
                [escenario.cotizacion.body.id]
            )).rows;
            assert.deepStrictEqual(opcionCreada, [{ numero_opcion: 1, valor: escenario.valor }]);
        }

        let eliminacionAjena403 = null;
        if (vendedores[1]) {
            const tokenAjeno = jwt.sign(
                { usuario: vendedores[1].usuario, rol: "vendedora" },
                process.env.JWT_SECRET,
                { expiresIn: "10m" }
            );
            const eliminarAjena = await request(`/cotizaciones/${primera.body.id}`, tokenAjeno, {
                method: "DELETE"
            });
            assert.strictEqual(eliminarAjena.status, 403, JSON.stringify(eliminarAjena.body));
            eliminacionAjena403 = true;
        }

        const tareaRelacionada = (await pool.query(
            `INSERT INTO tareas_crm
             (titulo, fecha, tipo, estado, usuario_responsable, cotizacion_id, clave_automatica)
             VALUES ('Prueba eliminación', CURRENT_DATE, 'seguimiento', 'pendiente', $1, $2, $3)
             RETURNING id`,
            [usuario.usuario, primera.body.id, `prueba-${sufijo}`]
        )).rows[0];
        await pool.query(
            `INSERT INTO comentarios_cotizacion (cotizacion_id, usuario, comentario)
             VALUES ($1, $2, 'Comentario temporal')`,
            [primera.body.id, usuario.usuario]
        );
        await pool.query(
            `INSERT INTO cotizaciones_posventa_historial
             (cotizacion_id, estado_nuevo, usuario)
             VALUES ($1, 'en_seguimiento', $2)`,
            [primera.body.id, usuario.usuario]
        );

        for (const id of idsCotizacion) {
            const eliminarPropia = await request(`/cotizaciones/${id}`, token, {
                method: "DELETE"
            });
            assert.strictEqual(eliminarPropia.status, 200, JSON.stringify(eliminarPropia.body));
        }
        idsCotizacion = [];

        const relacionesDespues = (await pool.query(
            `SELECT
                (SELECT COUNT(*)::int FROM cotizaciones WHERE id = $1) AS cotizaciones,
                (SELECT COUNT(*)::int FROM cotizacion_opciones WHERE cotizacion_id = $1) AS opciones,
                (SELECT COUNT(*)::int FROM comentarios_cotizacion WHERE cotizacion_id = $1) AS comentarios,
                (SELECT COUNT(*)::int FROM cotizaciones_posventa_historial WHERE cotizacion_id = $1) AS historial,
                (SELECT COUNT(*)::int FROM tareas_crm WHERE cotizacion_id = $1) AS tareas_vinculadas,
                (SELECT COUNT(*)::int FROM tareas_crm WHERE id = $2 AND cotizacion_id IS NULL) AS tareas_conservadas`,
            [primera.body.id, tareaRelacionada.id]
        )).rows[0];
        assert.deepStrictEqual(relacionesDespues, {
            cotizaciones: 0,
            opciones: 0,
            comentarios: 0,
            historial: 0,
            tareas_vinculadas: 0,
            tareas_conservadas: 1
        });
        await pool.query("DELETE FROM tareas_crm WHERE id = $1", [tareaRelacionada.id]);

        console.log(JSON.stringify({
            resultado: "COTIZACION_SOLO_TELEFONO_POSTGRES_OK",
            primera_cotizacion_sin_dni: true,
            segunda_cotizacion_reutiliza_cliente: true,
            clientes_para_telefono: antesDni.clientes,
            dni_agregado_sin_nueva_identidad: true,
            mismo_cliente_id: true,
            edicion_unificada_actualizada: true,
            dos_opciones_actualizadas: true,
            busqueda_devuelve_datos_actualizados: true,
            legacy_activa_sin_opciones_actualizada: true,
            legacy_anulada_sin_opciones_actualizada: true,
            eliminacion_ajena_403: eliminacionAjena403,
            eliminacion_propia: true,
            relaciones_sin_huerfanos: true
        }, null, 2));
    } finally {
        if (idsCotizacion.length || clienteId) {
            await pool.query("BEGIN");
            try {
                if (idsCotizacion.length) {
                    await pool.query("UPDATE tareas_crm SET cotizacion_id = NULL, clave_automatica = NULL WHERE cotizacion_id = ANY($1::bigint[])", [idsCotizacion]);
                    await pool.query("DELETE FROM cotizaciones_posventa_historial WHERE cotizacion_id = ANY($1::bigint[])", [idsCotizacion]);
                    await pool.query("DELETE FROM comentarios_cotizacion WHERE cotizacion_id = ANY($1::bigint[])", [idsCotizacion]);
                    await pool.query("DELETE FROM archivos WHERE cotizacion_id = ANY($1::bigint[])", [idsCotizacion]);
                    await pool.query("DELETE FROM cotizacion_opciones WHERE cotizacion_id = ANY($1::bigint[])", [idsCotizacion]);
                    await pool.query("DELETE FROM cotizaciones WHERE id = ANY($1::bigint[])", [idsCotizacion]);
                }
                if (clienteId) {
                    await pool.query("UPDATE primer_contacto_identidades SET cliente_id = NULL WHERE cliente_id = $1", [clienteId]);
                    await pool.query("DELETE FROM clientes WHERE id = $1", [clienteId]);
                }
                await pool.query("COMMIT");
            } catch (error) {
                await pool.query("ROLLBACK");
                throw error;
            }
        }
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
