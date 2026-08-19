console.log("JS CARGADO");

// =======================
// TOKEN / AUTH
// =======================

function obtenerPayload() {
    const token = localStorage.getItem("token");
    if (!token) return null;

    try {
        const base64 = token.split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        return JSON.parse(atob(base64));
    } catch (e) {
        return null;
    }
}

function esAdmin() {
    const payload = obtenerPayload();
    return payload && payload.rol === "admin";
}

// HEADERS CON TOKEN (Bearer)
function authHeaders(extra = {}) {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...extra
    };
}

function authOnlyHeaders(extra = {}) {
    const token = localStorage.getItem("token");

    return {
        "Authorization": `Bearer ${token}`,
        ...extra
    };
}

// SI NO HAY TOKEN, REDIRIGE A LOGIN
const token = localStorage.getItem("token");
if (!token) {
    window.location.href = "/login.html";
}

// 🚨 MANEJO GLOBAL DE ERRORES
async function manejarError(res) {
    if (res.status === 401 || res.status === 403) {
        mostrarToast("Sesión expirada o no autorizada", "error");
        logout();
        return true;
    }
    return false;
}


let cargasActivas = 0;

function mostrarLoader() {
    cargasActivas++;

    const loader = document.getElementById("loaderGlobal");

    if (loader) {
        loader.style.display = "flex";
        loader.setAttribute("aria-busy", "true");
    }
}

function ocultarLoader() {
    cargasActivas = Math.max(0, cargasActivas - 1);

    if (cargasActivas > 0) return;

    const loader = document.getElementById("loaderGlobal");

    if (loader) {
        loader.style.display = "none";
        loader.removeAttribute("aria-busy");
    }
}


// =======================
// 👥 USUARIOS
// =======================

let usuariosCargados = [];

async function cargarUsuarios() {

    // 👀 SOLO ADMIN
    if (!esAdmin()) {
        document.getElementById("listaUsuarios").innerHTML = "";
        return;
    }

    const res = await fetch("/usuarios", {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const usuarios = await res.json();
    usuariosCargados = usuarios;

    const contenedor = document.getElementById("listaUsuarios");
    contenedor.innerHTML = "";

    usuarios.forEach(user => {
        const userId = String(user.id);

        contenedor.innerHTML += `
            <div class="card-user">
                <div>
                    <strong>${user.usuario}</strong>
                    <span class="badge ${user.rol}">${user.rol}</span>
                    <small class="orden-login">Orden login: ${user.orden_login ?? "sin definir"}</small>
                </div>

                <div>
                    ${esAdmin() ? `
                        <button onclick="editarUsuario('${userId}')">Editar</button>
                    ` : ""}

                    ${esAdmin() && user.usuario !== "admin" ? `
                        <button onclick="eliminarUsuario('${userId}')">Eliminar</button>
                    ` : ""}
                </div>
            </div>
        `;
    });
}

async function eliminarUsuario(id) {
    if (!esAdmin()) {
        mostrarToast("No autorizado", "error");
        return;
    }

    const confirmado = await mostrarModalConfirmacion({
        titulo: "¿Eliminar usuario?",
        texto: "Esta acción no se puede deshacer.",
        accion: "Eliminar"
    });

    if (!confirmado) return;

    const res = await fetch(`/usuarios/${id}`, {
        method: "DELETE",
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    if (res.ok) {
        mostrarToast("Usuario eliminado", "success");
        cargarUsuarios();
    } else {
        mostrarToast("Error", "error");
    }
}

function formatearFecha(fecha) {

    const f = new Date(fecha);

    const ahora = new Date();

    const mismoDia =
        f.getDate() === ahora.getDate() &&
        f.getMonth() === ahora.getMonth() &&
        f.getFullYear() === ahora.getFullYear();

    const ayer = new Date();
    ayer.setDate(ahora.getDate() - 1);

    const esAyer =
        f.getDate() === ayer.getDate() &&
        f.getMonth() === ayer.getMonth() &&
        f.getFullYear() === ayer.getFullYear();

    const hora = f.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit"
    });

    if (mismoDia) {
        return `Hoy ${hora}`;
    }

    if (esAyer) {
        return `Ayer ${hora}`;
    }

    return f.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "long",
        year: "numeric"
    }) + ` ${hora}`;
}

function formatearFechaArgentina(fecha) {
    if (!fecha) return "-";

    const valor = String(fecha).trim();

    const fechaArgentina = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (fechaArgentina) return valor;

    const fechaIso = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (fechaIso) {
        return `${fechaIso[3]}/${fechaIso[2]}/${fechaIso[1]}`;
    }

    const fechaConBarras = valor.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
    if (fechaConBarras) {
        return `${fechaConBarras[3]}/${fechaConBarras[2]}/${fechaConBarras[1]}`;
    }

    const fechaParseada = new Date(valor);
    if (Number.isNaN(fechaParseada.getTime())) return valor;

    return fechaParseada.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Argentina/Buenos_Aires"
    });
}

let cotizacionModalTrigger = null;
let cotizacionModalScrollVentana = 0;
let cotizacionModalScrollPrincipal = 0;
let cotizacionModalId = null;

function modalCotizacionAbierto() {
    const modal = document.getElementById("cotizacionDetalleModal");
    return Boolean(modal && !modal.hidden);
}

function hayModalSecundarioAbierto() {
    const modalFechaAlta = document.getElementById("posventaFechaAltaModal");

    return Boolean(modalFechaAlta && !modalFechaAlta.hidden)
        || [...document.querySelectorAll(".modal")].some(modal =>
            getComputedStyle(modal).display !== "none"
        );
}

function elementosInteractivosModalCotizacion() {
    const modal = document.getElementById("cotizacionDetalleModal");

    if (!modal) return [];

    return [...modal.querySelectorAll(
        "button:not([disabled]), a[href], input:not([disabled]), "
        + "select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )].filter(elemento => elemento.offsetParent !== null);
}

function mantenerFocoModalCotizacion(event) {
    if (
        event.key !== "Tab"
        || !modalCotizacionAbierto()
        || hayModalSecundarioAbierto()
    ) {
        return;
    }

    const elementos = elementosInteractivosModalCotizacion();

    if (!elementos.length) {
        event.preventDefault();
        return;
    }

    const primero = elementos[0];
    const ultimo = elementos[elementos.length - 1];

    if (event.shiftKey && document.activeElement === primero) {
        event.preventDefault();
        ultimo.focus();
    } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primero.focus();
    }
}

function abrirDetalleCotizacion(id, boton) {
    const plantilla = document.getElementById(`plantilla-detalle-cotizacion-${id}`);

    if (!plantilla) {
        mostrarToast("No se encontró el detalle de la cotización", "error");
        return;
    }

    abrirDetalleCotizacionDesdePlantilla(plantilla, boton);
}

function abrirDetalleCotizacionDesdePlantilla(plantilla, boton) {
    const modal = document.getElementById("cotizacionDetalleModal");
    const contenido = document.getElementById("cotizacionDetalleModalContenido");
    const principal = document.querySelector(".main");

    if (!modal || !contenido || !plantilla?.content) return;

    cerrarMenusDescargaPdf();
    contenido.replaceChildren(plantilla.content.cloneNode(true));

    if (!modalCotizacionAbierto()) {
        cotizacionModalScrollVentana = window.scrollY;
        cotizacionModalScrollPrincipal = principal?.scrollTop || 0;
    }

    cotizacionModalTrigger = boton || document.activeElement;
    cotizacionModalId = String(plantilla.dataset.cotizacionId || "");
    modal.hidden = false;
    document.body.classList.add("cotizacion-detalle-modal-abierto");

    const archivosId = plantilla.dataset.archivosId;
    const comentariosId = plantilla.dataset.comentariosId;

    if (archivosId) {
        cargarArchivos(cotizacionModalId, archivosId);
    }

    if (comentariosId) {
        cargarComentarios(cotizacionModalId, comentariosId);
    }

    cargarDetallePosventa(cotizacionModalId);

    requestAnimationFrame(() => {
        modal.querySelector(".cotizacion-modal-cerrar")?.focus();
    });
}

function cerrarDetalleCotizacion({ devolverFoco = true } = {}) {
    const modal = document.getElementById("cotizacionDetalleModal");
    const contenido = document.getElementById("cotizacionDetalleModalContenido");
    const principal = document.querySelector(".main");

    if (!modal || modal.hidden) return;

    cerrarMenusDescargaPdf();
    modal.hidden = true;
    contenido?.replaceChildren();
    document.body.classList.remove("cotizacion-detalle-modal-abierto");

    const triggerOriginal = cotizacionModalTrigger;
    const cotizacionId = cotizacionModalId;

    cotizacionModalTrigger = null;
    cotizacionModalId = null;

    requestAnimationFrame(() => {
        window.scrollTo(0, cotizacionModalScrollVentana);
        if (principal) principal.scrollTop = cotizacionModalScrollPrincipal;

        if (!devolverFoco) return;

        if (triggerOriginal?.isConnected) {
            triggerOriginal.focus();
            return;
        }

        document.querySelector(
            `[data-abrir-cotizacion="${cotizacionId}"]`
        )?.focus();
    });
}

function manejarClickExteriorModalCotizacion(event) {
    if (event.target !== event.currentTarget) return;

    if (document.querySelector(".pdf-download-options:not([hidden])")) {
        cerrarMenusDescargaPdf(null, true);
        return;
    }

    if (hayModalSecundarioAbierto()) return;

    cerrarDetalleCotizacion();
}

// =======================
// BUSCAR
// =======================

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

function normalizarEstadoCotizacion(estado) {
    const valor = String(estado || "").trim();

    if (!valor) return "Nuevo";

    return ESTADOS_AFILIADO_LEGACY.includes(valor)
        ? "Afiliado"
        : valor;
}

function estadoCotizacion(c) {
    return normalizarEstadoCotizacion(c.estado);
}

function opcionesEstadoCotizacion(estadoActual) {
    const estados = esAdmin()
        ? ESTADOS_COTIZACION
        : ESTADOS_COTIZACION.filter(estado => estado !== "Anulada");

    return estados.map(estado => `
        <option value="${estado}" ${estado === estadoActual ? "selected" : ""}>
            ${estado}
        </option>
    `).join("");
}

function fechaSeguimientoInput(fecha) {
    if (!fecha) return "";

    return String(fecha).slice(0, 10);
}

function fechaActualInput() {
    return new Date().toLocaleDateString("sv-SE", {
        timeZone: "America/Argentina/Buenos_Aires"
    });
}

function obtenerOpcionesCotizacion(cotizacion) {
    if (Array.isArray(cotizacion.opciones) && cotizacion.opciones.length) {
        return cotizacion.opciones.slice(0, 2);
    }

    return [
        {
            numero_opcion: 1,
            plan: cotizacion.plan || "",
            tipo_cobertura: cotizacion.tipo_cobertura || "Individual",
            valor: cotizacion.valor || "",
            bonificacion: cotizacion.bonificacion || "0",
            bonificacion_aportes: cotizacion.bonificacion_aportes || "0"
        }
    ];
}

function totalOpcionCotizacion(opcion) {
    return Number(opcion.valor || 0)
        - Number(opcion.bonificacion || 0)
        - Number(opcion.bonificacion_aportes || 0);
}

function renderTablaPdfOpcion(opcion, cotizacion) {
    return `
        <section class="pdf-opcion" data-pdf-opcion="${opcion.numero_opcion}">
            <div class="pdf-opcion-titulo">
                <span>Opci&oacute;n ${opcion.numero_opcion}</span>
                <strong>${opcion.plan || "Plan sin especificar"}</strong>
            </div>

            <div class="pdf-opcion-condiciones">
                <span><b>Modalidad:</b> ${cotizacion.modalidad || "Particular"}</span>
                <span><b>Vigencia:</b> ${formatearFechaArgentina(cotizacion.vigencia) || "-"}</span>
            </div>

            <table class="pdf-tabla">
                <thead>
                    <tr>
                        <th>Detalle</th>
                        <th>Informaci&oacute;n</th>
                        <th>Importe</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Plan</td>
                        <td>${opcion.plan || "-"}</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td>Tipo de cobertura</td>
                        <td>${opcion.tipo_cobertura || "Individual"}</td>
                        <td></td>
                    </tr>
                    <tr>
                        <td>Valor</td>
                        <td></td>
                        <td>$ ${Number(opcion.valor || 0).toLocaleString("es-AR")}</td>
                    </tr>
                    <tr>
                        <td>Bonificaci&oacute;n comercial</td>
                        <td></td>
                        <td>- $ ${Number(opcion.bonificacion || 0).toLocaleString("es-AR")}</td>
                    </tr>
                    <tr>
                        <td>Bonificaci&oacute;n por aportes</td>
                        <td></td>
                        <td>- $ ${Number(opcion.bonificacion_aportes || 0).toLocaleString("es-AR")}</td>
                    </tr>
                </tbody>
            </table>

            <div class="pdf-total">
                <span>Total a pagar</span>
                <strong>
                    $ ${totalOpcionCotizacion(opcion).toLocaleString("es-AR")}
                </strong>
            </div>
        </section>
    `;
}

function renderDetalleOpcion(opcion) {
    return `
        <div class="cotizacion-opcion-detalle">
            <h4>Opci&oacute;n ${opcion.numero_opcion}</h4>
            <div class="cotizacion-detalle-grid">
                <p><b>Plan:</b> ${opcion.plan || "-"}</p>
                <p><b>Cobertura:</b> ${opcion.tipo_cobertura || "Individual"}</p>
                <p><b>Valor:</b> $${opcion.valor || 0}</p>
                <p><b>Bonificacion comercial:</b> $${opcion.bonificacion || 0}</p>
                <p><b>Bonificacion por aportes:</b> $${opcion.bonificacion_aportes || 0}</p>
                <p><b>Total:</b> $${totalOpcionCotizacion(opcion).toLocaleString("es-AR")}</p>
            </div>
        </div>
    `;
}

function renderAccionesPdf(cotizacion, cardId) {
    const opciones = obtenerOpcionesCotizacion(cotizacion);

    if (opciones.length < 2) {
        return `
            <button
                type="button"
                class="pdf-download-button"
                onclick="descargarPDF(${cotizacion.id}, 'opcion-1', '${cardId}')"
            >
                <img class="icono-menu" src="img/imgicon-pdf.png" alt="">
                <span>Descargar PDF</span>
            </button>
        `;
    }

    const menuId = `pdf-menu-${cardId}`;

    return `
        <div class="pdf-download-menu" data-pdf-download-menu>
            <button
                type="button"
                class="pdf-download-button"
                aria-haspopup="menu"
                aria-expanded="false"
                aria-controls="${menuId}"
                onclick="toggleMenuDescargaPdf(event, this)"
            >
                <img class="icono-menu" src="img/imgicon-pdf.png" alt="">
                <span>Descargar PDF</span>
                <span class="pdf-download-chevron" aria-hidden="true">&#9662;</span>
            </button>
            <div id="${menuId}" class="pdf-download-options" role="menu" hidden>
                <button
                    type="button"
                    role="menuitem"
                    onclick="seleccionarDescargaPdf(event, ${cotizacion.id}, 'completo', '${cardId}')"
                >
                    PDF completo
                </button>
                <button
                    type="button"
                    role="menuitem"
                    onclick="seleccionarDescargaPdf(event, ${cotizacion.id}, 'opcion-1', '${cardId}')"
                >
                    Solo opci&oacute;n 1
                </button>
                <button
                    type="button"
                    role="menuitem"
                    onclick="seleccionarDescargaPdf(event, ${cotizacion.id}, 'opcion-2', '${cardId}')"
                >
                    Solo opci&oacute;n 2
                </button>
            </div>
        </div>
    `;
}

function renderTarjetaCotizacion(c, opciones = {}) {
    const sufijo = opciones.sufijo || c.id;
    const cardId = opciones.cardId || `card-${c.id}`;
    const detalleId = `plantilla-detalle-cotizacion-${sufijo}`;
    const archivosId = `archivos-${sufijo}`;
    const comentariosId = `comentarios-${sufijo}`;
    const textareaId = `nuevoComentario-${sufijo}`;
    const estadoId = `estado-${sufijo}`;
    const seguimientoId = `fechaSeguimiento-${sufijo}`;
    const estadoActual = estadoCotizacion(c);
    const fechaSeguimiento = fechaSeguimientoInput(c.fecha_seguimiento);
    const clases = `${opciones.clases || ""} ${estadoActual === "Anulada" ? "cotizacion-anulada" : ""}`.trim();
    const estadoAnulado = estadoActual === "Anulada";
    const comentarioModal = String(c.comentarios || "")
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$");
    const dniVisible = mostrarDniCotizacion(c.dni);
    const idVisible = formatearCotizacionId(c.id);
    const opcionesPlan = obtenerOpcionesCotizacion(c);
    const puedeGestionarRecursos = c.vendedora === obtenerPayload().usuario || esAdmin();
    const fechaSeguimientoResumen = fechaSeguimiento
        ? `<p><b>Seguimiento:</b> ${fechaSeguimiento}</p>`
        : "";

    return `
        <div class="card ${clases}" id="${cardId}">

            <div
                class="solo-pdf pdf-documento"
                data-pdf-cotizacion="${idVisible}"
            >
                <div class="pdf-header">
                    <img
                        src="/img/franja-pdf.png"
                        class="franja-pdf"
                        alt="Asismed"
                    >
                </div>

                <div class="pdf-contenido">
                    <div class="pdf-titulo">
                        <p class="pdf-eyebrow">COTIZACI&Oacute;N</p>
                        <p class="pdf-identificador">Cotizaci&oacute;n N&deg; ${idVisible}</p>
                        <h1>${c.nombre || ""}</h1>
                        <p class="pdf-subtitulo">
                            DNI ${dniVisible} &nbsp;|&nbsp; Tel&eacute;fono ${c.celular || "-"}
                        </p>
                    </div>

                    <div class="pdf-opciones-documento">
                        ${opcionesPlan.map(opcion => renderTablaPdfOpcion(opcion, c)).join("")}
                    </div>

                    <div class="pdf-cierre">
                        <div class="pdf-info-adicional">
                            <p><b>Referido:</b> ${c.referido || "No"}</p>
                            <p><b>Congelamiento:</b> ${c.congelamiento || "Sin congelamiento"}</p>
                        </div>

                        <div class="pie-pdf">
                            <p><b>Fecha de emisi&oacute;n:</b> ${formatearFechaArgentina(c.fecha)}</p>
                            <p><b>Vigencia de la cotizaci&oacute;n:</b> ${formatearFechaArgentina(c.vigencia)}</p>
                            <p><b>Asesora comercial:</b> ${c.vendedora}</p>
                            <p><b>Contacto Asismed:</b> WhatsApp 1138687033</p>
                        </div>

                        <p class="pdf-aclaracion">
                            La presente cotizaci&oacute;n queda sujeta a variaciones conforme a
                            actualizaciones, aumentos o ajustes autorizados por Asismed, o a
                            modificaciones de los datos personales informados. Los cambios
                            correspondientes ser&aacute;n aplicados en el mes que se indique.
                        </p>
                    </div>
                </div>
            </div>

            <div class="cotizacion-resumen no-pdf">
                <div class="cotizacion-resumen-datos">
                    <p class="fecha-card">
                        ${formatearFecha(c.fecha)}
                    </p>
                    <div class="cotizacion-resumen-grid">
                        <p><b>Cotizaci&oacute;n N&deg;:</b> ${idVisible}</p>
                        <p><b>DNI:</b> ${dniVisible}</p>
                        <p><b>Telefono:</b> ${c.celular || "-"}</p>
                        <p><b>Asesora:</b> ${c.vendedora}</p>
                        <p><b>Estado:</b> ${estadoActual}</p>
                        ${fechaSeguimientoResumen}
                    </div>
                    ${estadoAnulado ? `<span class="badge-anulada">Cotizacion anulada</span>` : ""}
                </div>

                <button
                    type="button"
                    class="cotizacion-toggle"
                    aria-haspopup="dialog"
                    aria-controls="cotizacionDetalleModal"
                    data-abrir-cotizacion="${c.id}"
                    onclick="abrirDetalleCotizacion('${sufijo}', this)"
                >
                    <span class="texto-toggle">Ver detalle</span>
                    <span class="icono-toggle" aria-hidden="true">+</span>
                </button>
            </div>

            <template
                id="${detalleId}"
                data-cotizacion-id="${c.id}"
                data-archivos-id="${archivosId}"
                data-comentarios-id="${comentariosId}"
            >
                <div class="cotizacion-detalle no-pdf">
                <section class="cotizacion-modal-resumen">
                    <div class="cotizacion-modal-identidad">
                        <div>
                            <span>Cotizaci&oacute;n N&deg; ${idVisible}</span>
                            <h3>${c.nombre || "Sin nombre"}</h3>
                        </div>
                        <span class="cotizacion-modal-estado" data-cotizacion-estado>
                            ${estadoActual}
                        </span>
                    </div>

                    <div class="cotizacion-detalle-grid">
                        <p><b>Fecha:</b> ${formatearFecha(c.fecha)}</p>
                        <p><b>DNI:</b> ${dniVisible}</p>
                        <p><b>Tel&eacute;fono:</b> ${c.celular || "-"}</p>
                        <p><b>Asesora autora:</b> ${c.vendedora || "-"}</p>
                        <p><b>Modalidad:</b> ${c.modalidad || "Particular"}</p>
                        <p><b>V&aacute;lida hasta:</b> ${c.vigencia || "-"}</p>
                        <p><b>Referido:</b> ${c.referido || "No"}</p>
                        <p><b>Congelamiento:</b> ${c.congelamiento || "Sin congelamiento"}</p>
                    </div>
                </section>

                <div class="cotizacion-opciones">
                    ${opcionesPlan.map(renderDetalleOpcion).join("")}
                </div>

                <section
                    class="posventa-panel"
                    data-posventa-panel="${c.id}"
                    hidden
                ></section>

                ${puedeGestionarRecursos ? `
                <div class="seguimiento-controles">
                    <label>
                        Estado
                        <select id="${estadoId}">
                            ${opcionesEstadoCotizacion(estadoActual)}
                        </select>
                    </label>

                    <label>
                        Fecha de seguimiento
                        <input
                            type="date"
                            id="${seguimientoId}"
                            value="${fechaSeguimiento}"
                        >
                    </label>

                    <button
                        type="button"
                        onclick="guardarSeguimientoCotizacion(${c.id}, '${estadoId}', '${seguimientoId}')"
                    >
                        Guardar seguimiento
                    </button>
                </div>
                ` : ""}

                <div class="cotizacion-comentario">
                    <p>
                        <b>Comentario:</b>
                        <span data-comentario-cotizacion>
                            ${c.comentarios || "Sin comentarios"}
                        </span>
                    </p>
                </div>

                <div class="comentarios-internos">
                    <h4>Comentarios internos</h4>

                    <div id="${comentariosId}"></div>

                    <textarea
                        id="${textareaId}"
                        placeholder="Escribir comentario..."
                    ></textarea>

                    <button onclick="agregarComentario(${c.id}, '${textareaId}', '${comentariosId}')">
                        Agregar comentario
                    </button>
                </div>

                ${puedeGestionarRecursos ? `
                <div class="archivos-box">
                    <h4>Adjuntos</h4>
                    <label class="adjunto-dropzone" for="input-${archivosId}">
                        <strong>Agregar imágenes</strong>
                        <small>Podés subir más imágenes hasta llegar al máximo de 5</small>
                    </label>

                    <input
                        type="file"
                        id="input-${archivosId}"
                        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                        multiple
                        onchange="subirArchivo(event, ${c.id}, '${archivosId}')"
                    >

                    <div id="${archivosId}"></div>
                </div>
                ` : ""}

                <div class="cotizacion-acciones">
                    ${puedeGestionarRecursos ? `
                        <button
                            onclick="abrirModal(${c.id}, \`${comentarioModal}\`)"
                        >
                            Editar comentario
                        </button>
                    ` : ""}

                    ${renderAccionesPdf(c, cardId)}

                    ${esAdmin() && !estadoAnulado ? `
                        <button
                            type="button"
                            class="btn-anular"
                            onclick="anularCotizacion(${c.id})"
                        >
                            Anular cotizacion
                        </button>
                    ` : ""}
                </div>
                </div>
            </template>

        </div>
    `;
}
let busquedaCotizacionActual = 0;
let busquedaInicioActual = 0;
const ETAPAS_PIPELINE = [
    "Nuevos",
    "Contactados",
    "Interesados",
    "Documentación",
    "Auditoría",
    "Afiliados"
];
let inicioDatosCrm = {
    pipeline: [],
    tareas: [],
    tareasMes: []
};
let inicioMesActivo = new Date();
let inicioFechaSeleccionada = "";
let inicioCargaCompleta = false;
let estadoModalTareas = "pendiente";
let tareasModalActuales = [];
let botonOrigenModalTareas = null;

function etapaClase(etapa) {
    const normalizada = String(etapa || "sin-cotizacion")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "-");

    return `etapa-${normalizada}`;
}

