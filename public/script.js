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

function alternarDetalleCotizacion(id, boton) {
    const detalle = document.getElementById(`detalle-cotizacion-${id}`);

    if (!detalle) return;

    const estaAbierto = detalle.classList.toggle("abierto");

    detalle.hidden = !estaAbierto;
    boton.setAttribute("aria-expanded", String(estaAbierto));
    boton.querySelector(".texto-toggle").textContent =
        estaAbierto ? "Ocultar detalle" : "Ver detalle";
    boton.querySelector(".icono-toggle").textContent =
        estaAbierto ? "-" : "+";
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

function renderTablaPdfOpcion(opcion) {
    return `
        <div class="pdf-opcion" data-pdf-opcion="${opcion.numero_opcion}">
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
        </div>
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

function renderTarjetaCotizacion(c, opciones = {}) {
    const sufijo = opciones.sufijo || c.id;
    const cardId = opciones.cardId || `card-${c.id}`;
    const detalleId = `detalle-cotizacion-${sufijo}`;
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
    const fechaSeguimientoResumen = fechaSeguimiento
        ? `<p><b>Seguimiento:</b> ${fechaSeguimiento}</p>`
        : "";

    return `
        <div class="card ${clases}" id="${cardId}">

            <div class="solo-pdf pdf-documento">
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

                    ${opcionesPlan.map(renderTablaPdfOpcion).join("")}

                    <div class="pdf-info-adicional">
                        <p><b>Modalidad:</b> ${c.modalidad || "Particular"}</p>
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
                    aria-expanded="false"
                    aria-controls="${detalleId}"
                    onclick="alternarDetalleCotizacion('${sufijo}', this)"
                >
                    <span class="texto-toggle">Ver detalle</span>
                    <span class="icono-toggle" aria-hidden="true">+</span>
                </button>
            </div>

            <div
                class="cotizacion-detalle no-pdf"
                id="${detalleId}"
                hidden
            >
                <div class="cotizacion-detalle-grid">
                    <p><b>Cotizaci&oacute;n N&deg;:</b> ${idVisible}</p>
                    <p><b>Nombre:</b> ${c.nombre || "-"}</p>
                    <p><b>Modalidad:</b> ${c.modalidad || "Particular"}</p>
                    <p><b>Valida hasta:</b> ${c.vigencia || "-"}</p>
                    <p><b>Referido:</b> ${c.referido || "No"}</p>
                    <p><b>Congelamiento:</b> ${c.congelamiento || "Sin congelamiento"}</p>
                </div>

                <div class="cotizacion-opciones">
                    ${opcionesPlan.map(renderDetalleOpcion).join("")}
                </div>

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

                <div class="cotizacion-comentario">
                    <p>
                        <b>Comentario:</b>
                        ${c.comentarios || "Sin comentarios"}
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

                <div class="cotizacion-acciones">
                    ${(c.vendedora === obtenerPayload().usuario || esAdmin()) ? `
                        <button
                            onclick="abrirModal(${c.id}, \`${comentarioModal}\`)"
                        >
                            Editar comentario
                        </button>
                    ` : ""}

                    ${opcionesPlan.map(opcion => `
                        <button
                            onclick="descargarPDF(${c.id}, ${opcion.numero_opcion})"
                            style="display:flex;align-items:center;gap:8px;"
                        >
                            <img
                                class="icono-menu"
                                src="img/imgicon-pdf.png"
                                alt=""
                            >
                            <span>Descargar PDF opci&oacute;n ${opcion.numero_opcion}</span>
                        </button>
                    `).join("")}

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

        </div>
    `;
}
let busquedaCotizacionActual = 0;

function normalizarTelefono(valor) {
    let numero = String(valor || "").replace(/\D/g, "");

    if (!numero) return "";

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

    return numero;
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

    data.forEach(c => {
        cargarArchivos(c.id);
        cargarComentarios(c.id);
    });
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

        data.forEach(c => {
            cargarArchivos(c.id);
            cargarComentarios(c.id);
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
        const ruta = `/uploads/${encodeURIComponent(a.archivo)}`;

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
            const ruta = `/uploads/${encodeURIComponent(a.archivo)}`;

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

                <b>${c.usuario}</b>

                <small>
                    ${formatearFecha(c.fecha)}
                </small>

                <p>${c.comentario}</p>

            </div>
        `;
    });
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


async function descargarPDF(id, numeroOpcion = 1) {

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

    adjuntos.forEach(archivo => {
        formData.append("imagenes", archivo);
    });

    mostrarLoader();

    try {
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

function abrirModal(id, comentario) {
    comentarioId = id;
    document.getElementById("modalComentario").value = comentario;
    document.getElementById("modal").style.display = "flex";
}

function cerrarModalComentario() {
    document.getElementById("modal").style.display = "none";
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
        cerrarModalComentario();
        buscar();
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
// INIT
// =======================

window.onload = function () {
    const token = localStorage.getItem("token");

    if (!token) {
        window.location.href = "/login.html";
        return;
    }

    const payload = obtenerPayload();

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

    cargarUsuarios();
    calcularIMCAutomatico();
    calcularIMCPediatrico();
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

    const res = await fetch(`/cotizaciones/${id}/seguimiento`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
            estado,
            fecha_seguimiento: fechaSeguimiento
        })
    });

    if (await manejarError(res)) return;

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "No se pudo guardar el seguimiento", "error");
        return;
    }

    mostrarToast("Seguimiento actualizado", "success");

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
                    clases: "historial-card"
                });

                cargarArchivos(c.id, `archivos-${sufijo}`);
                cargarComentarios(c.id, `comentarios-${sufijo}`);
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
            clases: "historial-card"
        })).join("")}

                </div>

            </div>
        `;

        cotizaciones.forEach(c => {
            const sufijo = `mis-vendedora-${c.id}`;

            cargarArchivos(c.id, `archivos-${sufijo}`);
            cargarComentarios(c.id, `comentarios-${sufijo}`);
        });
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
});
