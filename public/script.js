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
            <div class="card">
                <p><b>Fecha:</b> ${new Date(c.fecha).toLocaleString()}</p>
                <p><b>Vendedora:</b> ${c.vendedora}</p>
                <p><b>Plan:</b> ${c.plan}</p>
                <p><b>💲 Valor:</b> $${c.valor}</p>

                <button onclick="abrirModal(${c.id}, \`${c.comentarios || ""}\`)">
                    Editar comentario
                </button>
            </div>
        `;
    });
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
        valor: document.getElementById("valor").value,
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
}