const ETIQUETAS_ESTADO_POSVENTA = {
    en_seguimiento: "En seguimiento",
    pago_3_meses: "Pagó 3 meses",
    pendiente_mora: "Pendiente por mora",
    baja_mora: "Baja por mora"
};

function claseColorPosventa(cotizacion) {
    if ((cotizacion.etapa_pipeline || "") !== "Afiliados") return "";

    const color = cotizacion.color;

    if (color === "amarillo") return "posventa-color-amarillo";
    if (color === "rojo") return "posventa-color-rojo";
    if (color === "verde") return "posventa-color-verde";
    if (color === "baja-mora") return "posventa-color-baja";

    return "";
}

function renderIndicadorPosventaPipeline(cotizacion) {
    if ((cotizacion.etapa_pipeline || "") !== "Afiliados") return "";

    if (!cotizacion.fecha_alta) {
        return `
            <div class="pipeline-posventa-pendiente" data-no-drag>
                <p class="pipeline-posventa-indicador">
                    <strong>Posventa:</strong> falta cargar fecha de alta
                </p>
                <button
                    type="button"
                    class="pipeline-cargar-fecha"
                    data-no-drag
                    data-cargar-fecha-alta="${cotizacion.id}"
                    onclick="event.stopPropagation(); abrirModalFechaAltaPosventa(${cotizacion.id}, this)"
                    onpointerdown="event.stopPropagation()"
                >
                    Cargar fecha de alta
                </button>
            </div>
        `;
    }

    const estado = ETIQUETAS_ESTADO_POSVENTA[cotizacion.estado_posventa]
        || "En seguimiento";

    return `
        <p class="pipeline-posventa-indicador">
            <strong>Posventa:</strong>
            Alta ${formatearFechaArgentina(cotizacion.fecha_alta)}
            · ${cotizacion.mes_texto || "Primer mes"} · ${estado}
        </p>
    `;
}

function fechaIsoLocal(fecha = new Date()) {
    const copia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());

    return copia.toISOString().slice(0, 10);
}

function esFechaVencida(fecha, estado = "pendiente") {
    return estado === "pendiente" && String(fecha || "").slice(0, 10) < fechaIsoLocal();
}

function mesIso(fecha = new Date()) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

function textoMes(fecha) {
    const texto = fecha.toLocaleDateString("es-AR", {
        month: "long",
        year: "numeric"
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatearFechaLarga(fechaIso) {
    const fecha = new Date(`${fechaIso}T12:00:00`);
    const texto = fecha.toLocaleDateString("es-AR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function analizarTelefonoArgentina(valor) {
    let numero = String(valor || "").replace(/\D/g, "");

    if (!numero) {
        return {
            nacional: "",
            whatsapp: "",
            validoWhatsapp: false,
            ambiguo: false
        };
    }

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
    const nacional = opciones.length === 1 ? opciones[0] : numero;

    return {
        nacional,
        whatsapp: opciones.length === 1 ? `549${opciones[0]}` : "",
        validoWhatsapp: opciones.length === 1,
        ambiguo: opciones.length > 1
    };
}

function normalizarTelefono(valor) {
    return analizarTelefonoArgentina(valor).nacional;
}

function normalizarTelefonoWhatsappArgentina(valor) {
    return analizarTelefonoArgentina(valor).whatsapp;
}

function mostrarDniCotizacion(dni) {
    return String(dni || "").trim() || "Sin DNI";
}

function formatearCotizacionId(id) {
    return String(id || "").padStart(6, "0");
}

function opcionPlan2Visible() {
    const bloque = document.getElementById("opcionPlan2Block");
    return Boolean(bloque && !bloque.hidden);
}

function mostrarOpcionPlan2() {
    const bloque = document.getElementById("opcionPlan2Block");
    const btnAgregar = document.getElementById("btnAgregarOpcionPlan");
    const btnQuitar = document.getElementById("btnQuitarOpcionPlan");

    if (bloque) bloque.hidden = false;
    if (btnAgregar) btnAgregar.hidden = true;
    if (btnQuitar) btnQuitar.hidden = false;

    actualizarTotalCotizacion();
}

function ocultarOpcionPlan2() {
    const bloque = document.getElementById("opcionPlan2Block");
    const btnAgregar = document.getElementById("btnAgregarOpcionPlan");
    const btnQuitar = document.getElementById("btnQuitarOpcionPlan");

    if (bloque) bloque.hidden = true;
    if (btnAgregar) btnAgregar.hidden = false;
    if (btnQuitar) btnQuitar.hidden = true;

    ["plan2", "valor2", "bonificacion2", "bonificacionAportes2"].forEach(id =>
        setValorCampo(id)
    );
    setIndiceCampo("tipoCobertura2");
    actualizarTotalCotizacion();
}

function obtenerOpcionesFormulario() {
    const opciones = [
        {
            numero_opcion: 1,
            plan: document.getElementById("plan").value,
            tipo_cobertura: document.getElementById("tipoCobertura").value,
            valor: document.getElementById("valor").value,
            bonificacion: document.getElementById("bonificacion").value || 0,
            bonificacion_aportes:
                document.getElementById("bonificacionAportes").value || 0
        }
    ];

    if (opcionPlan2Visible()) {
        opciones.push({
            numero_opcion: 2,
            plan: document.getElementById("plan2").value,
            tipo_cobertura: document.getElementById("tipoCobertura2").value,
            valor: document.getElementById("valor2").value,
            bonificacion: document.getElementById("bonificacion2").value || 0,
            bonificacion_aportes:
                document.getElementById("bonificacionAportes2").value || 0
        });
    }

    return opciones;
}

function obtenerDniCotizacionValor() {
    const dniCotizacion = document.getElementById("dniCotizacion")?.value.trim();
    const terminoBusqueda = document.getElementById("dni")?.value.trim();

    if (dniCotizacion) return dniCotizacion;

    return /^\d{7,8}$/.test(terminoBusqueda || "")
        ? terminoBusqueda
        : "";
}

function limpiarResultadosBusqueda() {
    const div = obtenerContenedorResultadosBusqueda();

    if (div) {
        div.innerHTML = "";
    }
}

function obtenerContenedorResultadosBusqueda() {
    return document.querySelector("#cotizador #resultados")
        || document.getElementById("resultados");
}

function setValorCampo(id, valor = "") {
    const campo = document.getElementById(id);

    if (campo) {
        campo.value = valor;
    }
}

function setIndiceCampo(id, indice = 0) {
    const campo = document.getElementById(id);

    if (campo) {
        campo.selectedIndex = indice;
    }
}

function setCheckedCampo(id, checked = false) {
    const campo = document.getElementById(id);

    if (campo) {
        campo.checked = checked;
    }
}

function limpiarFormularioCotizacion() {
    [
        "dniCotizacion",
        "nombre",
        "celular",
        "valor",
        "valor2",
        "bonificacion",
        "bonificacion2",
        "bonificacionAportes",
        "bonificacionAportes2",
        "vigencia",
        "congelamiento",
        "comentarios"
    ].forEach(id => setValorCampo(id));

    setIndiceCampo("plan");
    setIndiceCampo("plan2");
    setIndiceCampo("tipoCobertura");
    setIndiceCampo("tipoCobertura2");
    setIndiceCampo("modalidad");
    setCheckedCampo("referido");
    setValorCampo("clienteIdCotizacion");
    setValorCampo("terminoBusquedaCotizacion");
    ocultarOpcionPlan2();

    const adjuntoInput = document.getElementById("adjuntoCotizacion");
    if (adjuntoInput) {
        adjuntoInput.value = "";
    }

    const preview = document.getElementById("previewAdjuntosCotizacion");
    if (preview) {
        preview.innerHTML = "<small>Sin archivos seleccionados</small>";
    }

    actualizarTotalCotizacion();
}

function completarFormularioCotizacion(cotizacion, termino) {
    setValorCampo("nombre", cotizacion.nombre || "");
    setValorCampo("celular", cotizacion.celular || "");
    setValorCampo("dniCotizacion", cotizacion.dni || "");
}

function completarFormularioClienteInicio(cliente, termino) {
    limpiarFormularioCotizacion();
    setValorCampo("clienteIdCotizacion", cliente.id || "");
    setValorCampo("terminoBusquedaCotizacion", termino || "");
    setValorCampo("dni", termino || cliente.dni || cliente.telefono_normalizado || "");
    setValorCampo("nombre", cliente.nombre || "");
    setValorCampo("celular", cliente.telefono_normalizado || cliente.celular || "");
    setValorCampo("dniCotizacion", cliente.dni || cliente.dni_normalizado || "");
}

function abrirCotizadorManual() {
    limpiarFormularioCotizacion();
    limpiarResultadosBusqueda();
    const inputBusqueda = document.getElementById("dni");
    if (inputBusqueda) {
        inputBusqueda.value = "";
    }
    mostrarSeccion("cotizador");
}

function renderResumenCotizacionInicio(cotizacion) {
    const opciones = obtenerOpcionesCotizacion(cotizacion);
    const opcionPrincipal = opciones[0] || {};
    const estado = estadoCotizacion(cotizacion);

    return `
        <div class="inicio-cotizacion-item">
            <div>
                <strong>Cotizaci&oacute;n N&deg; ${formatearCotizacionId(cotizacion.id)}</strong>
                <span>${formatearFecha(cotizacion.fecha)}</span>
            </div>
            <div>
                <span>Plan</span>
                <strong>${opcionPrincipal.plan || cotizacion.plan || "-"}</strong>
            </div>
            <div>
                <span>Valor</span>
                <strong>$ ${Number(opcionPrincipal.valor || cotizacion.valor || 0).toLocaleString("es-AR")}</strong>
            </div>
            <div>
                <span>Estado</span>
                <strong>${estado}</strong>
            </div>
            <div>
                <span>Vendedora</span>
                <strong>${cotizacion.vendedora || "-"}</strong>
            </div>
            <div class="inicio-cotizacion-acciones">
                <button
                    type="button"
                    onclick="toggleInicioDetalle('${cotizacion.id}')"
                >
                    Ver detalle
                </button>
                ${opciones.map(opcion => `
                    <button
                        type="button"
                        onclick="descargarPDF(${cotizacion.id}, ${opcion.numero_opcion})"
                    >
                        PDF ${opcion.numero_opcion}
                    </button>
                `).join("")}
            </div>
            <div
                id="inicio-detalle-${cotizacion.id}"
                class="inicio-cotizacion-detalle"
                hidden
            >
                <div class="inicio-detalle-card">
                    <div class="cotizacion-detalle-grid">
                        <p><b>DNI:</b> ${mostrarDniCotizacion(cotizacion.dni)}</p>
                        <p><b>Tel&eacute;fono:</b> ${cotizacion.celular || "-"}</p>
                        <p><b>Modalidad:</b> ${cotizacion.modalidad || "Particular"}</p>
                        <p><b>V&aacute;lida hasta:</b> ${cotizacion.vigencia || "-"}</p>
                        <p><b>Referido:</b> ${cotizacion.referido || "No"}</p>
                        <p><b>Congelamiento:</b> ${cotizacion.congelamiento || "Sin congelamiento"}</p>
                    </div>
                    <div class="cotizacion-opciones">
                        ${opciones.map(renderDetalleOpcion).join("")}
                    </div>
                    <p><b>Comentario:</b> ${cotizacion.comentarios || "Sin comentarios"}</p>
                </div>
            </div>
        </section>
    `;
}

function toggleInicioDetalle(id) {
    const detalle = document.getElementById(`inicio-detalle-${id}`);

    if (!detalle) return;

    detalle.hidden = !detalle.hidden;
}

async function cargarCotizacionesClienteInicio(cliente, termino) {
    const res = await fetch(
        `/clientes/${cliente.id}/cotizaciones?termino=${encodeURIComponent(termino)}`,
        { headers: authHeaders() }
    );

    if (await manejarError(res)) return [];

    if (!res.ok) {
        return [];
    }

    return res.json();
}

async function buscarClienteInicio() {
    const busquedaId = ++busquedaInicioActual;
    const input = document.getElementById("inicioBusquedaCliente");
    const contenedor = document.getElementById("inicioResultadoCliente");
    const termino = input?.value.trim() || "";

    if (!contenedor) return;

    contenedor.innerHTML = "";

    if (!termino) {
        mostrarToast("Ingres&aacute; un DNI completo o tel&eacute;fono", "error");
        return;
    }

    mostrarLoader();

    try {
        const res = await fetch(
            `/clientes/buscar?termino=${encodeURIComponent(termino)}`,
            { headers: authHeaders() }
        );

        if (busquedaId !== busquedaInicioActual) return;
        if (await manejarError(res)) return;

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            contenedor.innerHTML = `<p>${error.error || "No se pudo buscar el cliente"}</p>`;
            return;
        }

        const data = await res.json();

        if (!data.clientes || data.clientes.length === 0) {
            contenedor.innerHTML = "<p>No se encontr&oacute; ning&uacute;n cliente.</p>";
            return;
        }

        const cliente = data.clientes[0];
        const cotizaciones = await cargarCotizacionesClienteInicio(cliente, termino);

        if (busquedaId !== busquedaInicioActual) return;

        contenedor.innerHTML = `
            <div class="inicio-cliente-card">
                <div class="inicio-cliente-datos">
                    <div>
                        <span>Cliente</span>
                        <strong>${cliente.nombre || "-"}</strong>
                    </div>
                    <div>
                        <span>DNI</span>
                        <strong>${cliente.dni || cliente.dni_normalizado || "-"}</strong>
                    </div>
                    <div>
                        <span>Tel&eacute;fono</span>
                        <strong>${cliente.telefono_normalizado || cliente.celular || "-"}</strong>
                    </div>
                    <div>
                        <span>Cotizaciones</span>
                        <strong>${cotizaciones.length}</strong>
                    </div>
                </div>
                <button
                    type="button"
                    class="inicio-nueva-cotizacion"
                    onclick="nuevaCotizacionDesdeInicio('${cliente.id}', '${encodeURIComponent(termino)}')"
                >
                    + Nueva cotizaci&oacute;n
                </button>
            </div>
            <div class="inicio-historial">
                <h4>Historial de cotizaciones</h4>
                ${
                    cotizaciones.length
                        ? cotizaciones.map(renderResumenCotizacionInicio).join("")
                        : "<p>Este cliente todav&iacute;a no tiene cotizaciones.</p>"
                }
            </div>
        `;

        window.ultimoClienteInicio = cliente;

    } catch (error) {
        contenedor.innerHTML = "<p>No se pudo realizar la b&uacute;squeda.</p>";
    } finally {
        ocultarLoader();
    }
}

function nuevaCotizacionDesdeInicio(clienteId, terminoCodificado) {
    const cliente = window.ultimoClienteInicio;
    const termino = decodeURIComponent(terminoCodificado || "");

    if (!cliente || String(cliente.id) !== String(clienteId)) {
        mostrarToast("Volv&eacute; a buscar el cliente", "error");
        return;
    }

    completarFormularioClienteInicio(cliente, termino);
    mostrarSeccion("cotizador");
}

function todasLasCotizacionesPipeline() {
    return (inicioDatosCrm.pipeline || [])
        .flatMap(grupo => grupo.cotizaciones || []);
}

function mostrarEstadoInicio(tipo = "", mensaje = "") {
    const estado = document.getElementById("inicioEstado");

    if (!estado) return;

    estado.hidden = !mensaje;
    estado.className = `inicio-status${tipo ? ` inicio-status-${tipo}` : ""}`;
    estado.textContent = mensaje;
}

function actualizarStatsInicio(estadisticas = null) {
    const valores = {
        statCotizacionesMes: estadisticas?.cotizaciones_mes,
        statClientesMes: estadisticas?.nuevos_clientes_mes,
        statSeguimientosPendientes: estadisticas?.seguimientos_pendientes,
        statAfiliadosMes: estadisticas?.afiliados_mes
    };

    Object.entries(valores).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (!el) return;

        el.textContent = valor === null || valor === undefined
            ? "—"
            : Number(valor).toLocaleString("es-AR");
    });
}

function prepararInicioCrm() {
    actualizarStatsInicio(null);
    renderPipelineInicio([], "loading");
    renderCalendarioInicio();
    renderTareasInicio([], "loading");
    mostrarEstadoInicio("loading", "Cargando información comercial...");
}

function mostrarErrorInicio(mensaje) {
    if (!inicioCargaCompleta) {
        inicioDatosCrm = { pipeline: [], tareas: [], tareasMes: [] };
        actualizarStatsInicio(null);
        renderPipelineInicio([], "error");
        renderCalendarioInicio();
        renderTareasInicio([], "error");
    }

    mostrarEstadoInicio("error", mensaje);
}

function renderSelectorEtapa(cotizacion) {
    return `
        <label class="pipeline-selector" data-no-drag>
            <select
                data-no-drag
                aria-label="Etapa"
                onchange="cambiarEtapaPipeline(${cotizacion.id}, this.value)"
            >
                ${ETAPAS_PIPELINE.map(etapa => `
                    <option value="${etapa}" ${etapa === cotizacion.etapa_pipeline ? "selected" : ""}>
                        ${etapa}
                    </option>
                `).join("")}
            </select>
        </label>
    `;
}

function obtenerProximaTareaCotizacion(cotizacionId) {
    return (inicioDatosCrm.tareas || [])
        .filter(tarea =>
            tarea.estado === "pendiente"
            && String(tarea.cotizacion_id || "") === String(cotizacionId)
            && tarea.fecha
        )
        .sort((a, b) => {
            const fechaA = `${String(a.fecha).slice(0, 10)}T${a.hora || "23:59"}`;
            const fechaB = `${String(b.fecha).slice(0, 10)}T${b.hora || "23:59"}`;

            return fechaA.localeCompare(fechaB);
        })[0] || null;
}

function renderProximaTareaPipeline(cotizacionId) {
    const tarea = obtenerProximaTareaCotizacion(cotizacionId);

    if (!tarea) return "";

    const fecha = String(tarea.fecha).slice(0, 10);
    const hoy = fechaIsoLocal();
    const texto = fecha < hoy
        ? "Tarea vencida"
        : fecha === hoy
            ? "Tarea para hoy"
            : "Próxima tarea";

    return `<p class="pipeline-proxima-tarea">${texto}</p>`;
}

function renderTelefonoWhatsappPipeline(celular) {
    const telefonoVisible = celular || "Sin tel&eacute;fono";
    const telefonoWhatsapp = normalizarTelefonoWhatsappArgentina(celular);

    if (!telefonoWhatsapp) {
        return `<p class="pipeline-telefono">${telefonoVisible}</p>`;
    }

    return `
        <p class="pipeline-telefono">
            <a
                class="pipeline-whatsapp-link"
                href="https://wa.me/${telefonoWhatsapp}"
                target="_blank"
                rel="noopener noreferrer"
                draggable="false"
                data-no-drag
                aria-label="Abrir ${telefonoVisible} en WhatsApp"
                onclick="event.stopPropagation()"
                onpointerdown="event.stopPropagation()"
                ondragstart="event.preventDefault(); event.stopPropagation()"
            >
                <img src="img/icono-whatsapp.svg" alt="" aria-hidden="true">
                <span>${telefonoVisible}</span>
            </a>
        </p>
    `;
}

function renderPipelineCard(cotizacion) {
    const etapa = cotizacion.etapa_pipeline || "Nuevos";
    const plan = cotizacion.plan || "-";

    return `
        <article
            class="pipeline-card ${etapaClase(etapa)} ${claseColorPosventa(cotizacion)}"
            draggable="true"
            data-cotizacion-id="${cotizacion.id}"
            ondragstart="iniciarArrastrePipeline(event, ${cotizacion.id})"
        >
            <div class="pipeline-card-head">
                <strong>${cotizacion.nombre || "Sin nombre"}</strong>
                <span>${etapa}</span>
            </div>
            <p>${plan}</p>
            ${renderTelefonoWhatsappPipeline(cotizacion.celular)}
            ${renderIndicadorPosventaPipeline(cotizacion)}
            ${renderProximaTareaPipeline(cotizacion.id)}
            ${esAdmin() ? `<p>Vendedora: ${cotizacion.vendedora || "-"}</p>` : ""}
            ${renderSelectorEtapa(cotizacion)}
            <button
                type="button"
                data-no-drag
                data-abrir-cotizacion="${cotizacion.id}"
                onclick="abrirDetalleCotizacionPipeline(${cotizacion.id}, this)"
            >
                Ver detalle
            </button>
        </article>
    `;
}

function opcionesEstadoPosventa(estadoActual) {
    return Object.entries(ETIQUETAS_ESTADO_POSVENTA)
        .map(([valor, etiqueta]) => `
            <option value="${valor}" ${valor === estadoActual ? "selected" : ""}>
                ${etiqueta}
            </option>
        `)
        .join("");
}

function renderHistorialPosventa(historial = []) {
    if (!historial.length) {
        return `<p class="posventa-sin-historial">Todavía no hay cambios registrados.</p>`;
    }

    return `
        <ol class="posventa-historial">
            ${historial.map(item => `
                <li>
                    <strong>${ETIQUETAS_ESTADO_POSVENTA[item.estado_nuevo] || item.estado_nuevo}</strong>
                    <span>
                        ${formatearFechaArgentina(item.fecha)}
                        · ${escaparHtml(item.usuario || "-")}
                    </span>
                </li>
            `).join("")}
        </ol>
    `;
}

function renderDetallePosventa(datos) {
    const estado = datos.estado_posventa || "en_seguimiento";
    const proximaTarea = datos.requiere_fecha_alta
        ? `
            <p>
                <b>Próximo control:</b>
                se programará al confirmar la fecha de alta
            </p>
        `
        : datos.proxima_tarea
        ? `
            <p>
                <b>Próximo control:</b>
                ${escaparHtml(datos.proxima_tarea.titulo)}
                · ${formatearFechaArgentina(datos.proxima_tarea.fecha)}
            </p>
        `
        : `<p><b>Próximo control:</b> sin tareas automáticas pendientes</p>`;
    const avisoBaja = estado === "baja_mora"
        ? `
            <p class="posventa-alerta-baja">
                Baja por mora registrada. Este caso puede generar un descuento
                sobre una comisión futura.
            </p>
        `
        : "";

    return `
        <div class="posventa-panel-header">
            <div>
                <span>Control de afiliación</span>
                <h4>Seguimiento de posventa</h4>
            </div>
            <span class="posventa-estado posventa-estado-${estado}">
                ${datos.requiere_fecha_alta
                    ? "Fecha pendiente"
                    : ETIQUETAS_ESTADO_POSVENTA[estado] || estado}
            </span>
        </div>

        <div class="posventa-resumen">
            <p>
                <b>Fecha de alta:</b>
                ${datos.fecha_alta
                    ? formatearFechaArgentina(datos.fecha_alta)
                    : "Pendiente de carga"}
            </p>
            <p><b>Mes actual:</b> ${datos.mes_texto || "Sin fecha de alta"}</p>
            ${proximaTarea}
        </div>

        ${avisoBaja}

        ${datos.puede_editar ? `
            <div class="posventa-controles">
                <label>
                    Fecha de alta
                    <input
                        type="date"
                        data-posventa-fecha
                        value="${datos.fecha_alta || ""}"
                    >
                </label>
                <label>
                    Estado de posventa
                    <select data-posventa-estado>
                        ${opcionesEstadoPosventa(estado)}
                    </select>
                </label>
                <button
                    type="button"
                    onclick="guardarPosventaCotizacion(${datos.cotizacion_id})"
                >
                    ${datos.requiere_fecha_alta
                        ? "Guardar fecha y activar seguimiento"
                        : "Guardar posventa"}
                </button>
            </div>
        ` : ""}

        <details class="posventa-historial-box">
            <summary>Historial de estados</summary>
            ${renderHistorialPosventa(datos.historial)}
        </details>
    `;
}

async function cargarDetallePosventa(cotizacionId) {
    const panel = document.querySelector(
        `[data-posventa-panel="${cotizacionId}"]`
    );

    if (!panel) return;

    panel.hidden = false;
    panel.innerHTML = `<p class="inicio-empty">Cargando posventa...</p>`;

    try {
        const res = await fetch(`/cotizaciones/${cotizacionId}/posventa`, {
            headers: authHeaders()
        });

        if (res.status === 403) {
            panel.hidden = true;
            panel.replaceChildren();
            return;
        }

        if (await manejarError(res)) return;

        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            panel.hidden = false;
            panel.innerHTML = `
                <p class="inicio-empty error">
                    ${escaparHtml(
                        datos.error
                        || "No se pudo cargar el seguimiento de posventa."
                    )}
                </p>
            `;
            return;
        }

        if (!datos.aplica) {
            panel.hidden = true;
            panel.replaceChildren();
            return;
        }

        panel.innerHTML = renderDetallePosventa(datos);
    } catch (error) {
        panel.innerHTML = `
            <p class="inicio-empty error">
                No se pudo cargar el seguimiento de posventa.
            </p>
        `;
    }
}

