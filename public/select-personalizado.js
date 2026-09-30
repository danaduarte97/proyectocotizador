let selectPersonalizadoActivo = null;
let menuSelectPersonalizado = null;
let contadorSelectPersonalizado = 0;

function cerrarSelectPersonalizado(devolverFoco = false) {
    if (!menuSelectPersonalizado) return;

    const boton = selectPersonalizadoActivo?._selectPersonalizadoBoton;
    menuSelectPersonalizado.remove();
    menuSelectPersonalizado = null;
    selectPersonalizadoActivo = null;
    boton?.setAttribute("aria-expanded", "false");
    boton?.removeAttribute("aria-controls");
    if (devolverFoco) boton?.focus();
}

function sincronizarSelectPersonalizado(select) {
    const boton = select?._selectPersonalizadoBoton;
    const opcion = select?.selectedOptions?.[0];
    if (!boton || !opcion) return;

    boton.querySelector(".select-personalizado-texto").textContent = opcion.textContent.trim();
    boton.disabled = select.disabled;
}

function enfocarOpcionSelect(menu, indice) {
    const opciones = [...menu.querySelectorAll("[role='option']:not(:disabled)")];
    if (!opciones.length) return;
    opciones[Math.max(0, Math.min(indice, opciones.length - 1))].focus();
}

function abrirSelectPersonalizado(select) {
    if (selectPersonalizadoActivo === select) {
        cerrarSelectPersonalizado(true);
        return;
    }

    cerrarSelectPersonalizado();
    const boton = select._selectPersonalizadoBoton;
    const rect = boton.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.id = `select-personalizado-menu-${++contadorSelectPersonalizado}`;
    menu.className = "select-personalizado-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || "Opciones");

    [...select.options].forEach((opcion, indice) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "select-personalizado-opcion";
        item.textContent = opcion.textContent.trim();
        item.dataset.indice = String(indice);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(opcion.selected));
        item.disabled = opcion.disabled;
        if (opcion.selected) item.classList.add("seleccionada");
        item.addEventListener("click", () => {
            select.selectedIndex = indice;
            sincronizarSelectPersonalizado(select);
            cerrarSelectPersonalizado(true);
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        menu.appendChild(item);
    });

    document.body.appendChild(menu);
    const ancho = Math.max(rect.width, 190);
    const altoDisponibleAbajo = window.innerHeight - rect.bottom - 12;
    const altoDisponibleArriba = rect.top - 12;
    const abrirArriba = altoDisponibleAbajo < 220 && altoDisponibleArriba > altoDisponibleAbajo;
    const altoMaximo = Math.max(140, Math.min(320, abrirArriba ? altoDisponibleArriba : altoDisponibleAbajo));
    menu.style.width = `${Math.min(ancho, window.innerWidth - 24)}px`;
    menu.style.maxHeight = `${altoMaximo}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12)}px`;
    menu.style.top = abrirArriba
        ? `${Math.max(12, rect.top - menu.offsetHeight - 6)}px`
        : `${rect.bottom + 6}px`;

    selectPersonalizadoActivo = select;
    menuSelectPersonalizado = menu;
    boton.setAttribute("aria-expanded", "true");
    boton.setAttribute("aria-controls", menu.id);

    menu.addEventListener("keydown", event => {
        const opciones = [...menu.querySelectorAll("[role='option']:not(:disabled)")];
        const actual = opciones.indexOf(document.activeElement);
        if (event.key === "ArrowDown") {
            event.preventDefault();
            enfocarOpcionSelect(menu, actual + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            enfocarOpcionSelect(menu, actual - 1);
        } else if (event.key === "Home") {
            event.preventDefault();
            enfocarOpcionSelect(menu, 0);
        } else if (event.key === "End") {
            event.preventDefault();
            enfocarOpcionSelect(menu, opciones.length - 1);
        } else if (["Enter", " "].includes(event.key) && actual >= 0) {
            event.preventDefault();
            opciones[actual].click();
        } else if (event.key === "Escape" || event.key === "Tab") {
            cerrarSelectPersonalizado(event.key === "Escape");
        }
    });

    const seleccionada = menu.querySelector(".seleccionada");
    (seleccionada || menu.querySelector("[role='option']:not(:disabled)"))?.focus();
}

function mejorarSelectPersonalizado(select) {
    if (select.dataset.selectPersonalizadoListo === "true") return;

    select.dataset.selectPersonalizadoListo = "true";
    select.classList.add("select-personalizado-original");
    select.tabIndex = -1;
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "select-personalizado-trigger";
    boton.innerHTML = `
        <span class="select-personalizado-texto"></span>
        <span class="select-personalizado-flecha" aria-hidden="true"></span>
    `;
    boton.setAttribute("aria-haspopup", "listbox");
    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-label", select.getAttribute("aria-label") || "Seleccionar opción");
    boton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        abrirSelectPersonalizado(select);
    });
    boton.addEventListener("keydown", event => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            abrirSelectPersonalizado(select);
        }
    });
    select.insertAdjacentElement("afterend", boton);
    select._selectPersonalizadoBoton = boton;
    select.addEventListener("change", () => sincronizarSelectPersonalizado(select));
    new MutationObserver(() => sincronizarSelectPersonalizado(select)).observe(select, {
        childList: true,
        subtree: true,
        attributes: true
    });
    sincronizarSelectPersonalizado(select);
}

function inicializarSelectoresPersonalizados(raiz = document) {
    raiz.querySelectorAll?.("select[data-select-personalizado]").forEach(mejorarSelectPersonalizado);
}

function prepararSelectoresPersonalizados() {
    inicializarSelectoresPersonalizados();
    new MutationObserver(cambios => {
        cambios.forEach(cambio => cambio.addedNodes.forEach(nodo => {
            if (nodo.nodeType !== Node.ELEMENT_NODE) return;
            if (nodo.matches?.("select[data-select-personalizado]")) mejorarSelectPersonalizado(nodo);
            inicializarSelectoresPersonalizados(nodo);
        }));
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", event => {
        if (!menuSelectPersonalizado?.contains(event.target)) cerrarSelectPersonalizado();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && menuSelectPersonalizado) cerrarSelectPersonalizado(true);
    });
    window.addEventListener("resize", () => cerrarSelectPersonalizado());
    document.addEventListener("scroll", event => {
        if (menuSelectPersonalizado?.contains(event.target)) return;
        cerrarSelectPersonalizado();
    }, true);
}
