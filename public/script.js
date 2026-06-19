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


function mostrarLoader() {

    document.getElementById(
        "loaderGlobal"
    ).style.display = "flex";
}

function ocultarLoader() {

    document.getElementById(
        "loaderGlobal"
    ).style.display = "none";
}


// =======================
// 👥 USUARIOS
// =======================

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

    const contenedor = document.getElementById("listaUsuarios");
    contenedor.innerHTML = "";

    usuarios.forEach(user => {
        contenedor.innerHTML += `
            <div class="card-user">
                <div>
                    <strong>${user.usuario}</strong>
                    <span class="badge ${user.rol}">${user.rol}</span>
                </div>

                <div>
                    ${esAdmin() ? `
                        <button onclick="editarUsuario(${user.id})">Editar</button>
                    ` : ""}

                    ${esAdmin() && user.usuario !== "admin" ? `
                        <button onclick="eliminarUsuario(${user.id})">Eliminar</button>
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
    "Perdido"
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
    return ESTADOS_COTIZACION.map(estado => `
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
    const clases = opciones.clases || "";
    const comentarioModal = String(c.comentarios || "")
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$");
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
                        <p class="pdf-eyebrow">COTIZACION</p>
                        <h1>${c.nombre || ""}</h1>
                        <p class="pdf-subtitulo">
                            DNI ${c.dni} &nbsp;|&nbsp; Tel. ${c.celular || "-"}
                        </p>
                    </div>

                    <table class="pdf-tabla">
                        <thead>
                            <tr>
                                <th>Detalle</th>
                                <th>Informacion</th>
                                <th>Importe</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Plan</td>
                                <td>${c.plan || "-"}</td>
                                <td></td>
                            </tr>
                            <tr>
                                <td>Cobertura</td>
                                <td>${c.tipo_cobertura || "Individual"}</td>
                                <td></td>
                            </tr>
                            <tr>
                                <td>Modalidad</td>
                                <td>${c.modalidad || "PARTICULAR"}</td>
                                <td></td>
                            </tr>
                            <tr>
                                <td>Valor del plan</td>
                                <td></td>
                                <td>$ ${Number(c.valor || 0).toLocaleString("es-AR")}</td>
                            </tr>
                            <tr>
                                <td>Bonificacion comercial</td>
                                <td></td>
                                <td>- $ ${Number(c.bonificacion || 0).toLocaleString("es-AR")}</td>
                            </tr>
                            <tr>
                                <td>Bonificacion por aportes</td>
                                <td></td>
                                <td>- $ ${Number(c.bonificacion_aportes || 0).toLocaleString("es-AR")}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="pdf-total">
                        <span>Total a pagar</span>
                        <strong>
                            $ ${(
                                Number(c.valor || 0)
                                - Number(c.bonificacion || 0)
                                - Number(c.bonificacion_aportes || 0)
                            ).toLocaleString("es-AR")}
                        </strong>
                    </div>

                    <div class="pdf-info-adicional">
                        <p><b>Referido:</b> ${c.referido || "No"}</p>
                        <p><b>Congelamiento:</b> ${c.congelamiento || "Sin congelamiento"}</p>
                    </div>

                    <div class="pie-pdf">
                        <p><b>Fecha:</b> ${new Date(c.fecha).toLocaleDateString("es-AR")}</p>
                        <p><b>Vigencia:</b> ${c.vigencia || "-"}</p>
                        <p><b>Asesora comercial:</b> ${c.vendedora}</p>
                        <p><b>Contacto Asismed:</b> WhatsApp 11 3943-8158</p>
                    </div>

                    <p class="pdf-aclaracion">
                        La presente cotizacion queda sujeta a variaciones conforme a
                        actualizaciones, aumentos o ajustes autorizados por Asismed, o a
                        modificaciones de los datos personales informados. Los cambios
                        correspondientes seran aplicados en el mes que se indique.
                    </p>

                    <p class="pdf-identificador">Cotizacion N. ${c.id}</p>
                </div>
            </div>

            <div class="cotizacion-resumen no-pdf">
                <div class="cotizacion-resumen-datos">
                    <p class="fecha-card">
                        ${formatearFecha(c.fecha)}
                    </p>
                    <div class="cotizacion-resumen-grid">
                        <p><b>DNI:</b> ${c.dni}</p>
                        <p><b>Telefono:</b> ${c.celular || "-"}</p>
                        <p><b>Asesora:</b> ${c.vendedora}</p>
                        <p><b>Estado:</b> ${estadoActual}</p>
                        ${fechaSeguimientoResumen}
                    </div>
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
                    <p><b>Nombre:</b> ${c.nombre || "-"}</p>
                    <p><b>Plan:</b> ${c.plan || "-"}</p>
                    <p><b>Cobertura:</b> ${c.tipo_cobertura || "Individual"}</p>
                    <p><b>Valor:</b> $${c.valor || 0}</p>
                    <p><b>Bonificacion comercial:</b> $${c.bonificacion || 0}</p>
                    <p><b>Bonificacion por aportes:</b> $${c.bonificacion_aportes || 0}</p>
                    <p><b>Modalidad:</b> ${c.modalidad || "PARTICULAR"}</p>
                    <p><b>Valida hasta:</b> ${c.vigencia || "-"}</p>
                    <p><b>Referido:</b> ${c.referido || "No"}</p>
                    <p><b>Congelamiento:</b> ${c.congelamiento || "Sin congelamiento"}</p>
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

                    <button
                        onclick="descargarPDF(${c.id})"
                        style="display:flex;align-items:center;gap:8px;"
                    >
                        <img
                            class="icono-menu"
                            src="img/imgicon-pdf.png"
                            alt=""
                        >
                        <span>Descargar PDF</span>
                    </button>
                </div>
            </div>

        </div>
    `;
}
async function buscar() {
    const termino = document.getElementById("dni").value.trim();

    if (!termino) {
        mostrarToast("Ingresá un DNI o teléfono", "error");
        return;
    }
    mostrarLoader();
    const res = await fetch(`/buscar/${encodeURIComponent(termino)}`, {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const data = await res.json();
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
        dniCotizacion.value = data[0].dni || termino;
    }

    data.forEach(c => {
        div.innerHTML += renderTarjetaCotizacion(c);

        cargarArchivos(c.id);
        cargarComentarios(c.id);
    });
}

async function subirArchivo(event, cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

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

async function cargarArchivos(cotizacionId, contenedorId = `archivos-${cotizacionId}`) {

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


async function descargarPDF(id) {

    const card = document.getElementById(`card-${id}`);

    if (!card) {
        mostrarToast("No se encontró la cotización", "error");
        return;
    }

    // ocultar elementos
    const ocultos = card.querySelectorAll(".no-pdf");
    // mostrar elementos solo PDF
    const soloPdf = card.querySelectorAll(".solo-pdf");

    soloPdf.forEach(el => {
        el.style.display = "block";
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

    pdf.save(`cotizacion-${id}.pdf`);

    // restaurar card
    card.id = `card-${id}`;

    ocultos.forEach(el => {
        el.style.display = el.dataset.display || "";
    });
    soloPdf.forEach(el => {
        el.style.display = "none";
    });
    card.style.opacity = "";


}
// =======================
// ➕ AGREGAR
// =======================

async function agregar() {
    const adjuntoInput = document.getElementById("adjuntoCotizacion");
    const adjuntos = adjuntoInput ? [...adjuntoInput.files] : [];
    const dniCotizacionValor =
        document.getElementById("dniCotizacion").value ||
        document.getElementById("dni").value;
    const formData = new FormData();

    formData.append("dni", dniCotizacionValor);
    formData.append("nombre", document.getElementById("nombre").value);
    formData.append("celular", document.getElementById("celular").value);
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
        document.getElementById("valor").value = "";
        document.getElementById("comentarios").value = "";
        document.getElementById("tipoCobertura").selectedIndex = 0;
        document.getElementById("modalidad").selectedIndex = 0;
        document.getElementById("referido").checked = false;
        document.getElementById("congelamiento").value = "";
        document.getElementById("bonificacion").value = "";
        document.getElementById("bonificacionAportes").value = "";
        document.getElementById("vigencia").value = "";

        if (adjuntoInput) {
            adjuntoInput.value = "";
        }

        document.getElementById("dni").value = dniCotizacionValor;
        previsualizarAdjuntosCotizacion();
        actualizarTotalCotizacion();

        buscar();
    } else {
        const error = await res.json().catch(() => ({}));
        mostrarToast(error.error || "Error", "error");
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

    if (!totalEl) return;

    totalEl.textContent = `$ ${Math.max(total, 0).toLocaleString("es-AR")}`;
}

function inicializarTotalCotizacion() {
    ["valor", "bonificacion", "bonificacionAportes"].forEach(id => {
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

    usuarioEditando = id;
    document.getElementById("modalEditar").style.display = "flex";
}

function cerrarModalEditar() {
    document.getElementById("modalEditar").style.display = "none";
}

async function guardarEdicion() {
    const password = document.getElementById("editPassword").value;
    const rol = document.getElementById("editRol").value;

    const res = await fetch(`/usuarios/${usuarioEditando}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ password, rol })
    });

    if (await manejarError(res)) return;

    if (res.ok) {
        mostrarToast("Usuario actualizado", "success");
        cerrarModalEditar();
        cargarUsuarios();
    } else {
        mostrarToast("Error", "error");
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
                    | DNI ${c.dni}
                    | ${c.celular || "Sin telefono"}
                    | ${estadoCotizacion(c)}
                </span>
                <span>${c.vendedora || "-"}</span>
            </div>
        `).join("")}
    `;
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

async function cargarMisCotizaciones() {

    completarSelectEstados();

    const res = await fetch(`/mis-cotizaciones${filtrosCotizacionesQuery()}`, {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    const div =
        document.getElementById("misResultados");

    div.innerHTML = "";

    completarSelectAsesoras(data);
    renderSeguimientosHoy(data);

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

        if (!agrupadas[c.dni]) {
            agrupadas[c.dni] = [];
        }

        agrupadas[c.dni].push(c);
    });

    Object.keys(agrupadas).forEach(dni => {

        const cotizaciones = agrupadas[dni];

        const primera = cotizaciones[0];

        div.innerHTML += `

            <div class="card">

                <p>
                    <b>DNI:</b>
                    ${dni}
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
                    onclick="toggleHistorial('${dni}')"
                >
                    Ver historial
                </button>

                <div
                    id="historial-${dni}"
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
