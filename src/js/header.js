import { getMeta, setMeta, getStateSlug } from "./store.js";
import { getBoardName, getActiveSlug } from "./boardselector.js";
import { denyReadOnly } from "./sync.js";

let onHeaderChangedCallback = null;

export function renderHeader() {
  const meta = getMeta();

  const eyebrowEl = document.getElementById("headerEyebrow");
  const titleEl = document.getElementById("headerTitle");
  const titleThinEl = document.getElementById("headerTitleThin");
  const subtitleEl = document.getElementById("headerSubtitle");
  const branchEl = document.getElementById("branchTag");

  if (eyebrowEl) eyebrowEl.textContent = meta.eyebrow || "";
  if (titleEl) titleEl.textContent = meta.title || "";
  if (titleThinEl) titleThinEl.textContent = meta.titleThin ? ` ${meta.titleThin}` : "";
  if (subtitleEl) subtitleEl.textContent = meta.subtitle || "";
  if (branchEl) branchEl.textContent = meta.branch || "";

  updateDocumentTitle();
}

// El título de la ventana lleva el nombre del tablero activo: con varias
// pestañas abiertas es lo único que las distingue en la barra del navegador.
// Se toma el tablero del estado en memoria (por pestaña), no el "activo"
// global, que lo comparten todas las pestañas del mismo navegador.
export function updateDocumentTitle() {
  const slug = getStateSlug() || getActiveSlug();
  const name = (slug && getBoardName(slug)) || (getMeta().title || "");
  document.title = name ? name + " · Kanban Lite" : "Kanban Lite";
}

export function initHeader(onChanged) {
  onHeaderChangedCallback = onChanged;

  const editBtn = document.getElementById("editHeaderBtn");
  const overlay = document.getElementById("headerOverlay");
  const closeBtn = document.getElementById("headerClose");
  const cancelBtn = document.getElementById("headerCancel");
  const saveBtn = document.getElementById("headerSave");

  if (editBtn) editBtn.addEventListener("click", openHeaderModal);
  if (closeBtn) closeBtn.addEventListener("click", closeHeaderModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeHeaderModal);

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeHeaderModal();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeHeaderModal();
    }
  });

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      const eyebrow = document.getElementById("inputHeaderEyebrow")?.value.trim();
      const title = document.getElementById("inputHeaderTitle")?.value.trim();
      const titleThin = document.getElementById("inputHeaderTitleThin")?.value.trim();
      const subtitle = document.getElementById("inputHeaderSubtitle")?.value.trim();
      const branch = document.getElementById("inputHeaderBranch")?.value.trim();

      setMeta({
        eyebrow: eyebrow || "Sala de Situación",
        title: title || "Mi Tablero",
        titleThin: titleThin || "",
        subtitle: subtitle || "",
        branch: branch || "main"
      }, true);

      renderHeader();
      closeHeaderModal();

      if (typeof onHeaderChangedCallback === "function") {
        onHeaderChangedCallback();
      }
    });
  }

  renderHeader();
}

export function openHeaderModal() {
  if (denyReadOnly("No se puede personalizar el encabezado")) return;
  const meta = getMeta();
  const overlay = document.getElementById("headerOverlay");

  const inputEyebrow = document.getElementById("inputHeaderEyebrow");
  const inputTitle = document.getElementById("inputHeaderTitle");
  const inputTitleThin = document.getElementById("inputHeaderTitleThin");
  const inputSubtitle = document.getElementById("inputHeaderSubtitle");
  const inputBranch = document.getElementById("inputHeaderBranch");

  if (inputEyebrow) inputEyebrow.value = meta.eyebrow || "";
  if (inputTitle) inputTitle.value = meta.title || "";
  if (inputTitleThin) inputTitleThin.value = meta.titleThin || "";
  if (inputSubtitle) inputSubtitle.value = meta.subtitle || "";
  if (inputBranch) inputBranch.value = meta.branch || "";

  if (overlay) {
    overlay.classList.add("open");
    if (inputTitle) inputTitle.focus();
  }
}

export function closeHeaderModal() {
  const overlay = document.getElementById("headerOverlay");
  if (overlay) overlay.classList.remove("open");
}
