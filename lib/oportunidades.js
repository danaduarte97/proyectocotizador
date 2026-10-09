const ETAPAS_OPORTUNIDAD = [
    "Inicio",
    "Interesados",
    "Documentación",
    "Auditoría",
    "Afiliados"
];

const PRIORIDAD_ETAPA = new Map(
    ETAPAS_OPORTUNIDAD.map((etapa, indice) => [etapa, indice + 1])
);

const ETAPAS_LEGACY = new Set([
    "Nuevos",
    "Contactados",
    "Interesados",
    "Documentación",
    "Auditoría",
    "Afiliados"
]);

const ESTADOS_CIERRE_NEGATIVO = new Set([
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
]);

function textoNormalizado(valor) {
    return String(valor || "").trim().toLocaleLowerCase("es-AR");
}

function idComparable(valor) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : String(valor || "");
}

function compararCotizaciones(a, b) {
    const fechaA = Date.parse(a.fecha || "") || 0;
    const fechaB = Date.parse(b.fecha || "") || 0;

    if (fechaA !== fechaB) return fechaA - fechaB;

    const idA = idComparable(a.id);
    const idB = idComparable(b.id);

    if (typeof idA === "number" && typeof idB === "number") {
        return idA - idB;
    }

    return String(idA).localeCompare(String(idB), "es");
}

function etapaOportunidadDesdeLegacy(etapa) {
    const valor = String(etapa || "").trim();

    if (valor === "Nuevos" || valor === "Contactados" || !valor) {
        return "Inicio";
    }

    return ETAPAS_OPORTUNIDAD.includes(valor) ? valor : "Inicio";
}

function cotizacionActiva(cotizacion) {
    return !ESTADOS_CIERRE_NEGATIVO.has(textoNormalizado(cotizacion.estado));
}

function resolverEtapa(cotizaciones) {
    const etapasLegacy = [...new Set(
        cotizaciones.map(cotizacion => String(cotizacion.etapa_pipeline || "Nuevos").trim())
    )].sort((a, b) => a.localeCompare(b, "es"));
    const etapasNoReconocidas = etapasLegacy.filter(
        etapa => etapa && !ETAPAS_LEGACY.has(etapa)
    );
    const etapasNuevas = [...new Set(
        etapasLegacy.map(etapaOportunidadDesdeLegacy)
    )].sort((a, b) => (
        (PRIORIDAD_ETAPA.get(a) || 0) - (PRIORIDAD_ETAPA.get(b) || 0)
    ));
    const etapa = etapasNuevas.reduce((masAvanzada, candidata) => (
        (PRIORIDAD_ETAPA.get(candidata) || 0) >
        (PRIORIDAD_ETAPA.get(masAvanzada) || 0)
            ? candidata
            : masAvanzada
    ), "Inicio");

    return {
        etapa,
        etapas_legacy: etapasLegacy,
        etapas_normalizadas: etapasNuevas,
        etapas_no_reconocidas: etapasNoReconocidas,
        requiere_revision_etapa: etapasNoReconocidas.length > 0,
        criterio: etapasNoReconocidas.length > 0
            ? "etapa_no_reconocida"
            : etapasNuevas.length > 1
                ? "etapa_mas_avanzada"
            : etapasLegacy.length > 1
                ? "unificacion_inicio"
                : "sin_conflicto"
    };
}

function indiceUsuarios(usuarios) {
    const indice = new Map();

    for (const usuario of usuarios || []) {
        const clave = textoNormalizado(usuario.usuario);
        if (!clave) continue;

        const coincidencias = indice.get(clave) || [];
        coincidencias.push(usuario);
        indice.set(clave, coincidencias);
    }

    return indice;
}

function resolverUsuario(indice, nombre) {
    const coincidencias = indice.get(textoNormalizado(nombre)) || [];
    return coincidencias.length === 1 ? coincidencias[0] : null;
}

