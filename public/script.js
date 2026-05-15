console.log("JS CARGADO");

// =======================
// 🔐 TOKEN / AUTH
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

// 🔐 HEADERS CON TOKEN (Bearer)
function authHeaders(extra = {}) {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...extra
    };
}

// 🚨 SI NO HAY TOKEN → LOGIN
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
                        <button onclick="editarUsuario(${user.id})">✏️</button>
                    ` : ""}

                    ${esAdmin() && user.usuario !== "admin" ? `
                        <button onclick="eliminarUsuario(${user.id})">🗑️</button>
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

    if (!confirm("¿Seguro que querés eliminar este usuario?")) return;

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

    // corregir UTC → Argentina
    f.setHours(f.getHours() - 3);

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

// =======================
// 🔍 BUSCAR
// =======================

async function buscar() {
    const dni = document.getElementById("dni").value;

    if (!dni) {
        alert("Ingresá un DNI");
        return;
    }

    const res = await fetch(`/buscar/${dni}`, {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    const div = document.getElementById("resultados");
    div.innerHTML = "";

    if (data.length === 0) {
        div.innerHTML = "<p>No hay cotizaciones</p>";
        return;
    }

    document.getElementById("nombre").value = data[0].nombre || "";
    document.getElementById("celular").value = data[0].celular || "";

    data.forEach(c => {

        div.innerHTML += `
        <div class="card" id="card-${c.id}">

            <!-- SOLO PDF -->
            <div class="pdf-header solo-pdf">

                <img
                    src="/img/logo-asismed.jpg"
                    class="logo-pdf"
                >
  <h2 class="titulo-pdf">
                    
                </h2>
            </div>

            <!-- DECORACIÓN -->
            <div class="pdf-decoracion solo-pdf"></div>

            <p class="fecha-card">
                🕒 ${formatearFecha(c.fecha)}
            </p>
            <p><b>DNI:</b> ${c.dni}</p>
            <p> <b>Teléfono:</b> ${c.celular || "-"}</p>

            <p><b>Asesora:</b> ${c.vendedora}</p>

            <p><b>Plan:</b> ${c.plan}</p>
            <p>
            
            <b>Cobertura:</b> ${c.tipo_cobertura || "Individual"} </p>
            

            <p><b>Valor:</b> $${c.valor}</p>
            <p>
    <b>Modalidad:</b>
    ${c.modalidad || "PARTICULAR"}
</p>

            <!-- NO PDF -->
            <p class="no-pdf">
                <b>💬 Comentario:</b>
                ${c.comentarios || "Sin comentarios"}
            </p>

            <!-- NO PDF -->
            <div class="archivos-box no-pdf">

                <h4>📎 Adjuntos</h4>

                <input
                    type="file"
                    onchange="subirArchivo(event, ${c.id})"
                >

                <div id="archivos-${c.id}"></div>

            </div>

            ${(c.vendedora === obtenerPayload().usuario || esAdmin()) ? `
                <button
                    class="no-pdf"
                    onclick="abrirModal(${c.id}, \`${c.comentarios || ""}\`)"
                >
                    Editar comentario
                </button>
            ` : ""}

            <button
                class="no-pdf"
                onclick="descargarPDF(${c.id})"
            >
                📄 Descargar PDF
            </button>

        </div>
    `;

        cargarArchivos(c.id);
    });
}

async function subirArchivo(event, cotizacionId) {

    const file = event.target.files[0];

    if (!file) return;

    const formData = new FormData();
    formData.append("archivo", file);

    const token = localStorage.getItem("token");

    const res = await fetch(`/subir-archivo/${cotizacionId}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: formData
    });

    if (res.ok) {
        mostrarToast("Archivo subido", "success");
        buscar();
    } else {
        mostrarToast("Error al subir", "error");
    }
}
async function cargarArchivos(cotizacionId) {

    const res = await fetch(`/archivos/${cotizacionId}`, {
        headers: authHeaders()
    });

    const archivos = await res.json();

    const div = document.getElementById(`archivos-${cotizacionId}`);

    div.innerHTML = "";

    archivos.forEach(a => {

        div.innerHTML += `
            <a href="/uploads/${a.archivo}" target="_blank">
                📎 ${a.nombre}
            </a><br>
        `;
    });
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

    const canvas = await html2canvas(card, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
    });

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
    const data = {
        dni: document.getElementById("dni").value,
        nombre: document.getElementById("nombre").value,
        celular: document.getElementById("celular").value,
        plan: document.getElementById("plan").value,
        tipo_cobertura:
            document.getElementById("tipoCobertura").value,
        valor: document.getElementById("valor").value,
        modalidad:
            document.getElementById("modalidad").value,
        comentarios: document.getElementById("comentarios").value
    };

    const res = await fetch("/agregar", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(data)
    });

    if (await manejarError(res)) return;

    if (res.ok) {
        mostrarToast("Guardado", "success");

        document.getElementById("nombre").value = "";
        document.getElementById("celular").value = "";
        document.getElementById("plan").value = "";
        document.getElementById("valor").value = "";
        document.getElementById("comentarios").value = "";

        buscar();
    } else {
        mostrarToast("Error", "error");
    }
}

// =======================
// 💬 COMENTARIOS
// =======================

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
// ✏️ EDITAR USUARIO
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
// 🔐 INIT
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
        user.textContent = "👤 " + payload.usuario;
    }

    // si NO es admin oculta botón usuarios
    if (!esAdmin()) {
        const btnUsuarios = document.querySelector("button[onclick*='usuarios']");
        if (btnUsuarios) btnUsuarios.style.display = "none";
    }

    cargarUsuarios();
};

// =======================
// 🚪 LOGOUT
// =======================

function logout() {
    localStorage.clear();
    window.location.href = "/login.html";
}

// =======================
// 🔔 TOAST
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

    // si es usuarios → cargar lista
    if (seccion === "usuarios") {
        cargarUsuarios();
    }
    if (seccion === "misCotizaciones") {

        const titulo =
            esAdmin()
                ? "📋 Cotizaciones generales"
                : "📂 Mis cotizaciones";

        document.getElementById(
            "tituloCotizaciones"
        ).textContent = titulo;

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
        el.textContent = "👁️";

    } else {

        input.type = "password";
        el.textContent = "🙈";
    }
}

async function cargarMisCotizaciones() {

    const res = await fetch("/mis-cotizaciones", {
        headers: authHeaders()
    });

    if (await manejarError(res)) return;

    const data = await res.json();

    const div = document.getElementById("misResultados");

    div.innerHTML = "";

    if (data.length === 0) {

        div.innerHTML =
            "<p>No cargaste cotizaciones todavía</p>";

        return;
    }

    // AGRUPAR POR DNI
    const agrupadas = {};

    data.forEach(c => {

        if (!agrupadas[c.dni]) {
            agrupadas[c.dni] = [];
        }

        agrupadas[c.dni].push(c);
    });

    // CREAR TARJETAS
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
                    📂 Ver historial
                </button>

                <div
                    id="historial-${dni}"
                    style="
                        display:none;
                        margin-top:15px;
                    "
                >

                    ${cotizaciones.map(c => `

                        <div class="card historial-card">

                            <p>
                                🕒 ${formatearFecha(c.fecha)}
                            </p>

                            <p>
                                <b>Plan:</b>
                                ${c.plan || "-"}
                            </p>

                            <p>
                                <b>Cobertura:</b>
                                ${c.tipo_cobertura || "-"}
                            </p>

                            <p>
                                <b>Modalidad:</b>
                                ${c.modalidad || "-"}
                            </p>

                            <p>
                                <b>Valor:</b>
                                $${c.valor || "-"}
                            </p>

                            <p>
                                <b>💬 Comentario:</b>
                                ${c.comentarios || "-"}
                            </p>

                        </div>

                    `).join("")}

                </div>

            </div>
        `;
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