let posventaFechaAltaTrigger = null;

function abrirModalFechaAltaPosventa(cotizacionId, trigger = null, fecha = "") {
    const modal = document.getElementById("posventaFechaAltaModal");
    const inputId = document.getElementById("posventaFechaAltaCotizacionId");
    const inputFecha = document.getElementById("posventaFechaAltaInput");
    const descripcion = document.getElementById("posventaFechaAltaDescripcion");
    const cotizacion = todasLasCotizacionesPipeline().find(
        item => String(item.id) === String(cotizacionId)
    );

    if (!modal || !inputId || !inputFecha) return;

    posventaFechaAltaTrigger = trigger || document.activeElement;
    inputId.value = cotizacionId;
    inputFecha.value = fecha || cotizacion?.fecha_alta || fechaIsoLocal();

    if (descripcion) {
        descripcion.textContent = cotizacion?.nombre
            ? `Confirmá la fecha de alta de ${cotizacion.nombre}.`
            : "Confirmá la fecha informada por Auditoría.";
    }

    modal.hidden = false;
    document.body.classList.add("posventa-fecha-modal-abierto");

    requestAnimationFrame(() => inputFecha.focus());
}

function cerrarModalFechaAltaPosventa({ devolverFoco = true } = {}) {
    const modal = document.getElementById("posventaFechaAltaModal");

    if (!modal || modal.hidden) return;

    modal.hidden = true;
    document.body.classList.remove("posventa-fecha-modal-abierto");

    const trigger = posventaFechaAltaTrigger;
    posventaFechaAltaTrigger = null;

    if (devolverFoco && trigger?.isConnected) {
        requestAnimationFrame(() => trigger.focus());
    }
}

async function guardarFechaAltaPosventa(event) {
    event.preventDefault();

    const cotizacionId = document.getElementById(
        "posventaFechaAltaCotizacionId"
    )?.value;
    const fechaAlta = document.getElementById("posventaFechaAltaInput")?.value;

    if (!cotizacionId || !fechaAlta) {
        mostrarToast("Ingresá la fecha de alta", "error");
        return;
    }

    mostrarLoader();

    try {
        const res = await fetch(`/cotizaciones/${cotizacionId}/posventa`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({ fecha_alta: fechaAlta })
        });
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;

        if (!res.ok) {
            mostrarToast(
                datos.error || "No se pudo guardar la fecha de alta",
                "error"
            );
            return;
        }

        cerrarModalFechaAltaPosventa({ devolverFoco: false });
        await actualizarInicioCoordinado();

        if (
            modalCotizacionAbierto()
            && String(cotizacionModalId) === String(cotizacionId)
        ) {
            await cargarDetallePosventa(cotizacionId);
        }

        document.querySelector(
            `[data-cotizacion-id="${cotizacionId}"] [data-abrir-cotizacion]`
        )?.focus();
        mostrarToast("Fecha de alta guardada", "success");
    } catch (error) {
        mostrarToast("No se pudo guardar la fecha de alta", "error");
    } finally {
        ocultarLoader();
    }
}

async function guardarPosventaCotizacion(cotizacionId) {
    const panel = document.querySelector(
        `[data-posventa-panel="${cotizacionId}"]`
    );
    const fechaAlta = panel?.querySelector("[data-posventa-fecha]")?.value;
    const estadoPosventa = panel?.querySelector("[data-posventa-estado]")?.value;

    if (!fechaAlta) {
        mostrarToast("Ingresá la fecha de alta", "error");
        return;
    }

    mostrarLoader();

    try {
        const res = await fetch(`/cotizaciones/${cotizacionId}/posventa`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({
                fecha_alta: fechaAlta,
                estado_posventa: estadoPosventa
            })
        });
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;

        if (!res.ok) {
            mostrarToast(
                datos.error || "No se pudo guardar la posventa",
                "error"
            );
            return;
        }

        mostrarToast("Seguimiento de posventa actualizado", "success");
        await actualizarInicioCoordinado();
        await cargarDetallePosventa(cotizacionId);
    } catch (error) {
        mostrarToast("No se pudo guardar la posventa", "error");
    } finally {
        ocultarLoader();
    }
}

function renderPipelineInicio(pipeline = [], estado = "ready") {
    const contenedor = document.getElementById("inicioPipeline");

    if (!contenedor) return;

    contenedor.innerHTML = ETAPAS_PIPELINE.map(etapa => {
        const grupo = pipeline.find(item => item.etapa === etapa) || {
            cotizaciones: []
        };
        const mensajeVacio = estado === "error"
            ? "Datos no disponibles"
            : "Sin oportunidades";
        const contador = estado === "ready" ? grupo.cotizaciones.length : "—";
        const contenido = estado === "loading"
            ? `
                <div class="pipeline-loading" aria-label="Cargando oportunidades">
                    <span class="pipeline-skeleton" aria-hidden="true"></span>
                    <span class="pipeline-skeleton" aria-hidden="true"></span>
                </div>
            `
            : grupo.cotizaciones.length
                ? grupo.cotizaciones.map(renderPipelineCard).join("")
                : `<p class="pipeline-empty">${mensajeVacio}</p>`;

        return `
            <section
                class="pipeline-column ${etapaClase(etapa)}"
                data-etapa="${etapa}"
                ondragover="permitirSoltarPipeline(event)"
                ondrop="soltarPipeline(event, '${etapa}')"
            >
                <header>
                    <span>${etapa}</span>
                    <strong>${contador}</strong>
                </header>
                <div class="pipeline-column-body">
                    ${contenido}
                </div>
            </section>
        `;
    }).join("");
}

function iniciarArrastrePipeline(event, cotizacionId) {
    if (event.target.closest("[data-no-drag]")) {
        event.preventDefault();
        return;
    }

    event.dataTransfer.setData("text/plain", String(cotizacionId));
    event.dataTransfer.effectAllowed = "move";
}

function permitirSoltarPipeline(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
}

async function soltarPipeline(event, etapa) {
    event.preventDefault();
    const cotizacionId = event.dataTransfer.getData("text/plain");

    if (!cotizacionId) return;

    await cambiarEtapaPipeline(cotizacionId, etapa);
}

async function cambiarEtapaPipeline(cotizacionId, etapa) {
    mostrarLoader();

    try {
        const res = await fetch(`/cotizaciones/${cotizacionId}/etapa-pipeline`, {
            method: "PUT",
            headers: authHeaders(),
            body: JSON.stringify({ etapa_pipeline: etapa })
        });

        if (await manejarError(res)) return;

        const datos = await res.json().catch(() => ({}));

        if (!res.ok) {
            mostrarToast(datos.error || "No se pudo cambiar la etapa", "error");
            return;
        }

        await actualizarInicioCoordinado();

        if (etapa === "Afiliados" && datos.requiere_fecha_alta) {
            const botonFecha = document.querySelector(
                `[data-cargar-fecha-alta="${cotizacionId}"]`
            );

            abrirModalFechaAltaPosventa(
                cotizacionId,
                botonFecha,
                datos.fecha_alta || ""
            );
        }
    } catch (error) {
        mostrarToast("No se pudo cambiar la etapa", "error");
    } finally {
        ocultarLoader();
    }
}

async function abrirDetalleCotizacionPipeline(cotizacionId, boton) {
    let plantilla = [...document.querySelectorAll(
        "template[data-cotizacion-id]"
    )].find(item => String(item.dataset.cotizacionId) === String(cotizacionId));

    if (!plantilla) {
        mostrarLoader();

        try {
            await cargarMisCotizaciones();
            plantilla = [...document.querySelectorAll(
                "template[data-cotizacion-id]"
            )].find(item =>
                String(item.dataset.cotizacionId) === String(cotizacionId)
            );
        } finally {
            ocultarLoader();
        }
    }

    if (!plantilla) {
        mostrarToast("No se encontró la cotización", "error");
        return;
    }

    abrirDetalleCotizacionDesdePlantilla(plantilla, boton);
}

function ordenarTareasInicio(tareas = []) {
    return [...tareas].sort((a, b) => {
        const fechaA = String(a.fecha || "").slice(0, 10);
        const fechaB = String(b.fecha || "").slice(0, 10);
        const comparacionFecha = fechaA.localeCompare(fechaB);

        if (comparacionFecha) return comparacionFecha;

        const tieneHoraA = Boolean(a.hora);
        const tieneHoraB = Boolean(b.hora);

        if (tieneHoraA !== tieneHoraB) return tieneHoraA ? -1 : 1;

        const comparacionHora = String(a.hora || "").localeCompare(String(b.hora || ""));

        if (comparacionHora) return comparacionHora;

        return Number(b.id || 0) - Number(a.id || 0);
    });
}

function tareasPorGrupo(tareas = []) {
    const hoy = fechaIsoLocal();
    const pendientes = ordenarTareasInicio(
        tareas.filter(tarea => tarea.estado === "pendiente")
    );

    return {
        vencidas: pendientes.filter(tarea => String(tarea.fecha).slice(0, 10) < hoy),
        hoy: pendientes.filter(tarea => String(tarea.fecha).slice(0, 10) === hoy),
        proximas: pendientes.filter(tarea => String(tarea.fecha).slice(0, 10) > hoy),
        todas: pendientes
    };
}

