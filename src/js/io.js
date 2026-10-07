import { SEED_REV, DEFAULT_META, normalizeStamps, normalizeCols } from "./config.js";
import { getState, setState, pushHistory, applyMigrations } from "./store.js";
import { resetFilters } from "./filters.js";
import { showToast } from "./toast.js";
import { denyReadOnly } from "./sync.js";
import { tstamp, clone } from "./utils.js";

let onIoStateChangedCallback = null;

export function initDataModals(onChanged) {
  onIoStateChangedCallback = onChanged;

  const dataOverlay = document.getElementById("dataOverlay");
  const dataBtn = document.getElementById("dataBtn");
  const dataClose = document.getElementById("dataClose");

  if (dataBtn) dataBtn.addEventListener("click", openData);
  if (dataClose) dataClose.addEventListener("click", closeData);

  if (dataOverlay) {
    dataOverlay.addEventListener("mousedown", function (ev) {
      if (ev.target === dataOverlay) closeData();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && dataOverlay && dataOverlay.classList.contains("open")) {
      closeData();
    }
  });

  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) copyBtn.addEventListener("click", copyToClipboard);

  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) downloadBtn.addEventListener("click", downloadJson);

  const importFile = document.getElementById("importFile");
  if (importFile) importFile.addEventListener("change", handleFileSelect);

  const importBtn = document.getElementById("importBtn");
  if (importBtn) importBtn.addEventListener("click", handleImport);

  // Reset button is managed by app.js (opens board selector)
}

export function exportPayload() {
  const state = getState();
  return {
    app: "kanban-lite",
    rev: state.rev || SEED_REV,
    exported: new Date().toISOString(),
    meta: state.meta || clone(DEFAULT_META),
    ws: state.ws,
    cards: state.cards,
    cols: state.cols
  };
}

export function openData() {
  const exportBox = document.getElementById("exportBox");
  const importBox = document.getElementById("importBox");
  const dataOverlay = document.getElementById("dataOverlay");

  if (exportBox) exportBox.value = JSON.stringify(exportPayload(), null, 2);
  if (importBox) importBox.value = "";
  setText("copyMsg", "");
  setImportMsg("", false);
  if (dataOverlay) dataOverlay.classList.add("open");
}

export function closeData() {
  const dataOverlay = document.getElementById("dataOverlay");
  if (dataOverlay) dataOverlay.classList.remove("open");
}

function setText(id, txt) {
  const e = document.getElementById(id);
  if (e) e.textContent = txt;
}

function setImportMsg(txt, err) {
  const e = document.getElementById("importMsg");
  if (e) {
    e.textContent = txt;
    e.classList.toggle("err", !!err);
  }
}

function copyToClipboard() {
  const box = document.getElementById("exportBox");
  if (!box) return;
  box.focus();
  box.select();
  const done = function () {
    setText("copyMsg", "✓ Copiado");
    setTimeout(function () { setText("copyMsg", ""); }, 2500);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(done, function () {
        try {
          document.execCommand("copy");
          done();
        } catch (e) {
          setText("copyMsg", "Selecciona y Ctrl/Cmd+C");
        }
      });
    } else {
      document.execCommand("copy");
      done();
    }
  } catch (e) {
    setText("copyMsg", "Selecciona y Ctrl/Cmd+C");
  }
}

function downloadJson() {
  saveDownload({
    name: "kanban-" + tstamp() + ".json",
    content: JSON.stringify(exportPayload(), null, 2),
    mime: "application/json",
    notify: function (msg, kind, ms) {
      setText("copyMsg", msg);
      if (msg && kind !== "error") setTimeout(function () { setText("copyMsg", ""); }, ms || 2500);
    },
    fallbackMsg: "Descarga no disponible: usa Copiar"
  });
}

export function saveDownload(opts) {
  downloadBlob(opts);
}

