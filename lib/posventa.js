const ZONA_HORARIA_ARGENTINA = "America/Argentina/Buenos_Aires";

const ESTADOS_POSVENTA = [
    "en_seguimiento",
    "pago_3_meses",
    "pendiente_mora",
    "baja_mora"
];

const CLAVES_TAREAS_POSVENTA = {
    segundaCuota: "posventa_segunda_cuota",
    terceraCuota: "posventa_tercera_cuota"
};

function fechaIsoArgentina(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: ZONA_HORARIA_ARGENTINA,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(fecha);
    const valores = Object.fromEntries(
        partes
            .filter(parte => parte.type !== "literal")
            .map(parte => [parte.type, parte.value])
    );

    return `${valores.year}-${valores.month}-${valores.day}`;
}

function esFechaIsoValida(valor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) return false;

    const [year, month, day] = String(valor).split("-").map(Number);
    const fecha = new Date(Date.UTC(year, month - 1, day));

    return fecha.getUTCFullYear() === year
        && fecha.getUTCMonth() === month - 1
        && fecha.getUTCDate() === day;
}

function sumarMesesCalendario(fechaIso, meses) {
    if (!esFechaIsoValida(fechaIso)) return null;

    const [year, month] = fechaIso.split("-").map(Number);
    const fecha = new Date(Date.UTC(year, month - 1 + meses, 1));

    return [
        fecha.getUTCFullYear(),
        String(fecha.getUTCMonth() + 1).padStart(2, "0"),
        "01"
    ].join("-");
}

function diferenciaMeses(fechaAlta, fechaReferencia) {
    const [yearAlta, monthAlta] = fechaAlta.split("-").map(Number);
    const [yearActual, monthActual] = fechaReferencia.split("-").map(Number);

    return (yearActual - yearAlta) * 12 + (monthActual - monthAlta);
}

function calcularSeguimientoPosventa(
    fechaAlta,
    estadoPosventa = "en_seguimiento",
    fechaReferencia = fechaIsoArgentina()
) {
    if (!esFechaIsoValida(fechaAlta) || !esFechaIsoValida(fechaReferencia)) {
        return {
            mes_numero: null,
            mes_texto: "Sin fecha de alta",
            color: "normal",
            seguimiento_cerrado: false
        };
    }

    const mesesTranscurridos = Math.max(0, diferenciaMeses(
        fechaAlta,
        fechaReferencia
    ));
    const mesNumero = Math.min(3, mesesTranscurridos + 1);
    const mesTexto = [
        "",
        "Primer mes",
        "Segundo mes",
        "Tercer mes"
    ][mesNumero];

    if (estadoPosventa === "pago_3_meses") {
        return {
            mes_numero: mesNumero,
            mes_texto: mesTexto,
            color: "verde",
            seguimiento_cerrado: true
        };
    }

    if (estadoPosventa === "pendiente_mora") {
        return {
            mes_numero: mesNumero,
            mes_texto: mesTexto,
            color: "rojo",
            seguimiento_cerrado: false
        };
    }

    if (estadoPosventa === "baja_mora") {
        return {
            mes_numero: mesNumero,
            mes_texto: mesTexto,
            color: "baja-mora",
            seguimiento_cerrado: true
        };
    }

    return {
        mes_numero: mesNumero,
        mes_texto: mesTexto,
        color: mesNumero === 1
            ? "normal"
            : mesNumero === 2
                ? "amarillo"
                : "rojo",
        seguimiento_cerrado: false
    };
}

module.exports = {
    CLAVES_TAREAS_POSVENTA,
    ESTADOS_POSVENTA,
    ZONA_HORARIA_ARGENTINA,
    calcularSeguimientoPosventa,
    esFechaIsoValida,
    fechaIsoArgentina,
    sumarMesesCalendario
};