function renderTareaItem(tarea) {
    const etapa = tarea.etapa_pipeline || "Sin cotización";
    const vencida = esFechaVencida(tarea.fecha, tarea.estado);
    const nombre = tarea.cotizacion_nombre || tarea.cliente_nombre || "";
    const relacion = tarea.cotizacion_id
        ? `Cotización #${formatearCotizacionId(tarea.cotizacion_id)}${nombre ? ` · ${nombre}` : ""}`
        : nombre;
    const tipo = String(tarea.tipo || "tarea");
    const tipoVisible = tipo.charAt(0).toUpperCase() + tipo.slice(1);
    const estadoVisible = tarea.estado === "realizada"
        ? "Realizada"
        : tarea.estado === "cancelada"
            ? "Cancelada"
            : "";

    return `
        <article class="tarea-item ${etapaClase(tarea.etapa_pipeline)} ${vencida ? "tarea-vencida" : ""}"
            data-tarea-id="${tarea.id}">
            <div class="tarea-item-main">
                <strong>${tarea.titulo}</strong>
                ${relacion ? `<small>${relacion}</small>` : ""}
                <span>${formatearFechaArgentina(tarea.fecha)}${tarea.hora ? ` · ${String(tarea.hora).slice(0, 5)}` : ""}</span>
                <small>${tipoVisible} · ${etapa}${estadoVisible ? ` · ${estadoVisible}` : ""}</small>
                ${esAdmin() ? `<small>Responsable: ${tarea.usuario_responsable || "-"}</small>` : ""}
            </div>
            <div class="tarea-actions">
                ${tarea.cotizacion_id ? `
                    <button type="button" onclick="abrirDetalleCotizacionPipeline(${tarea.cotizacion_id}, this)">
                        Cotización
                    </button>
                ` : ""}
                <button type="button" onclick="editarTareaInicio(${tarea.id})">Editar</button>
                ${tarea.estado === "pendiente" ? `
                    <button type="button" onclick="marcarTareaRealizada(${tarea.id})">Realizada</button>
                    <button type="button" onclick="cancelarTareaInicio(${tarea.id})">Cancelar</button>
                ` : ""}
            </div>
        </article>
    `;
}

function renderGrupoTareas(titulo, tareas) {
    return `
        <section class="tarea-grupo">
            <h4>${titulo}</h4>
            ${tareas.map(renderTareaItem).join("")}
        </section>
    `;
}

function renderTareasInicio(tareas = inicioDatosCrm.tareas, estado = "ready") {
    const contenedor = document.getElementById("inicioTareas");
    const btn = document.querySelector(".inicio-ver-todas");
    const contexto = document.getElementById("inicioTareasContexto");
    const fechaContexto = document.getElementById("inicioTareasFecha");

    if (!contenedor) return;

    if (estado !== "ready") {
        contenedor.innerHTML = `
            <p class="inicio-empty ${estado === "error" ? "inicio-empty-error" : ""}">
                ${estado === "loading" ? "Cargando tareas..." : "No se pudieron cargar las tareas."}
            </p>
        `;
        if (btn) btn.hidden = true;
        if (contexto) contexto.hidden = true;
        return;
    }

    if (btn) btn.hidden = false;

    if (inicioFechaSeleccionada) {
        const tareasDia = ordenarTareasInicio(
            (inicioDatosCrm.tareasMes || []).filter(
                tarea => String(tarea.fecha || "").slice(0, 10) === inicioFechaSeleccionada
            )
        );

        if (contexto) contexto.hidden = false;
        if (fechaContexto) {
            fechaContexto.textContent = formatearFechaLarga(inicioFechaSeleccionada);
        }

        contenedor.innerHTML = tareasDia.length
            ? tareasDia.map(renderTareaItem).join("")
            : `<p class="inicio-empty">No hay tareas para esta fecha.</p>`;
        return;
    }

    if (contexto) contexto.hidden = true;

    const grupos = tareasPorGrupo(tareas);

    if (!grupos.todas.length) {
        contenedor.innerHTML = `<p class="inicio-empty">No hay tareas pendientes.</p>`;
        return;
    }

    const limitePorGrupo = 3;
    const gruposVisibles = [
        ["Vencidas", grupos.vencidas.slice(0, limitePorGrupo)],
        ["Hoy", grupos.hoy.slice(0, limitePorGrupo)],
        ["Próximas", grupos.proximas.slice(0, limitePorGrupo)]
    ].filter(([, items]) => items.length);

    contenedor.innerHTML = gruposVisibles
        .map(([titulo, items]) => renderGrupoTareas(titulo, items))
        .join("");
}

function verResumenTareasInicio() {
    inicioFechaSeleccionada = "";
    renderCalendarioInicio();
    renderTareasInicio();
}

function tareasPorFecha() {
    return (inicioDatosCrm.tareasMes || []).reduce((grupo, tarea) => {
        const fecha = String(tarea.fecha || "").slice(0, 10);

        if (!fecha) return grupo;
        if (!grupo[fecha]) grupo[fecha] = [];
        grupo[fecha].push(tarea);

        return grupo;
    }, {});
}

function renderCalendarioInicio() {
    const contenedor = document.getElementById("inicioCalendario");
    const titulo = document.getElementById("inicioMesCalendario");

    if (!contenedor) return;
    if (titulo) titulo.textContent = textoMes(inicioMesActivo);

    const year = inicioMesActivo.getFullYear();
    const month = inicioMesActivo.getMonth();
    const primerDia = new Date(year, month, 1);
    const offset = (primerDia.getDay() + 6) % 7;
    const inicioGrilla = new Date(year, month, 1 - offset);
    const tareasFecha = tareasPorFecha();
    const hoy = fechaIsoLocal();
    const diasSemana = ["L", "M", "M", "J", "V", "S", "D"];

    let html = diasSemana.map(dia => `<span class="cal-dia-head">${dia}</span>`).join("");

    for (let index = 0; index < 42; index++) {
        const fecha = new Date(
            inicioGrilla.getFullYear(),
            inicioGrilla.getMonth(),
            inicioGrilla.getDate() + index
        );
        const iso = fechaIsoLocal(fecha);
        const tareas = tareasFecha[iso] || [];
        const etapas = [...new Set(
            tareas.map(tarea => tarea.etapa_pipeline || "sin-cotizacion")
        )];
        const fueraMes = fecha.getMonth() !== month;
        const vencidas = tareas.some(tarea => esFechaVencida(tarea.fecha, tarea.estado));
        const clases = [
            "cal-dia",
            iso === hoy ? "cal-hoy" : "",
            iso === inicioFechaSeleccionada ? "cal-seleccionado" : "",
            fueraMes ? "cal-dia-fuera" : "",
            vencidas ? "cal-con-vencidas" : ""
        ].filter(Boolean).join(" ");

        html += `
            <button
                type="button"
                class="${clases}"
                onclick="seleccionarDiaInicio('${iso}')"
                aria-label="${formatearFechaLarga(iso)}${tareas.length ? `, ${tareas.length} tareas` : ""}"
                aria-pressed="${iso === inicioFechaSeleccionada}"
            >
                <span>${fecha.getDate()}</span>
                ${tareas.length ? `<b class="cal-contador">${tareas.length}</b>` : ""}
                <div class="cal-marcas">
                    ${etapas.slice(0, 3).map(etapa => `
                        <i class="${etapaClase(etapa)}" title="${etapa || "Sin cotización"}"></i>
                    `).join("")}
                    ${vencidas ? `<i class="cal-marca-vencida" title="Tareas vencidas"></i>` : ""}
                </div>
            </button>
        `;
    }

    contenedor.innerHTML = html;
}

async function seleccionarDiaInicio(fecha) {
    const mesSeleccionado = String(fecha).slice(0, 7);

    inicioFechaSeleccionada = fecha;

    if (mesSeleccionado !== mesIso(inicioMesActivo)) {
        const [year, month] = mesSeleccionado.split("-").map(Number);
        inicioMesActivo = new Date(year, month - 1, 1);
        await cargarTareasMesInicio();
        return;
    }

    renderCalendarioInicio();
    renderTareasInicio();
}

async function cambiarMesInicio(delta) {
    inicioMesActivo = new Date(
        inicioMesActivo.getFullYear(),
        inicioMesActivo.getMonth() + delta,
        1
    );

    inicioFechaSeleccionada = "";
    renderTareasInicio();
    await cargarTareasMesInicio();
}

async function irHoyInicio() {
    const hoy = new Date();

    inicioMesActivo = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    inicioFechaSeleccionada = fechaIsoLocal(hoy);
    await cargarTareasMesInicio();
}

async function cargarTareasMesInicio() {
    renderCalendarioInicio();
    if (inicioFechaSeleccionada) renderTareasInicio([], "loading");

    try {
        const res = await fetch(`/tareas?mes=${mesIso(inicioMesActivo)}`, {
            headers: authHeaders()
        });

        if (await manejarError(res)) return;
        if (!res.ok) {
            if (inicioFechaSeleccionada) renderTareasInicio([], "error");
            mostrarEstadoInicio("error", "No se pudieron cargar las tareas del mes seleccionado.");
            return;
        }

        inicioDatosCrm.tareasMes = await res.json();
        renderCalendarioInicio();
        renderTareasInicio();
        mostrarEstadoInicio();
    } catch (error) {
        renderCalendarioInicio();
        if (inicioFechaSeleccionada) renderTareasInicio([], "error");
        mostrarEstadoInicio("error", "No se pudieron cargar las tareas del mes seleccionado.");
        mostrarToast("No se pudieron cargar las tareas", "error");
    }
}

function llenarSelectCotizacionesTarea(valor = "") {
    const select = document.getElementById("tareaCotizacion");

    if (!select) return;

    const cotizaciones = todasLasCotizacionesPipeline();
    select.innerHTML = `
        <option value="">Sin cotización</option>
        ${cotizaciones.map(cotizacion => `
            <option value="${cotizacion.id}" ${String(valor) === String(cotizacion.id) ? "selected" : ""}>
                #${formatearCotizacionId(cotizacion.id)} · ${cotizacion.nombre || "Sin nombre"}
            </option>
        `).join("")}
    `;
}

function actualizarBloqueoModalesInicio() {
    const modalTareaAbierto = !document.getElementById("inicioTareaModal")?.hidden;
    const modalTodasAbierto = !document.getElementById("todasTareasModal")?.hidden;

    document.body.classList.toggle(
        "inicio-modal-abierto",
        modalTareaAbierto || modalTodasAbierto
    );
}

function abrirFormularioTarea(tarea = null, fechaInicial = inicioFechaSeleccionada) {
    const form = document.getElementById("inicioFormularioTarea");
    const modal = document.getElementById("inicioTareaModal");
    const titulo = document.getElementById("inicioTareaModalTitulo");

    if (!form || !modal) return;

    modal.hidden = false;
    form.hidden = false;
    actualizarBloqueoModalesInicio();
    if (titulo) titulo.textContent = tarea ? "Editar tarea" : "Nueva tarea";
    setValorCampo("tareaId", tarea?.id || "");
    setValorCampo("tareaEstado", tarea?.estado || "pendiente");
    setValorCampo("tareaTitulo", tarea?.titulo || "");
    setValorCampo("tareaDescripcion", tarea?.descripcion || "");
    setValorCampo(
        "tareaFecha",
        tarea?.fecha
            ? String(tarea.fecha).slice(0, 10)
            : fechaInicial || fechaIsoLocal()
    );
    setValorCampo("tareaHora", tarea?.hora ? String(tarea.hora).slice(0, 5) : "");
    setValorCampo("tareaTipo", tarea?.tipo || "tarea");
    llenarSelectCotizacionesTarea(tarea?.cotizacion_id || "");

    requestAnimationFrame(() => document.getElementById("tareaTitulo")?.focus());
}

function cerrarFormularioTarea() {
    const form = document.getElementById("inicioFormularioTarea");
    const modal = document.getElementById("inicioTareaModal");

    if (form) form.hidden = true;
    if (modal) modal.hidden = true;
    actualizarBloqueoModalesInicio();
}

function buscarTareaInicio(id) {
    return [
        ...(inicioDatosCrm.tareas || []),
        ...(inicioDatosCrm.tareasMes || []),
        ...tareasModalActuales
    ].find(item => String(item.id) === String(id));
}

function editarTareaInicio(id) {
    const tarea = buscarTareaInicio(id);

    if (!tarea) return;

    abrirFormularioTarea(tarea);
}

function actualizarTabsModalTareas() {
    document.querySelectorAll("[data-estado-tareas]").forEach(boton => {
        const activo = boton.dataset.estadoTareas === estadoModalTareas;

        boton.classList.toggle("activo", activo);
        boton.setAttribute("aria-selected", String(activo));
    });
}

function parametrosModalTareas() {
    const params = new URLSearchParams({ estado: estadoModalTareas });
    const filtros = [
        ["fecha_desde", "filtroTareasDesde"],
        ["fecha_hasta", "filtroTareasHasta"],
        ["tipo", "filtroTareasTipo"],
        ["cliente", "filtroTareasCliente"],
        ["cotizacion_id", "filtroTareasCotizacion"],
        ["etapa_pipeline", "filtroTareasEtapa"]
    ];

    filtros.forEach(([parametro, id]) => {
        const valor = document.getElementById(id)?.value.trim();
        if (valor) params.set(parametro, valor);
    });

    if (esAdmin()) {
        const responsable = document.getElementById("filtroTareasResponsable")?.value.trim();
        if (responsable) params.set("responsable", responsable);
    }

    return params;
}

async function cargarModalTodasTareas() {
    const contenedor = document.getElementById("todasTareasResultados");

    if (!contenedor) return;

    contenedor.innerHTML = `<p class="inicio-empty">Cargando tareas...</p>`;

    try {
        const res = await fetch(`/tareas?${parametrosModalTareas().toString()}`, {
            headers: authHeaders()
        });

        if (await manejarError(res)) return;
        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            contenedor.innerHTML = `
                <p class="inicio-empty inicio-empty-error">
                    ${error.error || "No se pudieron cargar las tareas."}
                </p>
            `;
            return;
        }

        tareasModalActuales = ordenarTareasInicio(await res.json());
        contenedor.innerHTML = tareasModalActuales.length
            ? tareasModalActuales.map(renderTareaItem).join("")
            : `<p class="inicio-empty">No hay tareas para los filtros seleccionados.</p>`;
    } catch (error) {
        contenedor.innerHTML = `
            <p class="inicio-empty inicio-empty-error">
                No se pudieron cargar las tareas.
            </p>
        `;
    }
}

async function abrirModalTodasTareas() {
    const modal = document.getElementById("todasTareasModal");
    const responsable = document.getElementById("filtroTareasResponsableGrupo");

    if (!modal) return;

    botonOrigenModalTareas = document.activeElement;
    estadoModalTareas = "pendiente";
    modal.hidden = false;
    if (responsable) responsable.hidden = !esAdmin();
    actualizarTabsModalTareas();
    actualizarBloqueoModalesInicio();
    await cargarModalTodasTareas();
    modal.querySelector("[data-estado-tareas='pendiente']")?.focus();
}

function cerrarModalTodasTareas() {
    const modal = document.getElementById("todasTareasModal");

    if (modal) modal.hidden = true;
    tareasModalActuales = [];
    actualizarBloqueoModalesInicio();
    botonOrigenModalTareas?.focus?.();
    botonOrigenModalTareas = null;
}

async function cambiarEstadoModalTareas(estado) {
    if (!["pendiente", "realizada", "cancelada"].includes(estado)) return;

    estadoModalTareas = estado;
    actualizarTabsModalTareas();
    await cargarModalTodasTareas();
}

async function limpiarFiltrosTodasTareas() {
    [
        "filtroTareasDesde",
        "filtroTareasHasta",
        "filtroTareasTipo",
        "filtroTareasCliente",
        "filtroTareasCotizacion",
        "filtroTareasEtapa",
        "filtroTareasResponsable"
    ].forEach(id => setValorCampo(id));

    await cargarModalTodasTareas();
}

async function actualizarInicioCoordinado() {
    await cargarInicioCrm(true);

    if (!document.getElementById("todasTareasModal")?.hidden) {
        await cargarModalTodasTareas();
    }
}

async function guardarTareaInicio() {
    const id = document.getElementById("tareaId")?.value || "";
    const cotizacionId = document.getElementById("tareaCotizacion")?.value || "";
    const payload = {
        titulo: document.getElementById("tareaTitulo")?.value || "",
        descripcion: document.getElementById("tareaDescripcion")?.value || "",
        fecha: document.getElementById("tareaFecha")?.value || "",
        hora: document.getElementById("tareaHora")?.value || "",
        tipo: document.getElementById("tareaTipo")?.value || "tarea",
        estado: document.getElementById("tareaEstado")?.value || "pendiente",
        cotizacion_id: cotizacionId || null
    };

    mostrarLoader();

    try {
        const res = await fetch(id ? `/tareas/${id}` : "/tareas", {
            method: id ? "PUT" : "POST",
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });

        if (await manejarError(res)) return;

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            mostrarToast(error.error || "No se pudo guardar la tarea", "error");
            return;
        }

        cerrarFormularioTarea();
        await actualizarInicioCoordinado();
    } catch (error) {
        mostrarToast("No se pudo guardar la tarea", "error");
    } finally {
        ocultarLoader();
    }
}

async function marcarTareaRealizada(id) {
    await cambiarEstadoTareaInicio(id, "realizada");
}

async function cancelarTareaInicio(id) {
    await cambiarEstadoTareaInicio(id, "cancelar");
}

async function cambiarEstadoTareaInicio(id, accion) {
    mostrarLoader();

    try {
        const res = await fetch(`/tareas/${id}/${accion}`, {
            method: "PUT",
            headers: authHeaders()
        });

        if (await manejarError(res)) return;

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            mostrarToast(error.error || "No se pudo actualizar la tarea", "error");
            return;
        }

        await actualizarInicioCoordinado();
    } catch (error) {
        mostrarToast("No se pudo actualizar la tarea", "error");
    } finally {
        ocultarLoader();
    }
}

async function cargarInicioCrm(silencioso = false) {
    const inicio = document.getElementById("inicio");

    if (!inicio) return;

    if (!inicioCargaCompleta) {
        prepararInicioCrm();
    } else if (!silencioso) {
        mostrarEstadoInicio("loading", "Actualizando información comercial...");
    }

    try {
        const [resumenRes, pendientesRes, mesRes] = await Promise.all([
            fetch("/inicio/resumen", { headers: authHeaders() }),
            fetch("/tareas?estado=pendiente", { headers: authHeaders() }),
            fetch(`/tareas?mes=${mesIso(inicioMesActivo)}`, {
                headers: authHeaders()
            })
        ]);

        for (const respuesta of [resumenRes, pendientesRes, mesRes]) {
            if (await manejarError(respuesta)) return;
        }

        if (!resumenRes.ok || !pendientesRes.ok || !mesRes.ok) {
            mostrarErrorInicio("El Inicio no pudo cargar sus datos. La estructura permanece disponible para revisión.");
            mostrarToast("No se pudo cargar el inicio", "error");
            return;
        }

        const [data, tareasPendientes, tareasMes] = await Promise.all([
            resumenRes.json(),
            pendientesRes.json(),
            mesRes.json()
        ]);

        inicioDatosCrm = {
            pipeline: data.pipeline || [],
            tareas: tareasPendientes || [],
            tareasMes: tareasMes || []
        };
        inicioCargaCompleta = true;

        actualizarStatsInicio(data.estadisticas || {});
        renderPipelineInicio(inicioDatosCrm.pipeline);
        llenarSelectCotizacionesTarea();
        renderCalendarioInicio();
        renderTareasInicio();
        mostrarEstadoInicio();
    } catch (error) {
        mostrarErrorInicio("El Inicio no pudo cargar sus datos. La estructura permanece disponible para revisión.");
        mostrarToast("No se pudo cargar el inicio", "error");
    }
}

async function buscarAnterior() {
    const busquedaId = ++busquedaCotizacionActual;
    const termino = document.getElementById("dni").value.trim();

    limpiarResultadosBusqueda();
    limpiarFormularioCotizacion();

    if (!termino) {
        ocultarLoader();
        mostrarToast("Ingresá un DNI o teléfono", "error");
        return;
    }
    mostrarLoader();
    const res = await fetch(`/buscar/${encodeURIComponent(termino)}`, {
        headers: authHeaders()
    });

    if (busquedaId !== busquedaCotizacionActual) return;

    if (await manejarError(res)) {
        ocultarLoader();
        return;
    }

    const data = await res.json();

    if (busquedaId !== busquedaCotizacionActual) return;

    ocultarLoader();

    const div = document.getElementById("resultados");
    div.innerHTML = "";

    if (data.length === 0) {
        div.innerHTML = "<p>No hay cotizaciones</p>";
        return;
    }

    document.getElementById("nombre").value = data[0].nombre || "";
    document.getElementById("celular").value = data[0].celular || "";
    const dniCotizacion = document.getElementById("dniCotizacion");
    if (dniCotizacion) {
        dniCotizacion.value = data[0].dni || "";
    }

    div.innerHTML = data.map(c => renderTarjetaCotizacion(c)).join("");

}