function participantesDe(cotizaciones, usuariosPorNombre, primeraCotizacion) {
    const grupos = new Map();

    for (const cotizacion of cotizaciones) {
        const nombre = String(cotizacion.vendedora || "").trim();
        const clave = textoNormalizado(nombre);
        if (!clave) continue;

        const grupo = grupos.get(clave) || {
            asesora: nombre,
            asesora_normalizada: clave,
            cotizaciones: []
        };
        grupo.cotizaciones.push(cotizacion);
        grupos.set(clave, grupo);
    }

    return [...grupos.values()]
        .map(grupo => {
            grupo.cotizaciones.sort(compararCotizaciones);
            const usuario = resolverUsuario(usuariosPorNombre, grupo.asesora);

            return {
                usuario_id: usuario?.id || null,
                asesora: grupo.asesora,
                asesora_normalizada: grupo.asesora_normalizada,
                es_responsable: textoNormalizado(primeraCotizacion?.vendedora) ===
                    grupo.asesora_normalizada,
                primera_cotizacion_id: grupo.cotizaciones[0]?.id || null,
                primera_participacion: grupo.cotizaciones[0]?.fecha || null,
                ultima_participacion:
                    grupo.cotizaciones[grupo.cotizaciones.length - 1]?.fecha || null,
                cantidad_cotizaciones: grupo.cotizaciones.length
            };
        })
        .sort((a, b) => {
            if (a.es_responsable !== b.es_responsable) {
                return a.es_responsable ? -1 : 1;
            }
            return a.asesora.localeCompare(b.asesora, "es");
        });
}

function resolverProcedencia(clienteId, fechaPrimeraCotizacion, identidades) {
    const candidatas = (identidades || []).filter(identidad => (
        String(identidad.cliente_id || "") === String(clienteId)
    ));

    if (candidatas.length !== 1) {
        return {
            primer_contacto_identidad_id: null,
            procedencia_id: null,
            procedencia_codigo: "sin_informar",
            procedencia_nombre: "Sin informar",
            atribucion: "sin_informar",
            motivo: candidatas.length > 1
                ? "multiples_identidades_directas"
                : "sin_identidad_directa",
            requiere_revision: candidatas.length > 1
        };
    }

    const identidad = candidatas[0];
    const codigo = String(identidad.procedencia_codigo || "sin_informar").trim();

    if (!identidad.procedencia_id || codigo === "sin_informar") {
        return {
            primer_contacto_identidad_id: identidad.id,
            procedencia_id: identidad.procedencia_id || null,
            procedencia_codigo: "sin_informar",
            procedencia_nombre: identidad.procedencia_nombre || "Sin informar",
            atribucion: "sin_informar",
            motivo: "procedencia_no_informada",
            requiere_revision: false
        };
    }

    const fechaIdentidad = Date.parse(identidad.fecha_creacion || "") || 0;
    const fechaCotizacion = Date.parse(fechaPrimeraCotizacion || "") || 0;
    const retrospectiva = Boolean(
        fechaIdentidad && fechaCotizacion && fechaIdentidad > fechaCotizacion
    );

    return {
        primer_contacto_identidad_id: identidad.id,
        procedencia_id: identidad.procedencia_id,
        procedencia_codigo: codigo,
        procedencia_nombre: identidad.procedencia_nombre || codigo,
        atribucion: retrospectiva ? "retrospectiva" : "contemporanea",
        motivo: retrospectiva
            ? "identidad_directa_registrada_despues_de_primera_cotizacion"
            : "identidad_directa_verificada",
        requiere_revision: false
    };
}

