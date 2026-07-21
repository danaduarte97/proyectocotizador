#!/usr/bin/env node

require("dotenv").config({ quiet: true });

const { Pool } = require("pg");

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

function identidadCotizacion(cotizacion) {
    const dniNormalizado = normalizarDni(cotizacion.dni);
    const telefonoNormalizado = normalizarTelefono(cotizacion.celular);

    if (dniNormalizado) {
        return {
            tipo: "dni",
            valor: dniNormalizado
        };
    }

    if (telefonoNormalizado) {
        return {
            tipo: "telefono",
            valor: telefonoNormalizado
        };
    }

    return null;
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("Falta DATABASE_URL en .env");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : undefined
    });

    try {
        const clienteIdColumnResult = await pool.query(`
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
                AND table_name = 'cotizaciones'
                AND column_name = 'cliente_id'
        `);
        const tieneClienteId = clienteIdColumnResult.rowCount > 0;
        const cotizacionesResult = await pool.query(`
            SELECT
                id,
                dni,
                nombre,
                celular,
                vendedora,
                ${tieneClienteId ? "cliente_id" : "NULL::bigint AS cliente_id"}
            FROM cotizaciones
        `);
        const usuariosResult = await pool.query(`
            SELECT id, usuario
            FROM usuarios
        `);

        const usuarios = new Map(
            usuariosResult.rows.map(usuario => [
                String(usuario.usuario || "").trim().toLowerCase(),
                usuario.id
            ])
        );
        const grupos = new Map();
        let sinIdentidadSegura = 0;
        let yaRelacionadas = 0;

        for (const cotizacion of cotizacionesResult.rows) {
            if (cotizacion.cliente_id) {
                yaRelacionadas++;
            }

            const identidad = identidadCotizacion(cotizacion);

            if (!identidad) {
                sinIdentidadSegura++;
                continue;
            }

            const clave = `${identidad.tipo}:${identidad.valor}`;
            const grupo = grupos.get(clave) || {
                tipo: identidad.tipo,
                valor: identidad.valor,
                cotizaciones: 0,
                nombres: new Set(),
                vendedoras: new Set()
            };

            grupo.cotizaciones++;

            const vendedora = String(cotizacion.vendedora || "").trim();

            if (vendedora) {
                grupo.vendedoras.add(vendedora);
            }

            const nombre = String(cotizacion.nombre || "").trim().toLowerCase();

            if (nombre) {
                grupo.nombres.add(nombre);
            }

            grupos.set(clave, grupo);
        }

        const gruposSeguros = [...grupos.values()]
            .filter(grupo => grupo.tipo === "dni" || grupo.nombres.size <= 1);
        const gruposTelefonoContradictorios = [...grupos.values()]
            .filter(grupo => grupo.tipo === "telefono" && grupo.nombres.size > 1);
        const clientesPorDni = gruposSeguros
            .filter(grupo => grupo.tipo === "dni").length;
        const clientesPorTelefono = gruposSeguros
            .filter(grupo => grupo.tipo === "telefono").length;
        const cotizacionesEnGruposContradictorios = gruposTelefonoContradictorios
            .reduce((total, grupo) => total + grupo.cotizaciones, 0);
        const gruposConVendedoraUnica = gruposSeguros
            .filter(grupo => grupo.vendedoras.size === 1).length;
        const gruposConUsuarioExistente = gruposSeguros
            .filter(grupo => {
                if (grupo.vendedoras.size !== 1) return false;
                const [vendedora] = [...grupo.vendedoras];
                return usuarios.has(vendedora.toLowerCase());
            }).length;

        console.log(JSON.stringify({
            cotizaciones_total: cotizacionesResult.rows.length,
            clientes_que_se_crearian_o_reutilizarian: gruposSeguros.length,
            clientes_por_dni: clientesPorDni,
            clientes_por_telefono: clientesPorTelefono,
            cotizaciones_sin_identidad_segura: sinIdentidadSegura,
            grupos_por_telefono_con_nombres_contradictorios: gruposTelefonoContradictorios.length,
            cotizaciones_en_grupos_contradictorios: cotizacionesEnGruposContradictorios,
            cotizaciones_que_quedarian_sin_cliente_id: sinIdentidadSegura + cotizacionesEnGruposContradictorios,
            columna_cliente_id_existe: tieneClienteId,
            cotizaciones_ya_relacionadas: yaRelacionadas,
            grupos_con_vendedora_unica: gruposConVendedoraUnica,
            grupos_con_usuario_existente_para_vendedora_id: gruposConUsuarioExistente
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