async function buscar() {
    const busquedaId = ++busquedaCotizacionActual;
    const termino = document.getElementById("dni").value.trim();
    const token = localStorage.getItem("token");

    limpiarResultadosBusqueda();
    limpiarFormularioCotizacion();

    if (!termino) {
        mostrarToast("IngresÃ¡ un DNI o telÃ©fono", "error");
        return;
    }

    mostrarLoader();

    try {
        console.log("[buscar frontend]", {
            termino,
            terminoNormalizado: normalizarTelefono(termino),
            tokenExiste: Boolean(token),
            endpoint: `/buscar/${encodeURIComponent(termino)}`
        });

        if (!token) {
            mostrarToast("Sesión expirada o no autorizada", "error");
            logout();
            return;
        }

        const res = await fetch(`/buscar/${encodeURIComponent(termino)}`, {
            headers: authOnlyHeaders()
        });

        console.log("[buscar frontend respuesta]", {
            termino,
            status: res.status,
            ok: res.ok
        });

        if (busquedaId !== busquedaCotizacionActual) return;

        if (await manejarError(res)) return;

        const data = await res.json();

        if (busquedaId !== busquedaCotizacionActual) return;

        console.log("[buscar frontend datos]", {
            termino,
            cantidadAntesDeRenderizar: Array.isArray(data) ? data.length : null,
            primeros: Array.isArray(data)
                ? data.slice(0, 5).map(c => ({
                    id: c.id,
                    dni: c.dni,
                    celular: c.celular
                }))
                : data
        });

        const div = obtenerContenedorResultadosBusqueda();

        if (!div) return;

        div.innerHTML = "";

        if (data.length === 0) {
            div.innerHTML = "<p>No hay cotizaciones</p>";
            console.log("[buscar frontend render]", {
                termino,
                cantidadRenderizada: 0,
                idsRenderizados: []
            });
            return;
        }

        completarFormularioCotizacion(data[0], termino);

        div.innerHTML = data.map(c => renderTarjetaCotizacion(c)).join("");

        console.log("[buscar frontend render]", {
            termino,
            cantidadRenderizada: div.querySelectorAll(".card").length,
            idsRenderizados: data.map(c => c.id)
        });

    } catch (error) {
        if (busquedaId === busquedaCotizacionActual) {
            limpiarResultadosBusqueda();
            mostrarToast("No se pudo realizar la bÃºsqueda", "error");
        }
    } finally {
        ocultarLoader();
    }
}

async function subirArchivoAnterior(event, cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

    const input = event.target;
    const files = [...event.target.files];

    if (files.length === 0) return;

    const extensionesPermitidas = /\.(jpe?g|png|webp)$/i;
    const cantidadActual = await obtenerCantidadArchivos(cotizacionId);

    if (cantidadActual + files.length > 5) {
        mostrarToast("Podés adjuntar hasta 5 imágenes por cotización", "error");
        input.value = "";
        return;
    }

    for (const file of files) {
        const tipoCompatible =
            ["image/jpeg", "image/png", "image/webp"].includes(file.type);

        if (!tipoCompatible || !extensionesPermitidas.test(file.name)) {
            mostrarToast(
                "Seleccioná imágenes JPG, JPEG, PNG o WEBP",
                "error"
            );
            input.value = "";
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            mostrarToast("Cada imagen puede pesar hasta 5 MB", "error");
            input.value = "";
            return;
        }
    }

    const token = localStorage.getItem("token");
    let subidas = 0;

    for (const file of files) {
        const formData = new FormData();
        formData.append("archivo", file);

        const res = await fetch(`/subir-archivo/${cotizacionId}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`
            },
            body: formData
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            mostrarToast(error.error || "Error al subir la imagen", "error");
            input.value = "";
            cargarArchivos(cotizacionId, contenedorId);
            return;
        }

        subidas++;
    }

    mostrarToast(
        subidas === 1 ? "Imagen adjuntada" : "Imágenes adjuntadas",
        "success"
    );
    input.value = "";
    cargarArchivos(cotizacionId, contenedorId);
}

async function subirArchivo(event, cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

    const input = event.target;
    const files = [...event.target.files];

    if (files.length === 0) return;

    const extensionesPermitidas = /\.(jpe?g|png|webp)$/i;
    const cantidadActual = await obtenerCantidadArchivos(cotizacionId);

    if (cantidadActual + files.length > 5) {
        mostrarToast("PodÃ©s adjuntar hasta 5 imÃ¡genes por cotizaciÃ³n", "error");
        input.value = "";
        return;
    }

    for (const file of files) {
        const tipoCompatible =
            ["image/jpeg", "image/png", "image/webp"].includes(file.type);

        if (!tipoCompatible || !extensionesPermitidas.test(file.name)) {
            mostrarToast(
                "SeleccionÃ¡ imÃ¡genes JPG, JPEG, PNG o WEBP",
                "error"
            );
            input.value = "";
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            mostrarToast("Cada imagen puede pesar hasta 5 MB", "error");
            input.value = "";
            return;
        }
    }

    mostrarLoader();

    try {
        const token = localStorage.getItem("token");
        let subidas = 0;

        for (const file of files) {
            const formData = new FormData();
            formData.append("archivo", file);

            const res = await fetch(`/subir-archivo/${cotizacionId}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                mostrarToast(error.error || "Error al subir la imagen", "error");
                input.value = "";
                cargarArchivos(cotizacionId, contenedorId);
                return;
            }

            subidas++;
        }

        mostrarToast(
            subidas === 1 ? "Imagen adjuntada" : "ImÃ¡genes adjuntadas",
            "success"
        );
        input.value = "";
        cargarArchivos(cotizacionId, contenedorId);
    } catch (error) {
        mostrarToast("No se pudo subir la imagen", "error");
    } finally {
        ocultarLoader();
    }
}

async function obtenerCantidadArchivos(cotizacionId) {
    const res = await fetch(`/archivos/${cotizacionId}`, {
        headers: authHeaders()
    });

    if (!res.ok) return 0;

    const archivos = await res.json();

    return archivos.length;
}
function escaparHtml(texto) {
    const elemento = document.createElement("div");
    elemento.textContent = texto || "";
    return elemento.innerHTML;
}

async function cargarArchivosAnterior(cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

    const res = await fetch(`/archivos/${cotizacionId}`, {
        headers: authHeaders()
    });

    const div = document.getElementById(contenedorId);

    if (!div) return;

    if (!res.ok) {
        div.innerHTML = "<p>No se pudieron cargar los adjuntos.</p>";
        return;
    }

    const archivos = await res.json();

    div.innerHTML = "";

    if (archivos.length === 0) {
        div.innerHTML = '<p class="sin-adjuntos">Sin imágenes adjuntas.</p>';
        return;
    }

    archivos.forEach(a => {
        const ruta = `/archivos/${a.id}/descargar`;

        div.innerHTML += `
            <div class="adjunto-item">
                <a
                    class="adjunto-imagen"
                    href="${ruta}"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir ${escaparHtml(a.nombre)}"
                >
                    <img
                        src="${ruta}"
                        alt="${escaparHtml(a.nombre)}"
                        loading="lazy"
                    >
                    <span>${escaparHtml(a.nombre)}</span>
                </a>
                <button
                    type="button"
                    class="adjunto-eliminar"
                    onclick="eliminarArchivo(${a.id}, ${cotizacionId}, '${contenedorId}')"
                    aria-label="Eliminar ${escaparHtml(a.nombre)}"
                    title="Eliminar imagen"
                >
                    Eliminar
                </button>
            </div>
        `;
    });
}

async function cargarArchivos(cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

    const div = document.getElementById(contenedorId);

    if (!div) return;

    mostrarLoader();

    try {
        const res = await fetch(`/archivos/${cotizacionId}`, {
            headers: authHeaders()
        });

        if (!res.ok) {
            div.innerHTML = "<p>No se pudieron cargar los adjuntos.</p>";
            return;
        }

        const archivos = await res.json();

        div.innerHTML = "";

        if (archivos.length === 0) {
            div.innerHTML = '<p class="sin-adjuntos">Sin imÃ¡genes adjuntas.</p>';
            return;
        }

        div.innerHTML = archivos.map(a => {
            const ruta = `/archivos/${a.id}/descargar`;

            return `
                <div class="adjunto-item">
                    <a
                        class="adjunto-imagen"
                        href="${ruta}"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir ${escaparHtml(a.nombre)}"
                    >
                        <img
                            src="${ruta}"
                            alt="${escaparHtml(a.nombre)}"
                            loading="lazy"
                        >
                        <span>${escaparHtml(a.nombre)}</span>
                    </a>
                    <button
                        type="button"
                        class="adjunto-eliminar"
                        onclick="eliminarArchivo(${a.id}, ${cotizacionId}, '${contenedorId}')"
                        aria-label="Eliminar ${escaparHtml(a.nombre)}"
                        title="Eliminar imagen"
                    >
                        Eliminar
                    </button>
                </div>
            `;
        }).join("");
    } catch (error) {
        div.innerHTML = "<p>No se pudieron cargar los adjuntos.</p>";
    } finally {
        ocultarLoader();
    }
}

let resolverModalConfirmacion = null;

function mostrarModalConfirmacion({
    titulo,
    texto,
    accion
}) {
    const modal = document.getElementById("modalEliminarAdjunto");
    const tituloEl = document.getElementById("modalConfirmacionTitulo");
    const textoEl = document.getElementById("modalConfirmacionTexto");
    const accionEl = document.getElementById("modalConfirmacionAccion");

    tituloEl.textContent = titulo;
    textoEl.textContent = texto;
    accionEl.textContent = accion;
    modal.style.display = "flex";

    return new Promise(resolve => {
        resolverModalConfirmacion = resolve;
    });
}

function cerrarModalConfirmacion(resultado) {
    document.getElementById("modalEliminarAdjunto").style.display = "none";

    if (resolverModalConfirmacion) {
        resolverModalConfirmacion(resultado);
        resolverModalConfirmacion = null;
    }
}

function cancelarModalConfirmacion() {
    cerrarModalConfirmacion(false);
}

function confirmarModalConfirmacion() {
    cerrarModalConfirmacion(true);
}

async function eliminarArchivo(archivoId, cotizacionId, contenedorId = `archivos-${cotizacionId}`) {
    const confirmado = await mostrarModalConfirmacion({
        titulo: "¿Eliminar imagen adjunta?",
        texto: "Esta acción no se puede deshacer.",
        accion: "Eliminar"
    });

    if (!confirmado) return;

    const res = await fetch(`/archivos/${archivoId}`, {
        method: "DELETE",
        headers: authHeaders()
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "No se pudo eliminar la imagen", "error");
        return;
    }

    mostrarToast("Imagen eliminada", "success");
    cargarArchivos(cotizacionId, contenedorId);
}

async function cargarComentarios(cotizacionId, contenedorId = `comentarios-${cotizacionId}`) {

    const res = await fetch(`/comentarios/${cotizacionId}`, {
        headers: authHeaders()
    });

    const comentarios = await res.json();

    const div =
        document.getElementById(contenedorId);

    if (!div) return;

    div.innerHTML = "";

    comentarios.forEach(c => {

        div.innerHTML += `
            <div class="comentario-item">

                <b>${escaparHtml(c.usuario || "Usuario no identificado")}</b>

                <small>
                    ${formatearFecha(c.fecha)}
                </small>

                <p>${escaparHtml(c.comentario)}</p>

                ${(esAdmin() || c.usuario === obtenerPayload().usuario) ? `
                    <button
                        type="button"
                        class="comentario-eliminar"
                        onclick="eliminarComentario(${c.id}, ${cotizacionId}, '${contenedorId}')"
                    >
                        Eliminar
                    </button>
                ` : ""}

            </div>
        `;
    });
}

async function eliminarComentario(comentarioId, cotizacionId, contenedorId) {
    const confirmado = await mostrarModalConfirmacion({
        titulo: "¿Eliminar comentario?",
        texto: "Esta acción no se puede deshacer.",
        accion: "Eliminar"
    });

    if (!confirmado) return;

    const res = await fetch(`/comentarios/${comentarioId}`, {
        method: "DELETE",
        headers: authHeaders()
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "No se pudo eliminar el comentario", "error");
        return;
    }

    await cargarComentarios(cotizacionId, contenedorId);
    mostrarToast("Comentario eliminado", "success");
}

async function agregarComentario(
    cotizacionId,
    textareaId = `nuevoComentario-${cotizacionId}`,
    contenedorId = `comentarios-${cotizacionId}`
) {

    const textarea =
        document.getElementById(
            textareaId
        );

    const comentario = textarea.value;

    if (!comentario) return;
    mostrarLoader();
    const res = await fetch(`/comentarios/${cotizacionId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ comentario })
    });
    ocultarLoader();
    if (res.ok) {

        textarea.value = "";

        cargarComentarios(cotizacionId, contenedorId);

        mostrarToast(
            "Comentario agregado",
            "success"
        );
    }
}


async function descargarPDFAnterior(id, numeroOpcion = 1) {

    const card = document.getElementById(`card-${id}`);

    if (!card) {
        mostrarToast("No se encontró la cotización", "error");
        return;
    }

    // ocultar elementos
    const ocultos = card.querySelectorAll(".no-pdf");
    // mostrar elementos solo PDF
    const soloPdf = card.querySelectorAll(".solo-pdf");
    const opcionesPdf = card.querySelectorAll(".pdf-opcion");

    soloPdf.forEach(el => {
        el.style.display = "block";
    });

    opcionesPdf.forEach(el => {
        el.dataset.display = el.style.display;
        el.style.display = Number(el.dataset.pdfOpcion) === Number(numeroOpcion)
            ? "block"
            : "none";
    });

    ocultos.forEach(el => {
        el.dataset.display = el.style.display;
        el.style.display = "none";
    });

    // activar modo PDF
    card.id = "card-pdf-mode";

    mostrarToast("Generando PDF...", "success");
    card.style.opacity = "1";

    mostrarLoader();
    const canvas = await html2canvas(card, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
    });
    ocultarLoader();

    const imgData = canvas.toDataURL("image/png");

    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF("p", "mm", "a4");

    const pdfWidth = pdf.internal.pageSize.getWidth();

    const imgProps = pdf.getImageProperties(imgData);

    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(
        imgData,
        "PNG",
        0,
        0,
        pdfWidth,
        pdfHeight
    );

    pdf.save(`cotizacion-${id}-opcion-${numeroOpcion}.pdf`);

    // restaurar card
    card.id = `card-${id}`;

    ocultos.forEach(el => {
        el.style.display = el.dataset.display || "";
    });
    soloPdf.forEach(el => {
        el.style.display = "none";
    });
    opcionesPdf.forEach(el => {
        el.style.display = el.dataset.display || "";
    });
    card.style.opacity = "";


}

function cerrarMenusDescargaPdf(excepto = null, devolverFoco = false) {
    document.querySelectorAll("[data-pdf-download-menu]").forEach(contenedor => {
        if (contenedor === excepto) return;

        const boton = contenedor.querySelector("[aria-haspopup='menu']");
        const menu = contenedor.querySelector("[role='menu']");

        if (!boton || !menu) return;

        const estabaAbierto = !menu.hidden;
        menu.hidden = true;
        boton.setAttribute("aria-expanded", "false");
        contenedor.classList.remove("pdf-menu-arriba");
        contenedor.closest(".card")?.classList.remove("pdf-menu-abierto");

        if (devolverFoco && estabaAbierto) boton.focus();
    });
}

function posicionarMenuDescargaPdf(contenedor, boton, menu) {
    contenedor.classList.remove("pdf-menu-arriba");

    const botonRect = boton.getBoundingClientRect();
    const altoMenu = menu.getBoundingClientRect().height;
    const margenViewport = 12;
    const espacioAbajo = window.innerHeight - botonRect.bottom - margenViewport;
    const espacioArriba = botonRect.top - margenViewport;

    if (altoMenu > espacioAbajo && espacioArriba > espacioAbajo) {
        contenedor.classList.add("pdf-menu-arriba");
    }
}

function toggleMenuDescargaPdf(event, boton) {
    event.preventDefault();
    event.stopPropagation();

    const contenedor = boton.closest("[data-pdf-download-menu]");
    const menu = contenedor?.querySelector("[role='menu']");

    if (!contenedor || !menu) return;

    const abrir = menu.hidden;
    cerrarMenusDescargaPdf(contenedor);
    boton.setAttribute("aria-expanded", String(abrir));

    if (abrir) {
        menu.hidden = false;
        contenedor.closest(".card")?.classList.add("pdf-menu-abierto");
        posicionarMenuDescargaPdf(contenedor, boton, menu);
        menu.querySelector("[role='menuitem']")?.focus();
        return;
    }

    menu.hidden = true;
    contenedor.classList.remove("pdf-menu-arriba");
    contenedor.closest(".card")?.classList.remove("pdf-menu-abierto");
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        const modalFechaAlta = document.getElementById(
            "posventaFechaAltaModal"
        );

        if (modalFechaAlta && !modalFechaAlta.hidden) {
            event.preventDefault();
            event.stopImmediatePropagation();
            cerrarModalFechaAltaPosventa();
            return;
        }

        if (document.querySelector(".pdf-download-options:not([hidden])")) {
            event.preventDefault();
            cerrarMenusDescargaPdf(null, true);
            return;
        }

        if (!hayModalSecundarioAbierto() && modalCotizacionAbierto()) {
            event.preventDefault();
            cerrarDetalleCotizacion();
            return;
        }
    }

    mantenerFocoModalCotizacion(event);
});

async function seleccionarDescargaPdf(event, id, modo, cardId) {
    event.preventDefault();
    event.stopPropagation();
    cerrarMenusDescargaPdf(null, true);
    await descargarPDF(id, modo, cardId);
}

function normalizarModoPdf(modo) {
    if (modo === 1 || modo === "1") return "opcion-1";
    if (modo === 2 || modo === "2") return "opcion-2";

    return ["completo", "opcion-1", "opcion-2"].includes(modo)
        ? modo
        : "opcion-1";
}

function crearPaginaPdf(contenedor, documento, continuacion = false) {
    const pagina = document.createElement("section");
    pagina.className = "pdf-page";

    if (continuacion) {
        const encabezado = document.createElement("div");
        encabezado.className = "pdf-continuacion";
        encabezado.innerHTML = `
            <strong>ASIS Gesti&oacute;n Comercial</strong>
            <span>
                Cotizaci&oacute;n N&deg; ${documento.dataset.pdfCotizacion || ""}
                &middot; Continuaci&oacute;n
            </span>
        `;
        pagina.appendChild(encabezado);
    } else {
        const encabezado = documento.querySelector(".pdf-header");
        if (encabezado) pagina.appendChild(encabezado.cloneNode(true));
    }

    const contenido = document.createElement("div");
    contenido.className = "pdf-page-content";
    pagina.appendChild(contenido);
    contenedor.appendChild(pagina);

    return { elemento: pagina, contenido };
}

function agregarBloquePdf(pagina, bloque) {
    pagina.contenido.appendChild(bloque);

    if (pagina.elemento.scrollHeight <= pagina.elemento.clientHeight + 1) {
        return true;
    }

    bloque.remove();
    return false;
}

function agregarBloquePdfConAjuste(pagina, bloque) {
    if (agregarBloquePdf(pagina, bloque)) {
        return true;
    }

    pagina.elemento.classList.add("pdf-page-compacta");

    if (agregarBloquePdf(pagina, bloque)) {
        return true;
    }

    pagina.elemento.classList.remove("pdf-page-compacta");
    return false;
}

function validarPaginaPdf(pagina) {
    if (pagina.elemento.scrollHeight <= pagina.elemento.clientHeight + 1) {
        return;
    }

    pagina.elemento.classList.add("pdf-page-compacta");

    if (pagina.elemento.scrollHeight > pagina.elemento.clientHeight + 1) {
        throw new Error("El contenido de una opcion supera el espacio disponible en A4");
    }
}