function downloadBlob(opts) {
  const notify = opts.notify || function () {};
  try {
    const blob = new Blob([opts.content], { type: opts.mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = opts.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    notify(opts.okMsg || "", "success");
  } catch (e) {
    notify(opts.fallbackMsg || "Descarga no disponible aquí", "error", 4000);
  }
}

// -- Copia de la aplicación para usarla sin conexión ------------------------
//
// El artefacto de producción es un archivo único y autocontenido, así que la
// copia offline es literalmente el archivo que se está ejecutando: se vuelve a
// pedir a su propia URL en vez de serializar el DOM vivo. Serializarlo metería
// en el archivo el tablero de quien lo descarga —y ese archivo se comparte—,
// además de las tarjetas ya pintadas. El estado vive en localStorage, no en el
// HTML, de modo que la copia limpia arranca vacía y sin datos de nadie.
export async function downloadOfflineApp() {
  showToast("Preparando la copia offline…", "info");

  let html = null;
  try {
    const r = await fetch(window.location.href, { cache: "no-store" });
    if (r.ok) {
      const texto = await r.text();
      // Comprobación mínima de que lo servido es la app y no un portal de
      // acceso, un error de un proxy o una página de mantenimiento.
      if (texto.includes('id="board"') && texto.includes("</html>")) html = texto;
    }
  } catch (e) {
    // Sin red o con `file://` (donde Chrome bloquea fetch): se usa el respaldo.
  }

  if (!html) html = snapshotDocument();

  saveDownload({
    name: "kanban.html",
    content: html,
    mime: "text/html",
    okMsg: "",
    notify: function (msg, kind, ms) {
      if (msg) showToast(msg, kind === "info" ? "info" : kind, ms);
    },
    fallbackMsg: "No se pudo descargar la copia offline aquí"
  });

  showToast("Copia offline lista: guárdala y ábrela con doble clic", "success", 5000);
}

// Respaldo cuando no se puede releer el archivo (típicamente `file://`): se
// clona el documento y se vacía todo lo que se pintó desde el estado, para que
// la copia no lleve dentro el tablero de quien la descarga.
function snapshotDocument() {
  const clon = document.documentElement.cloneNode(true);

  clon.querySelectorAll(".overlay.open").forEach(function (o) { o.classList.remove("open"); });
  ["board", "stats", "wsFilters", "prFilters", "trashList", "logList", "pasteList",
   "boardsList", "deletedBoards", "serversList", "cdComments", "cdLabels", "cdDesc",
   "metricsBody", "exportBox", "importBox"].forEach(function (id) {
    const el = clon.querySelector("#" + id);
    if (el) el.innerHTML = "";
  });
  clon.querySelectorAll("input, textarea").forEach(function (el) {
    if (el.type === "checkbox" || el.type === "radio") el.checked = false;
    else el.removeAttribute("value");
  });

  return "<!doctype html>\n" + clon.outerHTML;
}

function handleFileSelect(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = function () {
    const importBox = document.getElementById("importBox");
    if (importBox) importBox.value = rd.result;
    setImportMsg("Archivo cargado — pulsa «Importar y reemplazar».", false);
  };
  rd.onerror = function () {
    setImportMsg("No se pudo leer el archivo.", true);
  };
  rd.readAsText(f);
  ev.target.value = "";
}

function handleImport() {
  if (denyReadOnly("No se importó nada")) return;
  const importBox = document.getElementById("importBox");
  const txt = importBox ? importBox.value.trim() : "";
  if (!txt) {
    setImportMsg("Pega el JSON o elige un archivo primero.", true);
    return;
  }
  let data;
  try {
    data = JSON.parse(txt);
  } catch (e) {
    setImportMsg("JSON inválido: " + e.message, true);
    return;
  }
  const cards = data.cards;
  const ws = data.ws;
  if (!Array.isArray(cards) || !Array.isArray(ws) || !ws.length) {
    setImportMsg("El JSON debe traer un arreglo 'cards' y un arreglo 'ws' con al menos un frente.", true);
    return;
  }
  const okCards = cards.every(function (c) { return c && c.id && c.col && c.ws; });
  const okWs = ws.every(function (w) { return w && w.key && w.label && w.color; });
  if (!okCards || !okWs) {
    setImportMsg("Estructura de tarjetas/frentes incompleta.", true);
    return;
  }

  pushHistory();
  // Se migra al importar, no sólo al cargar de localStorage: un respaldo de
  // una revisión anterior entraría en memoria sin los campos que la interfaz
  // ya espera (etiquetas, comentarios) hasta la siguiente recarga.
  // normalizeStamps además de applyMigrations: un respaldo que ya declare la
  // revisión al día pero venga sin sellos (editado a mano, o exportado de un
  // tablero de otra persona) no dispararía ningún parche y entraría sin
  // fechas.
  const imported = {
    meta: data.meta || clone(DEFAULT_META),
    cards: cards,
    ws: ws,
    rev: data.rev || SEED_REV
  };
  if (Array.isArray(data.cols)) imported.cols = normalizeCols(data.cols);
  setState(normalizeStamps(applyMigrations(imported)), true);

  resetFilters();
  if (typeof onIoStateChangedCallback === "function") {
    onIoStateChangedCallback();
  }
  setImportMsg("✓ Importado: " + cards.length + " tarea" + (cards.length === 1 ? "" : "s") + ", " + ws.length + " frente" + (ws.length === 1 ? "" : "s") + ".", false);
  showToast(`Tablero importado: ${cards.length} tareas`, "success");
  setTimeout(closeData, 1200);
}
