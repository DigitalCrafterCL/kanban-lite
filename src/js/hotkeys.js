import { undo, redo, canUndo, canRedo } from "./store.js";
import { showToast } from "./toast.js";
import { pasteFromClipboard } from "./paste.js";
import { toggleHeadMenu } from "./headmenu.js";
import { denyReadOnly } from "./sync.js";

let onHotkeysStateChangedCallback = null;

export function initHotkeys(onChanged) {
  onHotkeysStateChangedCallback = onChanged;

  const hotkeysOverlay = document.getElementById("hotkeysOverlay");
  const hotkeysBtn = document.getElementById("hotkeysBtn");
  const hotkeysClose = document.getElementById("hotkeysClose");

  if (hotkeysBtn) {
    hotkeysBtn.addEventListener("click", openHotkeysModal);
  }
  if (hotkeysClose) {
    hotkeysClose.addEventListener("click", closeHotkeysModal);
  }

  if (hotkeysOverlay) {
    hotkeysOverlay.addEventListener("mousedown", function (ev) {
      if (ev.target === hotkeysOverlay) closeHotkeysModal();
    });
  }

  document.addEventListener("keydown", function (ev) {
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT" || activeEl.isContentEditable);

    // 1. Undo: Ctrl+Z o Cmd+Z (sin Shift)
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "z" || ev.key === "Z") && !ev.shiftKey) {
      if (!isInputActive || isInsideEditForm(activeEl)) {
        if (denyReadOnly("No se deshizo nada")) return;
        if (canUndo()) {
          ev.preventDefault();
          undo();
          if (typeof onHotkeysStateChangedCallback === "function") onHotkeysStateChangedCallback();
          showToast("Acción deshecha", "info");
        }
      }
      return;
    }

    // 2. Redo: Ctrl+Y o Cmd+Shift+Z
    if (((ev.ctrlKey || ev.metaKey) && (ev.key === "y" || ev.key === "Y")) ||
        ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "z" || ev.key === "Z"))) {
      if (!isInputActive || isInsideEditForm(activeEl)) {
        if (denyReadOnly("No se rehizo nada")) return;
        if (canRedo()) {
          ev.preventDefault();
          redo();
          if (typeof onHotkeysStateChangedCallback === "function") onHotkeysStateChangedCallback();
          showToast("Acción rehecha", "info");
        }
      }
      return;
    }

    // Si estamos escribiendo en un input, ignorar atajos de un solo carácter
    if (isInputActive) {
      if (ev.key === "Escape") {
        activeEl.blur();
      }
      return;
    }

    // 3. Buscar: '/'
    if (ev.key === "/") {
      ev.preventDefault();
      const searchInput = document.getElementById("searchInput");
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // 4. Ayuda de atajos: '?'
    if (ev.key === "?") {
      ev.preventDefault();
      openHotkeysModal();
      return;
    }

    // 5. Nueva tarea: 'n' o 'N'. Entra en Backlog: una idea recién capturada
    // todavía no está comprometida para el ciclo actual.
    if (ev.key === "n" || ev.key === "N") {
      ev.preventDefault();
      const targetCol = document.querySelector('[data-col="backlog"] .add-btn') || document.querySelector('[data-col="todo"] .add-btn') || document.querySelector('.add-btn');
      if (targetCol) {
        targetCol.click();
        const firstInput = document.querySelector('.add-form.open .f-title');
        if (firstInput) firstInput.focus();
      }
      return;
    }

    // 6. Pegar tarjetas desde el portapapeles: 'v' o 'V'. Ctrl/Cmd+V llega
    // como evento 'paste' y lo atiende paste.js sin pedir permisos.
    // Con Ctrl/Cmd pulsado no: eso es el pegado nativo, que ya llega como
    // evento 'paste'. Atenderlo aquí abriría el modal dos veces.
    if ((ev.key === "v" || ev.key === "V") && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      pasteFromClipboard();
      return;
    }

    // 7. Menú de la aplicación: 'm' o 'M'. Con las herramientas dentro de un
    // desplegable, el teclado necesita una forma de llegar a ellas.
    if ((ev.key === "m" || ev.key === "M") && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      toggleHeadMenu();
      return;
    }

    // 8. Escape: cerrar modales abiertos
    if (ev.key === "Escape") {
      closeHotkeysModal();
    }
  });
}

function isInsideEditForm(el) {
  return Boolean(el && el.closest && (el.closest(".edit-form") || el.closest(".add-form")));
}

export function openHotkeysModal() {
  const overlay = document.getElementById("hotkeysOverlay");
  if (overlay) overlay.classList.add("open");
}

export function closeHotkeysModal() {
  const overlay = document.getElementById("hotkeysOverlay");
  if (overlay) overlay.classList.remove("open");
}