function crearPaginasPdf(documento, modo, contenedor) {
    const opciones = [...documento.querySelectorAll(".pdf-opcion")];
    const seleccionadas = modo === "completo"
        ? opciones
        : opciones.filter(opcion =>
            opcion.dataset.pdfOpcion === modo.replace("opcion-", "")
        );

    if (!seleccionadas.length) {
        throw new Error("La opcion solicitada no existe");
    }

    const paginas = [];
    let pagina = crearPaginaPdf(contenedor, documento);
    paginas.push(pagina);

    const titulo = documento.querySelector(".pdf-titulo");
    if (titulo) pagina.contenido.appendChild(titulo.cloneNode(true));

    seleccionadas.forEach(opcion => {
        const bloque = opcion.cloneNode(true);

        if (!agregarBloquePdfConAjuste(pagina, bloque)) {
            pagina = crearPaginaPdf(contenedor, documento, true);
            paginas.push(pagina);
            pagina.contenido.appendChild(bloque);
            validarPaginaPdf(pagina);
        }
    });

    const cierre = documento.querySelector(".pdf-cierre")
        || documento.closest(".card")?.querySelector(".pdf-cierre");
    if (cierre) {
        const bloqueCierre = cierre.cloneNode(true);

        if (!agregarBloquePdfConAjuste(pagina, bloqueCierre)) {
            pagina = crearPaginaPdf(contenedor, documento, true);
            paginas.push(pagina);
            pagina.contenido.appendChild(bloqueCierre);
            validarPaginaPdf(pagina);
        }
    }

    paginas.forEach((item, index) => {
        const numero = document.createElement("span");
        numero.className = "pdf-page-number";
        numero.textContent = `${index + 1} / ${paginas.length}`;
        item.elemento.appendChild(numero);
        validarPaginaPdf(item);
    });

    return paginas.map(item => item.elemento);
}

async function esperarRecursosPdf(contenedor) {
    if (document.fonts?.ready) {
        await document.fonts.ready;
    }

    await Promise.all(
        [...contenedor.querySelectorAll("img")].map(imagen => {
            if (imagen.complete && imagen.naturalWidth > 0) {
                return Promise.resolve();
            }

            return new Promise((resolve, reject) => {
                imagen.addEventListener("load", resolve, { once: true });
                imagen.addEventListener(
                    "error",
                    () => reject(new Error("No se pudo cargar una imagen del PDF")),
                    { once: true }
                );
            });
        })
    );
}

function nombreArchivoPdf(id, modo) {
    if (modo === "completo") return `cotizacion-${id}-completa.pdf`;
    return `cotizacion-${id}-${modo}.pdf`;
}

async function descargarPDF(id, modo = "opcion-1", cardId = `card-${id}`) {
    const modoNormalizado = normalizarModoPdf(modo);
    const card = document.getElementById(cardId);
    const documento = card?.querySelector(".pdf-documento");
    let renderHost = null;
    let loaderActivo = false;

    if (!documento) {
        mostrarToast("No se encontro la cotizacion", "error");
        return;
    }

    try {
        mostrarToast("Generando PDF...", "success");
        mostrarLoader();
        loaderActivo = true;

        renderHost = document.createElement("div");
        renderHost.className = "pdf-render-host";
        document.body.appendChild(renderHost);

        const paginas = crearPaginasPdf(
            documento,
            modoNormalizado,
            renderHost
        );

        await esperarRecursosPdf(renderHost);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF("p", "mm", "a4");
        const ancho = pdf.internal.pageSize.getWidth();
        const alto = pdf.internal.pageSize.getHeight();

        for (let index = 0; index < paginas.length; index++) {
            const pagina = paginas[index];
            const canvas = await html2canvas(pagina, {
                scale: 2,
                backgroundColor: "#ffffff",
                useCORS: true,
                logging: false,
                width: pagina.offsetWidth,
                height: pagina.offsetHeight,
                windowWidth: pagina.offsetWidth,
                windowHeight: pagina.offsetHeight
            });

            if (index > 0) pdf.addPage("a4", "p");

            pdf.addImage(
                canvas.toDataURL("image/png"),
                "PNG",
                0,
                0,
                ancho,
                alto
            );
        }

        pdf.save(nombreArchivoPdf(id, modoNormalizado));
    } catch (error) {
        console.error("[PDF]", error);
        mostrarToast(
            error.message || "No se pudo generar el PDF",
            "error"
        );
    } finally {
        renderHost?.remove();
        if (loaderActivo) ocultarLoader();
    }
}
// =======================
// ➕ AGREGAR
// =======================

async function agregarAnterior() {
    const adjuntoInput = document.getElementById("adjuntoCotizacion");
    const adjuntos = adjuntoInput ? [...adjuntoInput.files] : [];
    const dniCotizacionValor = obtenerDniCotizacionValor();
    const celularValor = normalizarTelefono(
        document.getElementById("celular").value
    );
    const clienteId = document.getElementById("clienteIdCotizacion")?.value || "";
    const terminoBusqueda =
        document.getElementById("terminoBusquedaCotizacion")?.value || "";
    const formData = new FormData();

    formData.append("dni", dniCotizacionValor);
    formData.append("nombre", document.getElementById("nombre").value);
    formData.append("celular", celularValor);
    formData.append("opciones", JSON.stringify(obtenerOpcionesFormulario()));
    formData.append("plan", document.getElementById("plan").value);
    formData.append(
        "tipo_cobertura",
        document.getElementById("tipoCobertura").value
    );
    formData.append("valor", document.getElementById("valor").value);
    formData.append("modalidad", document.getElementById("modalidad").value);
    formData.append("vigencia", document.getElementById("vigencia").value);
    formData.append(
        "referido",
        document.getElementById("referido").checked ? "Si" : "No"
    );
    formData.append(
        "congelamiento",
        document.getElementById("congelamiento").value
    );
    formData.append(
        "bonificacion",
        document.getElementById("bonificacion").value || 0
    );
    formData.append(
        "bonificacion_aportes",
        document.getElementById("bonificacionAportes").value || 0
    );
    formData.append("comentarios", document.getElementById("comentarios").value);

    if (clienteId) {
        formData.append("cliente_id", clienteId);
    }

    if (terminoBusqueda) {
        formData.append("termino_busqueda", terminoBusqueda);
    }

    adjuntos.forEach(archivo => {
        formData.append("imagenes", archivo);
    });

    const res = await fetch("/agregar", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: formData
    });

    if (await manejarError(res)) return;

    if (res.ok) {
        mostrarToast("Guardado", "success");

        document.getElementById("nombre").value = "";
        document.getElementById("dniCotizacion").value = "";
        document.getElementById("celular").value = "";
        document.getElementById("plan").value = "";
        document.getElementById("plan2").value = "";
        document.getElementById("valor").value = "";
        document.getElementById("valor2").value = "";
        document.getElementById("comentarios").value = "";
        document.getElementById("tipoCobertura").selectedIndex = 0;
        document.getElementById("tipoCobertura2").selectedIndex = 0;
        document.getElementById("modalidad").selectedIndex = 0;
        document.getElementById("referido").checked = false;
        document.getElementById("congelamiento").value = "";
        document.getElementById("bonificacion").value = "";
        document.getElementById("bonificacion2").value = "";
        document.getElementById("bonificacionAportes").value = "";
        document.getElementById("bonificacionAportes2").value = "";
        document.getElementById("vigencia").value = "";
        ocultarOpcionPlan2();

        if (adjuntoInput) {
            adjuntoInput.value = "";
        }

        document.getElementById("dni").value = dniCotizacionValor || celularValor;
        previsualizarAdjuntosCotizacion();
        actualizarTotalCotizacion();

        buscar();
    } else {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "Error", "error");
    }
}

async function agregar() {
    const adjuntoInput = document.getElementById("adjuntoCotizacion");
    const adjuntos = adjuntoInput ? [...adjuntoInput.files] : [];
    const dniCotizacionValor = obtenerDniCotizacionValor();
    const celularValor = normalizarTelefono(
        document.getElementById("celular").value
    );
    const clienteId = document.getElementById("clienteIdCotizacion")?.value || "";
    const terminoBusqueda =
        document.getElementById("terminoBusquedaCotizacion")?.value || "";
    const formData = new FormData();

    formData.append("dni", dniCotizacionValor);
    formData.append("nombre", document.getElementById("nombre").value);
    formData.append("celular", celularValor);
    formData.append("opciones", JSON.stringify(obtenerOpcionesFormulario()));
    formData.append("plan", document.getElementById("plan").value);
    formData.append(
        "tipo_cobertura",
        document.getElementById("tipoCobertura").value
    );
    formData.append("valor", document.getElementById("valor").value);
    formData.append("modalidad", document.getElementById("modalidad").value);
    formData.append("vigencia", document.getElementById("vigencia").value);
    formData.append(
        "referido",
        document.getElementById("referido").checked ? "Si" : "No"
    );
    formData.append(
        "congelamiento",
        document.getElementById("congelamiento").value
    );
    formData.append(
        "bonificacion",
        document.getElementById("bonificacion").value || 0
    );
    formData.append(
        "bonificacion_aportes",
        document.getElementById("bonificacionAportes").value || 0
    );
    formData.append("comentarios", document.getElementById("comentarios").value);

    if (clienteId) {
        formData.append("cliente_id", clienteId);
    }

    if (terminoBusqueda) {
        formData.append("termino_busqueda", terminoBusqueda);
    }

    adjuntos.forEach(archivo => {
        formData.append("imagenes", archivo);
    });

    mostrarLoader();

    try {
        const endpoint = clienteId
            ? `/clientes/${encodeURIComponent(clienteId)}/cotizaciones`
            : "/agregar";
        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`
            },
            body: formData
        });

        if (await manejarError(res)) return;

        if (res.ok) {
            mostrarToast("Guardado", "success");

            document.getElementById("nombre").value = "";
            document.getElementById("dniCotizacion").value = "";
            document.getElementById("celular").value = "";
            document.getElementById("plan").value = "";
            document.getElementById("plan2").value = "";
            document.getElementById("valor").value = "";
            document.getElementById("valor2").value = "";
            document.getElementById("comentarios").value = "";
            document.getElementById("tipoCobertura").selectedIndex = 0;
            document.getElementById("tipoCobertura2").selectedIndex = 0;
            document.getElementById("modalidad").selectedIndex = 0;
            document.getElementById("referido").checked = false;
            document.getElementById("congelamiento").value = "";
            document.getElementById("bonificacion").value = "";
            document.getElementById("bonificacion2").value = "";
            document.getElementById("bonificacionAportes").value = "";
            document.getElementById("bonificacionAportes2").value = "";
            document.getElementById("vigencia").value = "";
            setValorCampo("clienteIdCotizacion");
            setValorCampo("terminoBusquedaCotizacion");
            ocultarOpcionPlan2();

            if (adjuntoInput) {
                adjuntoInput.value = "";
            }

            document.getElementById("dni").value = dniCotizacionValor || celularValor;
            previsualizarAdjuntosCotizacion();
            actualizarTotalCotizacion();

            if (document.getElementById("inicio")?.style.display !== "none") {
                buscarClienteInicio();
            } else {
                buscar();
            }
        } else {
            const error = await res.json().catch(() => ({}));
            mostrarToast(error.error || "Error", "error");
        }
    } catch (error) {
        mostrarToast("No se pudo guardar la cotizaciÃ³n", "error");
    } finally {
        ocultarLoader();
    }
}

function previsualizarAdjuntosCotizacion() {
    const input = document.getElementById("adjuntoCotizacion");
    const preview = document.getElementById("previewAdjuntosCotizacion");
    const files = input ? [...input.files] : [];

    if (!preview) return;

    if (files.length === 0) {
        preview.innerHTML = "<small>Sin archivos seleccionados</small>";
        return;
    }

    if (files.length > 5) {
        mostrarToast("Podés seleccionar hasta 5 imágenes", "error");
        input.value = "";
        preview.innerHTML = "<small>Sin archivos seleccionados</small>";
        return;
    }

    const extensionesPermitidas = /\.(jpe?g|png|webp)$/i;
    const invalidas = files.some(file =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !extensionesPermitidas.test(file.name) ||
        file.size > 5 * 1024 * 1024
    );

    if (invalidas) {
        mostrarToast("Seleccioná imágenes JPG, JPEG, PNG o WEBP de hasta 5 MB", "error");
        input.value = "";
        preview.innerHTML = "<small>Sin archivos seleccionados</small>";
        return;
    }

    preview.innerHTML = files.map(file => `
        <div class="adjunto-preview-item">
            <img src="${URL.createObjectURL(file)}" alt="">
            <span>${escaparHtml(file.name)}</span>
        </div>
    `).join("");
}

async function subirAdjuntosCotizacionNueva(cotizacionId, archivos) {
    const extensionesPermitidas = /\.(jpe?g|png|webp)$/i;

    if (archivos.length > 5) {
        mostrarToast("Podés adjuntar hasta 5 imágenes por cotización", "error");
        return false;
    }

    for (const archivo of archivos) {
        const tipoCompatible =
            ["image/jpeg", "image/png", "image/webp"].includes(archivo.type);

        if (!tipoCompatible || !extensionesPermitidas.test(archivo.name)) {
            mostrarToast("Seleccioná imágenes JPG, JPEG, PNG o WEBP", "error");
            return false;
        }

        if (archivo.size > 5 * 1024 * 1024) {
            mostrarToast("Cada imagen puede pesar hasta 5 MB", "error");
            return false;
        }
    }

    for (const archivo of archivos) {
        const formData = new FormData();
        formData.append("archivo", archivo);

        const res = await fetch(`/subir-archivo/${cotizacionId}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`
            },
            body: formData
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            mostrarToast(error.error || "No se pudo adjuntar la imagen", "error");
            return false;
        }
    }

    return true;
}
function numeroCotizacion(id) {
    const valor = document.getElementById(id)?.value || "0";
    const normalizado = String(valor)
        .replace(/\./g, "")
        .replace(",", ".");

    return Number(normalizado) || 0;
}

function actualizarTotalCotizacion() {
    const total =
        numeroCotizacion("valor")
        - numeroCotizacion("bonificacion")
        - numeroCotizacion("bonificacionAportes");
    const totalEl = document.getElementById("totalCotizacion");

    if (totalEl) {
        totalEl.textContent = `$ ${Math.max(total, 0).toLocaleString("es-AR")}`;
    }

    const total2 =
        numeroCotizacion("valor2")
        - numeroCotizacion("bonificacion2")
        - numeroCotizacion("bonificacionAportes2");
    const totalEl2 = document.getElementById("totalCotizacion2");

    if (totalEl2) {
        totalEl2.textContent = `$ ${Math.max(total2, 0).toLocaleString("es-AR")}`;
    }
}

function inicializarTotalCotizacion() {
    [
        "valor",
        "bonificacion",
        "bonificacionAportes",
        "valor2",
        "bonificacion2",
        "bonificacionAportes2"
    ].forEach(id => {
        const input = document.getElementById(id);

        if (input) {
            input.addEventListener("input", actualizarTotalCotizacion);
        }
    });

    actualizarTotalCotizacion();
}

let comentarioId = null;
let comentarioModalTrigger = null;

function abrirModal(id, comentario) {
    comentarioId = id;
    comentarioModalTrigger = document.activeElement;
    document.getElementById("modalComentario").value = comentario;
    document.getElementById("modal").style.display = "flex";
    requestAnimationFrame(() => {
        document.getElementById("modalComentario")?.focus();
    });
}

function cerrarModalComentario() {
    document.getElementById("modal").style.display = "none";
    comentarioModalTrigger?.focus();
    comentarioModalTrigger = null;
}

async function guardarComentario() {
    const nuevo = document.getElementById("modalComentario").value;

    const res = await fetch(`/editar-comentario/${comentarioId}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ comentarios: nuevo })
    });

    if (await manejarError(res)) return;

    if (res.ok) {
        mostrarToast("Actualizado", "success");
        const comentarioVisible = document.querySelector(
            "#cotizacionDetalleModalContenido [data-comentario-cotizacion]"
        );
        if (comentarioVisible) {
            comentarioVisible.textContent = nuevo || "Sin comentarios";
        }
        cerrarModalComentario();

        if (document.getElementById("misCotizaciones")?.style.display !== "none") {
            cargarMisCotizaciones();
        } else if (document.getElementById("dni")?.value.trim()) {
            buscar();
        }
    } else {
        mostrarToast("No autorizado", "error");
    }
}

// =======================
// EDITAR USUARIO
// =======================

let usuarioEditando = null;

function editarUsuario(id) {
    if (!esAdmin()) {
        mostrarToast("No autorizado", "error");
        return;
    }

    if (!id || id === "undefined") {
        mostrarToast("Usuario no encontrado", "error");
        return;
    }

    const usuario = usuariosCargados.find(user => String(user.id) === String(id));

    if (!usuario) {
        mostrarToast("Usuario no encontrado", "error");
        return;
    }

    usuarioEditando = id;
    document.getElementById("editUsuario").value = usuario.usuario;
    document.getElementById("editPassword").value = "";
    document.getElementById("editOrdenLogin").value = usuario.orden_login ?? "";
    document.getElementById("editRol").value = usuario.rol;
    document.getElementById("modalEditar").style.display = "flex";
}

function cerrarModalEditar() {
    document.getElementById("modalEditar").style.display = "none";
    usuarioEditando = null;
}