function simularOportunidades({
    cotizaciones = [],
    identidadesPrimerContacto = [],
    usuarios = []
} = {}) {
    const grupos = new Map();
    const cotizacionesSinCliente = [];
    const usuariosPorNombre = indiceUsuarios(usuarios);

    for (const cotizacion of cotizaciones) {
        if (!cotizacion.cliente_id) {
            cotizacionesSinCliente.push(cotizacion.id);
            continue;
        }

        const clave = String(cotizacion.cliente_id);
        const grupo = grupos.get(clave) || [];
        grupo.push(cotizacion);
        grupos.set(clave, grupo);
    }

    const oportunidades = [...grupos.entries()].map(([clienteId, grupo]) => {
        const ordenadas = [...grupo].sort(compararCotizaciones);
        const primeraCotizacion = ordenadas[0] || null;
        const activas = ordenadas.filter(cotizacionActiva);
        const cotizacionesParaEtapa = activas.length ? activas : ordenadas;
        const etapa = resolverEtapa(cotizacionesParaEtapa);
        const participantes = participantesDe(
            ordenadas,
            usuariosPorNombre,
            primeraCotizacion
        );
        const responsable = participantes.find(item => item.es_responsable) || null;
        const procedencia = resolverProcedencia(
            clienteId,
            primeraCotizacion?.fecha,
            identidadesPrimerContacto
        );
        const conflictos = [];

        if (!responsable) conflictos.push("primera_cotizacion_sin_asesora");
        if (etapa.requiere_revision_etapa) conflictos.push("etapas_normalizadas_distintas");
        if (procedencia.requiere_revision) conflictos.push(procedencia.motivo);

        return {
            cliente_id: clienteId,
            ciclo: 1,
            estado: activas.length ? "activa" : "cerrada_perdida",
            etapa: etapa.etapa,
            primera_cotizacion_id: primeraCotizacion?.id || null,
            fecha_inicio: primeraCotizacion?.fecha || null,
            responsable_usuario_id: responsable?.usuario_id || null,
            responsable: responsable?.asesora ||
                String(primeraCotizacion?.vendedora || "").trim() || null,
            participantes,
            procedencia,
            cotizaciones_ids: ordenadas.map(cotizacion => cotizacion.id),
            cantidad_cotizaciones: ordenadas.length,
            cantidad_cotizaciones_activas: activas.length,
            resolucion_etapa: etapa,
            conflictos
        };
    }).sort((a, b) => Number(a.cliente_id) - Number(b.cliente_id));

    const activas = oportunidades.filter(item => item.estado === "activa");
    const participantes = oportunidades.flatMap(item => item.participantes);
    const distribucionEtapas = Object.fromEntries(
        ETAPAS_OPORTUNIDAD.map(etapa => [
            etapa,
            activas.filter(item => item.etapa === etapa).length
        ])
    );

    return {
        resumen: {
            cotizaciones_total: cotizaciones.length,
            cotizaciones_asociables: cotizaciones.length - cotizacionesSinCliente.length,
            cotizaciones_sin_cliente: cotizacionesSinCliente.length,
            oportunidades_esperadas: oportunidades.length,
            oportunidades_activas: activas.length,
            oportunidades_cerradas: oportunidades.length - activas.length,
            oportunidades_multi_cotizacion: oportunidades.filter(
                item => item.cantidad_cotizaciones > 1
            ).length,
            oportunidades_multi_asesora: oportunidades.filter(
                item => item.participantes.length > 1
            ).length,
            participantes_esperados: participantes.length,
            procedencias_contemporaneas: oportunidades.filter(
                item => item.procedencia.atribucion === "contemporanea"
            ).length,
            procedencias_retrospectivas: oportunidades.filter(
                item => item.procedencia.atribucion === "retrospectiva"
            ).length,
            procedencias_sin_informar: oportunidades.filter(
                item => item.procedencia.atribucion === "sin_informar"
            ).length,
            oportunidades_con_revision: oportunidades.filter(
                item => item.conflictos.length > 0
            ).length,
            distribucion_etapas_activas: distribucionEtapas
        },
        cotizaciones_sin_cliente: cotizacionesSinCliente,
        oportunidades
    };
}

module.exports = {
    ETAPAS_OPORTUNIDAD,
    cotizacionActiva,
    etapaOportunidadDesdeLegacy,
    resolverEtapa,
    simularOportunidades
};