async function guardarEdicion() {
    const usuario = document.getElementById("editUsuario").value.trim();
    const password = document.getElementById("editPassword").value;
    const ordenLogin = document.getElementById("editOrdenLogin").value;
    const rol = document.getElementById("editRol").value;

    if (!usuario) {
        mostrarToast("El usuario no puede estar vacio", "error");
        return;
    }

    const res = await fetch(`/usuarios/${usuarioEditando}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ usuario, password, rol, orden_login: ordenLogin })
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    if (res.ok) {
        mostrarToast("Usuario actualizado", "success");
        cerrarModalEditar();
        cargarUsuarios();
    } else {
        mostrarToast(data.error || "Error", "error");
    }
}

// =======================
// ➕ CREAR USUARIO
// =======================

async function crearUsuario() {
    if (!esAdmin()) {
        mostrarToast("No autorizado", "error");
        return;
    }

    const usuarioNuevo = document.getElementById("nuevoUsuario").value;
    const password = document.getElementById("nuevoPassword").value;
    const rolNuevo = document.getElementById("nuevoRol").value;

    const res = await fetch("/crear-usuario", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ usuario: usuarioNuevo, password, rol: rolNuevo })
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    if (res.ok) {
        mostrarToast("Usuario creado", "success");
        document.getElementById("nuevoUsuario").value = "";
        document.getElementById("nuevoPassword").value = "";
        document.getElementById("nuevoRol").value = "vendedora";
        cargarUsuarios();
    } else {
        mostrarToast(data.error || "Error", "error");
    }
}

// =======================
// =======================
// PRIMER CONTACTO
// =======================

let primerContactoAnalisisIndividual = null;
let primerContactoClaveIndividual = null;
let primerContactoPreviewMultiple = [];
let primerContactoClaveMultiple = null;
const primerContactoDatosPorTelefono = new Map();

function claveOperacionPrimerContacto(prefijo) {
    const uuid = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return `${prefijo}:${uuid}`.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

function textoEstadoPrimerContacto(estado) {
    return ({
        nuevo: "Contacto nuevo",
        existe_en_crm: "Ya existe en el Gestor Comercial",
        contactado_por_otra: "Ya contactado por otra asesora",
        contactado_por_mi: "Ya contactado por vos",
        duplicado_tanda: "Duplicado en esta tanda",
        invalido: "Número inválido"
    })[estado] || "Contacto";
}

function claseEstadoPrimerContacto(estado) {
    return `primer-contacto-estado primer-contacto-estado-${estado || "nuevo"}`;
}

function enlaceWhatsappPrimerContacto(telefono) {
    const numero = normalizarTelefonoWhatsappArgentina(telefono);

    if (!numero) return escaparHtml(telefono || "-");

    return `
        <a class="primer-contacto-whatsapp" href="https://wa.me/${numero}"
            target="_blank" rel="noopener noreferrer">
            ${escaparHtml(telefono || numero)}
        </a>
    `;
}

function detalleClientePrimerContacto(resultado) {
    if (!resultado?.cliente) return "";

    const cliente = resultado.cliente;

    return `
        <div class="primer-contacto-cliente">
            <span>Cliente existente</span>
            <strong>${escaparHtml(cliente.nombre || "Sin nombre")}</strong>
            ${cliente.dni ? `<small>DNI ${escaparHtml(cliente.dni)}</small>` : ""}
            <small>${Number(cliente.cantidad_cotizaciones || 0)} cotizaciones registradas</small>
        </div>
    `;
}

function renderAnalisisPrimerContacto(resultado, { acciones = true } = {}) {
    const asesoras = (resultado.asesoras || []).map(escaparHtml).join(", ");
    const historial = (resultado.historial || []).map(gestion => `
        <li>
            <span>${formatearFecha(gestion.fecha)}</span>
            <strong>${escaparHtml(gestion.asesora || "-")}</strong>
            ${gestion.observacion
                ? `<small>${escaparHtml(gestion.observacion)}</small>`
                : ""}
        </li>
    `).join("");
    const telefonoCodificado = encodeURIComponent(
        resultado.telefono_original || resultado.telefono_normalizado || ""
    );

    return `
        <article class="primer-contacto-resumen">
            <div class="primer-contacto-resumen-head">
                <div>
                    <span class="${claseEstadoPrimerContacto(resultado.estado)}">
                        ${textoEstadoPrimerContacto(resultado.estado)}
                    </span>
                    <h3>${enlaceWhatsappPrimerContacto(
                        resultado.telefono_original || resultado.telefono_normalizado
                    )}</h3>
                    ${resultado.nombre
                        ? `<p>${escaparHtml(resultado.nombre)}</p>`
                        : ""}
                </div>
                <strong>${Number(resultado.cantidad_contactos || 0)} contactos</strong>
            </div>

            ${resultado.ultimo_contacto
                ? `<p>Último contacto: ${formatearFecha(resultado.ultimo_contacto)}</p>`
                : "<p>Este número todavía no tiene gestiones.</p>"}
            ${resultado.ultimo_contacto_propio
                ? `<p>Tu último contacto: ${formatearFecha(resultado.ultimo_contacto_propio)}</p>`
                : ""}
            ${asesoras ? `<p>Asesoras: ${asesoras}</p>` : ""}
            ${resultado.existe_en_crm ? `
                <p class="primer-contacto-aviso-crm">
                    Este número ya existe en el Gestor Comercial.
                    ${Number(resultado.cantidad_cotizaciones_crm || 0)
                        ? `${Number(resultado.cantidad_cotizaciones_crm)} cotización(es) relacionada(s).`
                        : ""}
                </p>
            ` : ""}
            ${detalleClientePrimerContacto(resultado)}

            ${historial ? `
                <details class="primer-contacto-historial">
                    <summary>Ver historial</summary>
                    <ol>${historial}</ol>
                </details>
            ` : ""}

            ${acciones && resultado.valido !== false ? `
                <div class="primer-contacto-card-actions">
                    <button type="button" onclick="abrirNuevoPrimerContacto('${telefonoCodificado}')">
                        ${resultado.ya_contactado_por_mi
                            ? "Registrar nuevo contacto"
                            : resultado.cantidad_contactos || resultado.existe_en_crm
                                ? "Agregarme como asesora"
                                : "Registrar contacto"}
                    </button>
                    <button type="button" class="secondary-btn"
                        onclick="crearCotizacionDesdePrimerContacto('${telefonoCodificado}')">
                        Crear cotización
                    </button>
                </div>
            ` : ""}
        </article>
    `;
}

function guardarDatosPrimerContacto(resultado) {
    if (!resultado?.telefono_normalizado) return;
    primerContactoDatosPorTelefono.set(resultado.telefono_normalizado, resultado);
}

async function buscarPrimerContacto() {
    const input = document.getElementById("primerContactoBuscarTelefono");
    const contenedor = document.getElementById("primerContactoBusquedaResultado");
    const telefono = input?.value.trim();

    if (!telefono) {
        contenedor.hidden = true;
        contenedor.innerHTML = "";
        return;
    }

    mostrarLoader();
    try {
        const res = await fetch(
            `/primer-contacto/buscar?telefono=${encodeURIComponent(telefono)}`,
            { headers: authHeaders() }
        );
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;
        if (!res.ok) {
            mostrarToast(datos.error || "No se pudo buscar el teléfono", "error");
            return;
        }

        guardarDatosPrimerContacto(datos);
        contenedor.innerHTML = renderAnalisisPrimerContacto(datos);
        contenedor.hidden = false;
    } catch (error) {
        mostrarToast("No se pudo buscar el teléfono", "error");
    } finally {
        ocultarLoader();
    }
}

function agruparGestionesPrimerContacto(gestiones) {
    const grupos = new Map();

    gestiones.forEach(gestion => {
        const clave = gestion.telefono_normalizado;
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(gestion);
    });

    return [...grupos.values()];
}

function renderGrupoPrimerContacto(gestiones) {
    const principal = gestiones[0];
    const telefonoCodificado = encodeURIComponent(
        principal.telefono_original || principal.telefono_normalizado
    );
    const historial = gestiones.slice(0, 6).map(gestion => `
        <li>
            <span>${formatearFecha(gestion.fecha)}</span>
            <strong>${escaparHtml(gestion.asesora || "-")}</strong>
            ${gestion.observacion
                ? `<small>${escaparHtml(gestion.observacion)}</small>`
                : ""}
        </li>
    `).join("");
    const datos = {
        telefono_original: principal.telefono_original,
        telefono_normalizado: principal.telefono_normalizado,
        nombre: principal.nombre,
        cantidad_contactos: Number(principal.cantidad_contactos || gestiones.length),
        cliente: principal.cliente_id
            ? {
                id: principal.cliente_id,
                dni: principal.cliente_dni,
                nombre: principal.nombre,
                telefono_normalizado: principal.telefono_normalizado,
                cantidad_cotizaciones: principal.cantidad_cotizaciones
            }
            : null
    };

    guardarDatosPrimerContacto(datos);

    return `
        <article class="primer-contacto-card">
            <div class="primer-contacto-card-main">
                <span class="primer-contacto-card-fecha">${formatearFecha(principal.fecha)}</span>
                <h3>${enlaceWhatsappPrimerContacto(
                    principal.telefono_original || principal.telefono_normalizado
                )}</h3>
                <p>${escaparHtml(principal.nombre || "Sin nombre informado")}</p>
                <div class="primer-contacto-meta">
                    <span>${Number(principal.cantidad_contactos || gestiones.length)} contactos totales</span>
                    <span>Último registro: ${escaparHtml(principal.asesora || "-")}</span>
                    ${principal.cliente_id ? "<span>Cliente CRM vinculado</span>" : ""}
                </div>
            </div>
            <div class="primer-contacto-card-actions">
                <button type="button" onclick="abrirNuevoPrimerContacto('${telefonoCodificado}')">
                    Registrar nuevo contacto
                </button>
                <button type="button" class="secondary-btn"
                    onclick="crearCotizacionDesdePrimerContacto('${telefonoCodificado}')">
                    Crear cotización
                </button>
            </div>
            <details class="primer-contacto-historial">
                <summary>Historial visible</summary>
                <ol>${historial}</ol>
            </details>
        </article>
    `;
}

async function cargarPrimerosContactos() {
    const listado = document.getElementById("primerContactoListado");
    if (!listado) return;

    const fecha = document.getElementById("primerContactoFecha")?.value || "";
    const vista = document.getElementById("primerContactoVista")?.value || "todos";
    const params = new URLSearchParams();

    if (fecha) {
        params.set("fecha_desde", fecha);
        params.set("fecha_hasta", fecha);
    }
    if (esAdmin()) params.set("vista", vista);

    listado.innerHTML = "<p>Cargando contactos...</p>";
    try {
        const res = await fetch(`/primer-contacto?${params.toString()}`, {
            headers: authHeaders()
        });
        const datos = await res.json().catch(() => ([]));

        if (await manejarError(res)) return;
        if (!res.ok) {
            listado.innerHTML = "<p>No se pudieron cargar los contactos.</p>";
            return;
        }

        const grupos = agruparGestionesPrimerContacto(datos);
        document.getElementById("primerContactoContador").textContent =
            `${datos.length} gestiones en ${grupos.length} teléfonos`;
        listado.innerHTML = grupos.length
            ? grupos.map(renderGrupoPrimerContacto).join("")
            : "<p>No hay contactos para mostrar.</p>";
    } catch (error) {
        listado.innerHTML = "<p>No se pudieron cargar los contactos.</p>";
    }
}

function limpiarFiltrosPrimerContacto() {
    const telefono = document.getElementById("primerContactoBuscarTelefono");
    const fecha = document.getElementById("primerContactoFecha");
    const vista = document.getElementById("primerContactoVista");
    const resultado = document.getElementById("primerContactoBusquedaResultado");

    if (telefono) telefono.value = "";
    if (fecha) fecha.value = "";
    if (vista) vista.value = "todos";
    if (resultado) {
        resultado.hidden = true;
        resultado.innerHTML = "";
    }
    cargarPrimerosContactos();
}

function reiniciarAnalisisPrimerContactoIndividual() {
    primerContactoAnalisisIndividual = null;
    primerContactoClaveIndividual = null;
    const analisis = document.getElementById("primerContactoAnalisisIndividual");
    const boton = document.getElementById("primerContactoConfirmarIndividual");

    if (analisis) {
        analisis.hidden = true;
        analisis.innerHTML = "";
    }
    if (boton) boton.textContent = "Analizar teléfono";
}

function abrirNuevoPrimerContacto(telefonoCodificado = "") {
    const modal = document.getElementById("primerContactoModal");
    const form = document.getElementById("primerContactoForm");

    form?.reset();
    reiniciarAnalisisPrimerContactoIndividual();
    document.getElementById("primerContactoTelefono").value =
        decodeURIComponent(telefonoCodificado || "");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    document.getElementById("primerContactoTelefono")?.focus();
}

function cerrarNuevoPrimerContacto() {
    document.getElementById("primerContactoModal").hidden = true;
    document.body.classList.remove("modal-open");
    reiniciarAnalisisPrimerContactoIndividual();
}

async function procesarNuevoPrimerContacto(event) {
    event.preventDefault();
    const telefono = document.getElementById("primerContactoTelefono").value.trim();
    const normalizado = normalizarTelefono(telefono);
    const boton = document.getElementById("primerContactoConfirmarIndividual");
    const panel = document.getElementById("primerContactoAnalisisIndividual");

    if (
        !primerContactoAnalisisIndividual
        || primerContactoAnalisisIndividual.telefono_normalizado !== normalizado
    ) {
        boton.disabled = true;
        try {
            const res = await fetch(
                `/primer-contacto/buscar?telefono=${encodeURIComponent(telefono)}`,
                { headers: authHeaders() }
            );
            const datos = await res.json().catch(() => ({}));

            if (await manejarError(res)) return;
            if (!res.ok || datos.estado === "invalido") {
                mostrarToast(datos.error || "Número de teléfono inválido", "error");
                return;
            }

            primerContactoAnalisisIndividual = datos;
            primerContactoClaveIndividual = claveOperacionPrimerContacto("individual");
            guardarDatosPrimerContacto(datos);
            panel.innerHTML = renderAnalisisPrimerContacto(datos, { acciones: false });
            panel.hidden = false;
            boton.textContent = datos.ya_contactado_por_mi
                ? "Registrar nuevo contacto"
                : datos.cantidad_contactos || datos.existe_en_crm
                    ? "Agregarme como asesora"
                    : "Registrar contacto";
        } finally {
            boton.disabled = false;
        }
        return;
    }

    boton.disabled = true;
    try {
        const res = await fetch("/primer-contacto", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                telefono,
                nombre: document.getElementById("primerContactoNombre").value,
                observacion: document.getElementById("primerContactoObservacion").value,
                confirmar_repetido: primerContactoAnalisisIndividual.ya_contactado_por_mi,
                clave_idempotencia: primerContactoClaveIndividual
            })
        });
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;
        if (!res.ok) {
            mostrarToast(datos.error || "No se pudo registrar el contacto", "error");
            return;
        }

        mostrarToast(datos.idempotente
            ? "El contacto ya había sido registrado"
            : "Contacto registrado");
        cerrarNuevoPrimerContacto();
        await cargarPrimerosContactos();
        const busqueda = document.getElementById("primerContactoBuscarTelefono");
        if (busqueda?.value.trim()) await buscarPrimerContacto();
    } catch (error) {
        mostrarToast("No se pudo registrar el contacto", "error");
    } finally {
        boton.disabled = false;
    }
}

function abrirCargaMultiplePrimerContacto() {
    primerContactoPreviewMultiple = [];
    primerContactoClaveMultiple = null;
    document.getElementById("primerContactoNumerosMultiples").value = "";
    document.getElementById("primerContactoPreviewMultiple").innerHTML = "";
    document.getElementById("primerContactoPreviewMultiple").hidden = true;
    document.getElementById("primerContactoConfirmarMultiple").hidden = true;
    document.getElementById("primerContactoMultipleModal").hidden = false;
    document.body.classList.add("modal-open");
    document.getElementById("primerContactoNumerosMultiples")?.focus();
}

function cerrarCargaMultiplePrimerContacto() {
    document.getElementById("primerContactoMultipleModal").hidden = true;
    document.body.classList.remove("modal-open");
    primerContactoPreviewMultiple = [];
    primerContactoClaveMultiple = null;
}

function renderPreviewMultiplePrimerContacto(resultados) {
    return resultados.map((resultado, indice) => {
        const seleccionable = resultado.valido !== false
            && resultado.estado !== "duplicado_tanda";
        const checked = seleccionable && resultado.seleccion_recomendada;

        return `
            <article class="primer-contacto-preview-item">
                <label>
                    <input type="checkbox" data-primer-contacto-indice="${indice}"
                        ${checked ? "checked" : ""} ${seleccionable ? "" : "disabled"}>
                    <span>
                        <strong>${escaparHtml(resultado.telefono_original || "-")}</strong>
                        <span class="${claseEstadoPrimerContacto(resultado.estado)}">
                            ${textoEstadoPrimerContacto(resultado.estado)}
                        </span>
                        ${resultado.ultimo_contacto_propio
                            ? `<small>Tu último contacto: ${formatearFecha(resultado.ultimo_contacto_propio)}</small>`
                            : resultado.ultimo_contacto
                                ? `<small>Último contacto: ${formatearFecha(resultado.ultimo_contacto)}</small>`
                                : ""}
                        ${resultado.cliente
                            ? `<small>Cliente: ${escaparHtml(resultado.cliente.nombre || "Sin nombre")}</small>`
                            : ""}
                    </span>
                </label>
            </article>
        `;
    }).join("");
}

async function analizarCargaMultiplePrimerContacto() {
    const textarea = document.getElementById("primerContactoNumerosMultiples");
    const lineas = textarea.value.split(/\r?\n/).map(linea => linea.trim()).filter(Boolean);
    const preview = document.getElementById("primerContactoPreviewMultiple");
    const boton = document.getElementById("primerContactoAnalizarMultiple");

    if (lineas.length > 15) {
        mostrarToast("Podés cargar un máximo de 15 números por vez.", "error");
        return;
    }
    if (!lineas.length) {
        mostrarToast("Ingresá al menos un número", "error");
        return;
    }

    boton.disabled = true;
    try {
        const res = await fetch("/primer-contacto/analizar-multiple", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ numeros: lineas })
        });
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;
        if (!res.ok) {
            mostrarToast(datos.error || "No se pudieron analizar los números", "error");
            return;
        }

        primerContactoPreviewMultiple = datos.resultados || [];
        primerContactoClaveMultiple = claveOperacionPrimerContacto("lote");
        preview.innerHTML = renderPreviewMultiplePrimerContacto(
            primerContactoPreviewMultiple
        );
        preview.hidden = false;
        document.getElementById("primerContactoConfirmarMultiple").hidden = false;
    } catch (error) {
        mostrarToast("No se pudieron analizar los números", "error");
    } finally {
        boton.disabled = false;
    }
}

async function confirmarCargaMultiplePrimerContacto() {
    const boton = document.getElementById("primerContactoConfirmarMultiple");
    const seleccionados = [...document.querySelectorAll(
        "[data-primer-contacto-indice]:checked"
    )].map(input => primerContactoPreviewMultiple[Number(input.dataset.primerContactoIndice)]);

    if (!seleccionados.length) {
        mostrarToast("Seleccioná al menos un número", "error");
        return;
    }

    boton.disabled = true;
    try {
        const res = await fetch("/primer-contacto/confirmar-multiple", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                clave_operacion: primerContactoClaveMultiple,
                items: seleccionados.map(resultado => ({
                    telefono: resultado.telefono_original,
                    confirmar_repetido: resultado.ya_contactado_por_mi
                }))
            })
        });
        const datos = await res.json().catch(() => ({}));

        if (await manejarError(res)) return;
        if (!res.ok) {
            mostrarToast(datos.error || "No se pudieron registrar los contactos", "error");
            return;
        }

        mostrarToast(`${datos.creadas} contactos registrados`);
        cerrarCargaMultiplePrimerContacto();
        await cargarPrimerosContactos();
    } catch (error) {
        mostrarToast("No se pudieron registrar los contactos", "error");
    } finally {
        boton.disabled = false;
    }
}

function crearCotizacionDesdePrimerContacto(telefonoCodificado) {
    const telefono = decodeURIComponent(telefonoCodificado || "");
    const normalizado = normalizarTelefono(telefono);
    const contacto = primerContactoDatosPorTelefono.get(normalizado);

    limpiarFormularioCotizacion();
    limpiarResultadosBusqueda();
    setValorCampo("dni", telefono);
    setValorCampo("terminoBusquedaCotizacion", telefono);
    setValorCampo("celular", normalizado || telefono);
    setValorCampo("nombre", contacto?.nombre || contacto?.cliente?.nombre || "");

    if (contacto?.cliente?.id) {
        setValorCampo("clienteIdCotizacion", contacto.cliente.id);
        setValorCampo("dniCotizacion", contacto.cliente.dni || "");
    }

    mostrarSeccion("cotizador");
    mostrarToast("Completá los datos necesarios para crear tu cotización");
}

// INIT
// =======================

window.onload = function () {
    const token = localStorage.getItem("token");

    if (!token) {
        window.location.href = "/login.html";
        return;
    }

    const payload = obtenerPayload();

    const vistaPrimerContacto = document.getElementById(
        "primerContactoVistaGrupo"
    );
    if (vistaPrimerContacto) {
        vistaPrimerContacto.hidden = !esAdmin();
    }
    const tituloPrimerContacto = document.getElementById(
        "primerContactoListadoTitulo"
    );
    if (tituloPrimerContacto) {
        tituloPrimerContacto.textContent = esAdmin()
            ? "Contactos recientes"
            : "Mis contactos recientes";
    }

    // mostrar usuario logueado
    const user = document.getElementById("usuarioLogueado");
    if (user) {
        user.innerHTML = `
            <img class="icono-menu" src="img/imgicon-usuario.png" alt="">
            <span>${payload.usuario}</span>
        `;
    }

    inicializarTotalCotizacion();

    const inputBusqueda = document.getElementById("dni");
    if (inputBusqueda) {
        inputBusqueda.addEventListener("input", () => {
            if (!inputBusqueda.value.trim()) {
                busquedaCotizacionActual++;
                limpiarResultadosBusqueda();
                limpiarFormularioCotizacion();
            }
        });
    }

    // si NO es admin oculta botón usuarios
    if (!esAdmin()) {
        const btnUsuarios = document.querySelector("button[onclick*='usuarios']");
        if (btnUsuarios) btnUsuarios.style.display = "none";
    }

    prepararInicioCrm();
    cargarUsuarios();
    cargarInicioCrm();
    calcularIMCAutomatico();
    calcularIMCPediatrico();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            if (!document.getElementById("primerContactoModal")?.hidden) {
                cerrarNuevoPrimerContacto();
            } else if (!document.getElementById("primerContactoMultipleModal")?.hidden) {
                cerrarCargaMultiplePrimerContacto();
            } else if (!document.getElementById("inicioTareaModal")?.hidden) {
                cerrarFormularioTarea();
            } else if (!document.getElementById("todasTareasModal")?.hidden) {
                cerrarModalTodasTareas();
            }
        }
    });
};

// =======================
// 🚪 LOGOUT
// =======================

function logout() {
    localStorage.clear();
    window.location.href = "/login.html";
}

// =======================
// TOAST
// =======================

function mostrarToast(mensaje, tipo = "success") {
    const toast = document.getElementById("toast");

    toast.textContent = mensaje;
    toast.className = `toast show ${tipo}`;

    setTimeout(() => {
        toast.className = "toast";
    }, 3000);
}

function mostrarSeccion(seccion) {
    const secciones = document.querySelectorAll(".seccion");

    secciones.forEach(sec => {
        sec.style.display = "none";
    });

    document.getElementById(seccion).style.display = "block";

    if (seccion === "inicio") {
        cargarInicioCrm();
    }

    if (seccion === "primerContacto") {
        cargarPrimerosContactos();
    }

    // si es usuarios, cargar lista
    if (seccion === "usuarios") {
        cargarUsuarios();
    }
    if (seccion === "misCotizaciones") {

        const titulo =
            esAdmin()
                ? "Cotizaciones generales"
                : "Mis cotizaciones";

        document.getElementById(
            "tituloCotizaciones"
        ).innerHTML = `
            <span class="titulo-con-icono">
                <img
                    class="icono-seccion"
                    src="img/imgicon-cotizacion-general.png"
                    alt=""
                >
                <span>${titulo}</span>
            </span>
        `;

        cargarMisCotizaciones();
    }

}

async function cambiarPassword() {

    const actual =
        document.getElementById("passwordActual").value;

    const nueva =
        document.getElementById("passwordNueva").value;

    const res = await fetch("/cambiar-password", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
            actual,
            nueva
        })
    });

    const data = await res.json();

    if (res.ok) {

        mostrarToast(
            "Contraseña actualizada",
            "success"
        );

        document.getElementById("passwordActual").value = "";
        document.getElementById("passwordNueva").value = "";

    } else {

        mostrarToast(
            data.error || "Error",
            "error"
        );
    }
}

function togglePassword(id, el) {

    const input = document.getElementById(id);

    if (input.type === "password") {

        input.type = "text";
        el.textContent = "Ver";

    } else {

        input.type = "password";
        el.textContent = "Ocultar";
    }
}

function completarSelectEstados() {
    const select = document.getElementById("filtroEstado");

    if (!select || select.dataset.cargado === "true") return;

    select.innerHTML = `
        <option value="">Todos los estados</option>
        ${ESTADOS_COTIZACION.map(estado => `
            <option value="${estado}">${estado}</option>
        `).join("")}
    `;

    select.dataset.cargado = "true";
}

function completarSelectAsesoras(cotizaciones) {
    const select = document.getElementById("filtroAsesora");

    if (!select) return;

    const seleccionActual = select.value;
    const asesoras = [...new Set(
        cotizaciones.map(c => c.vendedora).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "es"));

    select.innerHTML = `
        <option value="">Todas las asesoras</option>
        ${asesoras.map(asesora => `
            <option value="${asesora}" ${asesora === seleccionActual ? "selected" : ""}>
                ${asesora}
            </option>
        `).join("")}
    `;
}

function filtrosCotizacionesQuery() {
    const params = new URLSearchParams();
    const estado = document.getElementById("filtroEstado")?.value;
    const asesora = document.getElementById("filtroAsesora")?.value;
    const fechaDesde = document.getElementById("filtroFechaDesde")?.value;
    const fechaHasta = document.getElementById("filtroFechaHasta")?.value;

    if (estado) params.set("estado", estado);
    if (asesora) params.set("asesora", asesora);
    if (fechaDesde) params.set("fecha_desde", fechaDesde);
    if (fechaHasta) params.set("fecha_hasta", fechaHasta);

    const query = params.toString();

    return query ? `?${query}` : "";
}

function limpiarFiltrosCotizaciones() {
    ["filtroEstado", "filtroAsesora", "filtroFechaDesde", "filtroFechaHasta"]
        .forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = "";
        });

    cargarMisCotizaciones();
}

async function descargarExcelCotizaciones() {
    mostrarLoader();

    try {
        const res = await fetch(`/cotizaciones-excel${filtrosCotizacionesQuery()}`, {
            headers: authHeaders()
        });

        if (await manejarError(res)) return;

        if (!res.ok) {
            mostrarToast("No se pudo generar el Excel", "error");
            return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const fecha = new Date().toISOString().slice(0, 10);

        link.href = url;
        link.download = `cotizaciones-${fecha}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        mostrarToast("No se pudo descargar el Excel", "error");
    } finally {
        ocultarLoader();
    }
}

function renderSeguimientosHoy(cotizaciones) {
    const div = document.getElementById("seguimientosHoy");

    if (!div) return;

    const hoy = fechaActualInput();
    const seguimientos = cotizaciones.filter(c =>
        fechaSeguimientoInput(c.fecha_seguimiento) === hoy
    );

    if (seguimientos.length === 0) {
        div.innerHTML = "";
        return;
    }

    div.innerHTML = `
        <h3>Seguimientos de hoy</h3>
        ${seguimientos.map(c => `
            <div class="seguimiento-item">
                <span>
                    <b>${c.nombre || "Sin nombre"}</b>
                    | DNI ${mostrarDniCotizacion(c.dni)}
                    | ${c.celular || "Sin telefono"}
                    | ${estadoCotizacion(c)}
                </span>
                <span>${c.vendedora || "-"}</span>
            </div>
        `).join("")}
    `;
}

function renderContadorCotizaciones(cantidad) {
    const contador = document.getElementById("contadorCotizaciones");

    if (!contador) return;

    contador.textContent = `Cotizaciones encontradas: ${cantidad}`;
}

async function guardarSeguimientoCotizacion(id, estadoId, seguimientoId) {
    const estado = document.getElementById(estadoId)?.value || "Nuevo";
    const fechaSeguimiento =
        document.getElementById(seguimientoId)?.value || null;
    const triggerFechaAlta = document.activeElement;

    const res = await fetch(`/cotizaciones/${id}/seguimiento`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
            estado,
            fecha_seguimiento: fechaSeguimiento
        })
    });

    if (await manejarError(res)) return;

    const datos = await res.json().catch(() => ({}));

    if (!res.ok) {
        mostrarToast(datos.error || "No se pudo guardar el seguimiento", "error");
        return;
    }

    mostrarToast("Seguimiento actualizado", "success");
    const estadoVisible = document.querySelector(
        "#cotizacionDetalleModalContenido [data-cotizacion-estado]"
    );
    if (estadoVisible) estadoVisible.textContent = estado;

    if (estado === "Afiliado" && datos.requiere_fecha_alta) {
        await actualizarInicioCoordinado({ silencioso: true });
        const botonFecha = document.querySelector(
            `[data-cargar-fecha-alta="${id}"]`
        );

        abrirModalFechaAltaPosventa(
            id,
            botonFecha || triggerFechaAlta,
            datos.fecha_alta || ""
        );
    }

    if (document.getElementById("misCotizaciones")?.style.display !== "none") {
        cargarMisCotizaciones();
        return;
    }

    if (document.getElementById("dni")?.value.trim()) {
        buscar();
    }
}

async function anularCotizacion(id) {
    if (!esAdmin()) {
        mostrarToast("No autorizado", "error");
        return;
    }

    const confirmado = await mostrarModalConfirmacion({
        titulo: "¿Anular cotización?",
        texto: "La cotización seguirá guardada, pero quedará marcada como anulada.",
        accion: "Anular"
    });

    if (!confirmado) return;

    const res = await fetch(`/cotizaciones/${id}/anular`, {
        method: "PUT",
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "No se pudo anular la cotización", "error");
        return;
    }

    mostrarToast("Cotización anulada", "success");

    cerrarDetalleCotizacion({ devolverFoco: false });

    if (document.getElementById("misCotizaciones")?.style.display !== "none") {
        cargarMisCotizaciones();
        return;
    }

    if (document.getElementById("dni")?.value.trim()) {
        buscar();
    }
}

async function cargarMisCotizacionesAnterior() {

    completarSelectEstados();

    const res = await fetch(`/mis-cotizaciones${filtrosCotizacionesQuery()}`, {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    console.log("[mis-cotizaciones frontend datos]", {
        filtros: filtrosCotizacionesQuery(),
        cantidadRecibida: Array.isArray(data) ? data.length : null,
        primeros: Array.isArray(data)
            ? data.slice(0, 5).map(c => ({
                id: c.id,
                dni: c.dni,
                celular: c.celular
            }))
            : data
    });

    const div =
        document.getElementById("misResultados");

    div.innerHTML = "";

    completarSelectAsesoras(data);
    renderSeguimientosHoy(data);
    renderContadorCotizaciones(data.length);

    if (data.length === 0) {

        div.innerHTML =
            "<p>No hay cotizaciones</p>";

        return;
    }

    // =========================
    // 👑 ADMIN
    // =========================

    if (esAdmin()) {

        const agrupadasPorVendedora = {};

        data.forEach(c => {

            if (!agrupadasPorVendedora[c.vendedora]) {

                agrupadasPorVendedora[c.vendedora] = [];
            }

            agrupadasPorVendedora[c.vendedora].push(c);
        });

        Object.keys(agrupadasPorVendedora).forEach(vendedora => {

            const cotizaciones =
                agrupadasPorVendedora[vendedora];

            div.innerHTML += `

        <div class="container">

            <div
                style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:20px;
                    flex-wrap:wrap;
                "
            >

                <div>

                    <h2 style="margin-bottom:5px;display:flex;align-items:center;gap:8px;">
                        <img
                            src="img/imgicon-asesora.png"
                            alt=""
                            style="height:22px;width:auto;flex-shrink:0;"
                        >
                        ${vendedora}
                    </h2>

                    <p style="margin:0;color:#666;">
                        ${cotizaciones.length}
                        cotizaciones
                    </p>

                </div>

                <button
                    onclick="toggleGrupo('${vendedora}')"
                >
                    Ver cotizaciones
                </button>

            </div>

            <div
                id="grupo-${vendedora}"
                style="
                    display:none;
                    margin-top:20px;
                "
            ></div>

        </div>
    `;

            const grupo =
                document.getElementById(`grupo-${vendedora}`);

            cotizaciones.forEach(c => {
                const sufijo = `mis-admin-${c.id}`;

                grupo.innerHTML += renderTarjetaCotizacion(c, {
                    sufijo,
                    cardId: `card-${sufijo}`,
                    clases: "historial-card"
                });

            });
        });

        return;
    }

    // =========================
    // VENDEDORAS
    // =========================

    const agrupadas = {};

    data.forEach(c => {
        const clave = c.dni || c.celular || `sin-dni-${c.id}`;

        if (!agrupadas[clave]) {
            agrupadas[clave] = [];
        }

        agrupadas[clave].push(c);
    });

    Object.keys(agrupadas).forEach(clave => {

        const cotizaciones = agrupadas[clave];

        const primera = cotizaciones[0];
        const dniVisible = mostrarDniCotizacion(primera.dni);
        const claveHistorial = String(clave).replace(/[^a-zA-Z0-9_-]/g, "-");

        div.innerHTML += `

            <div class="card">

                <p>
                    <b>DNI:</b>
                    ${dniVisible}
                </p>

                <p>
                    <b>Cliente:</b>
                    ${primera.nombre || "-"}
                </p>

                <p>
                    <b>Celular:</b>
                    ${primera.celular || "-"}
                </p>

                <p>
                    <b>Cotizaciones:</b>
                    ${cotizaciones.length}
                </p>

                <button
                    onclick="toggleHistorial('${claveHistorial}')"
                >
                    Ver historial
                </button>

                <div
                    id="historial-${claveHistorial}"
                    style="
                        display:none;
                        margin-top:15px;
                    "
                >

                    ${cotizaciones.map(c => renderTarjetaCotizacion(c, {
            sufijo: `mis-vendedora-${c.id}`,
            cardId: `card-mis-vendedora-${c.id}`,
            clases: "historial-card"
        })).join("")}

                </div>

            </div>
        `;

    });
}

async function cargarMisCotizaciones() {
    mostrarLoader();

    try {
        await cargarMisCotizacionesAnterior();
    } catch (error) {
        mostrarToast("No se pudieron cargar las cotizaciones", "error");
    } finally {
        ocultarLoader();
    }
}

function toggleHistorial(dni) {

    const div =
        document.getElementById(`historial-${dni}`);

    if (div.style.display === "none") {

        div.style.display = "block";

    } else {

        div.style.display = "none";
    }
}
function toggleGrupo(vendedora) {

    const div =
        document.getElementById(`grupo-${vendedora}`);

    if (div.style.display === "none") {

        div.style.display = "block";

    } else {

        div.style.display = "none";
    }
}

function toggleMenu() {

    const sidebar =
        document.getElementById("sidebar");

    const overlay =
        document.getElementById("overlay");

    sidebar.classList.toggle("sidebar-open");

    overlay.classList.toggle("active");
}

function calcularIMC() {

    const peso =
        parseFloat(
            document.getElementById("peso").value
        );

    const alturaCm =
        parseFloat(
            document.getElementById("altura").value
        );

    if (!peso || !alturaCm) {

        mostrarToast(
            "Completá peso y altura",
            "error"
        );

        return;
    }

    const altura = alturaCm / 100;

    const imc =
        peso / (altura * altura);

    let estado = "";
    let observaciones = "";

    if (imc < 18.5) {

        estado = "Bajo peso";

    } else if (imc < 25) {

        estado = "Normal";

    } else if (imc < 30) {

        estado = "Sobrepeso";

    } else if (imc < 33) {

        estado = "Obesidad";

    } else if (imc <= 35) {

        estado = "IMC entre 33 y 35";

        observaciones = `
            <ul>
                <li>Atención: se recomienda duplicar la cuota</li>
                <li>Exclusión de cirugía bariátrica</li>
                <li>🧪 Requiere laboratorio de pre ingreso</li>
            </ul>
        `;

    } else if (imc <= 38) {

        estado = "IMC entre 35 y 38";

        observaciones = `
            <ul>
                <li>Atención: consultar aumento de cuota</li>
                <li>Exclusión de cirugía bariátrica</li>
                <li>🧪 Requiere laboratorio</li>
                <li>Requiere ecodoppler</li>
            </ul>
        `;

    } else {

        estado = "Mayor a 38";

        observaciones = `
            <ul>
                <li>🚫 Corresponde únicamente plan ambulatorio</li>
            </ul>
        `;
    }

    document.getElementById(
        "resultadoIMC"
    ).innerHTML = `

        <div class="card">

            <h3>
                IMC: ${imc.toFixed(1)}
            </h3>

            <p>
                <b>${estado}</b>
            </p>

            ${observaciones}

        </div>
    `;
}

function calcularIMCPediatrico() {

    const edad =
        parseInt(
            document.getElementById("edadNino").value
        );

    const peso =
        parseFloat(
            document.getElementById("pesoNino").value
        );

    const alturaCm =
        parseFloat(
            document.getElementById("alturaNino").value
        );

    if (!edad || !peso || !alturaCm) {

        mostrarToast(
            "Completá todos los campos",
            "error"
        );

        return;
    }

    if (edad < 2) {

        mostrarToast(
            "La calculadora es para mayores de 2 años",
            "error"
        );

        return;
    }

    const altura = alturaCm / 100;

    const imc =
        peso / (altura * altura);

    let estado = "";
    let mensaje = "";

    // ORIENTATIVO SIMPLE

    if (imc < 14) {

        estado = "Bajo peso";
        mensaje =
            "El valor se encuentra por debajo del rango orientativo para la edad.";

    } else if (imc < 18) {

        estado = "Peso normal";
        mensaje =
            "El valor se encuentra dentro del rango orientativo esperado.";

    } else if (imc < 21) {

        estado = "Sobrepeso";
        mensaje =
            "El valor se encuentra por encima del rango orientativo esperado.";

    } else {

        estado = "Obesidad";
        mensaje =
            "El valor es elevado y requiere evaluación profesional.";
    }

    document.getElementById("imcNumeroPediatrico")
        .textContent = imc.toFixed(1);

    document.getElementById("imcEstadoPediatrico")
        .textContent = estado;

    document.getElementById("imcTextoPediatrico")
        .textContent =
        `${mensaje} La evaluación definitiva depende de percentiles pediátricos.`;
}

// =======================
// SYNC IMC ADULTOS
// =======================

function syncAltura(valor) {
    document.getElementById("altura").value = valor;
}

function syncAlturaInput(valor) {
    document.getElementById("alturaRange").value = valor;
}

function syncPeso(valor) {
    document.getElementById("peso").value = valor;
}

function syncPesoInput(valor) {
    document.getElementById("pesoRange").value = valor;
}

// =======================
// SYNC IMC PEDIATRICO
// =======================

function syncEdad(valor) {
    document.getElementById("edadNino").value = valor;
}

function syncEdadInput(valor) {
    document.getElementById("edadRange").value = valor;
}

function syncAlturaNino(valor) {
    document.getElementById("alturaNino").value = valor;
}

function syncAlturaNinoInput(valor) {
    document.getElementById("alturaNinoRange").value = valor;
}

function syncPesoNino(valor) {
    document.getElementById("pesoNino").value = valor;
}

function syncPesoNinoInput(valor) {
    document.getElementById("pesoNinoRange").value = valor;
}

function calcularIMCAutomatico() {

    const peso =
        parseFloat(document.getElementById("peso").value);

    const altura =
        parseFloat(document.getElementById("altura").value) / 100;

    if (!peso || !altura) return;

    const imc = peso / (altura * altura);

    document.getElementById("imcNumero")
        .textContent = imc.toFixed(1);

    let estado = "";
    let texto = "";
    let color = "";

    if (imc < 18.5) {

        estado = "Bajo peso";
        texto = "Peso por debajo de lo recomendado.";
        color = "#f39c12";

    } else if (imc < 25) {

        estado = "Normal";
        texto = "Se encuentra dentro del rango saludable.";
        color = "#18a558";

    } else if (imc < 33) {

        estado = "Sobrepeso";
        texto = "Se encuentra dentro del rango aceptable.";
        color = "#ff9800";

    } else if (imc <= 35) {

        estado = "IMC 33-35";
        texto =
            "Se recomienda duplicar la cuota - Exclusión de cirugía bariátrica - Requiere laboratorio de pre ingreso";

        color = "#e53935";

    } else if (imc <= 38) {

        estado = "IMC 35-38";
        texto =
            "Aumento de cuota - Exclusión de cirugía bariátrica - Requiere laboratorio y ecodoppler de pre ingreso ";

        color = "#c62828";

    } else {

        estado = "Obesidad";
        texto =
            "IMC mayor a 38. Corresponde plan ambulatorio.";

        color = "#7b1fa2";
    }

    document.getElementById("imcEstado")
        .textContent = estado;

    document.getElementById("imcTexto")
        .textContent = texto;

    document.getElementById("imcNumero")
        .style.color = color;

    document.getElementById("imcEstado")
        .style.color = color;
}

function toggleUserMenu() {

    const menu =
        document.getElementById("userDropdown");

    if (menu.style.display === "block") {

        menu.style.display = "none";

    } else {

        menu.style.display = "block";
    }
}

// cerrar si clickea afuera
window.addEventListener("click", function (e) {

    const menu =
        document.getElementById("userDropdown");

    const btn =
        document.getElementById("usuarioLogueado");

    if (
        !menu.contains(e.target) &&
        !btn.contains(e.target)
    ) {
        menu.style.display = "none";
    }

    if (!e.target.closest("[data-pdf-download-menu]")) {
        cerrarMenusDescargaPdf();
    }
});
