// Bitácora de un tablero compartido: quién cambió qué y cuándo.
//
// Sólo tiene sentido con servidor: el histórico vive allí, porque es lo único
// que ve todas las ediciones del equipo. En un tablero local el botón ni
// siquiera aparece, y abrir la app sin servidores no dispara ninguna petición.

import { COLS } from "./config.js";
import { activeRemoteContext } from "./sync.js";
import { fetchBoardLog, isSessionValid, RemoteError } from "./remote.js";
import { esc } from "./utils.js";

const COL_NAMES = {};
COLS.forEach(function (c) { COL_NAMES[c.key] = c.name; });

const FIELD_NAMES = {
  t: "título",
  d: "descripción",
  ws: "frente",
  pri: "prioridad",
  col: "columna",
  labels: "etiquetas",
  due: "fecha de cierre",
  label: "nombre",
  color: "color",
  eyebrow: "epígrafe",
  title: "título",
  titleThin: "complemento",
  subtitle: "subtítulo",
  branch: "rama"
};

export function initBitacora() {
  const overlay = document.getElementById("logOverlay");
  const openBtn = document.getElementById("logBtn");
  const closeBtn = document.getElementById("logClose");
  const reloadBtn = document.getElementById("logReload");

  if (openBtn) openBtn.addEventListener("click", openBitacora);
  if (closeBtn) closeBtn.addEventListener("click", closeBitacora);
  if (reloadBtn) reloadBtn.addEventListener("click", loadBitacora);

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeBitacora();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeBitacora();
    }
  });

  updateBitacoraButton();
}

// El botón sólo existe para tableros compartidos. Se recalcula en cada
// refresco porque el tablero activo cambia bajo los pies de la interfaz.
export function updateBitacoraButton() {
  const btn = document.getElementById("logBtn");
  if (!btn) return;
  btn.hidden = !activeRemoteContext();
}

export function openBitacora() {
  const overlay = document.getElementById("logOverlay");
  if (!overlay) return;
  overlay.classList.add("open");
  loadBitacora();
}

export function closeBitacora() {
  const overlay = document.getElementById("logOverlay");
  if (overlay) overlay.classList.remove("open");
}

async function loadBitacora() {
  const list = document.getElementById("logList");
  const subtitle = document.getElementById("logSubtitle");
  if (!list) return;

  const ctx = activeRemoteContext();
  if (!ctx) {
    list.innerHTML = '<p class="bs-empty">Este tablero es local: no hay bitácora de equipo. ' +
      'Sólo los tableros compartidos registran quién cambió qué.</p>';
    return;
  }
  if (subtitle) {
    subtitle.textContent = ctx.entry.name + " · " + ctx.server.url;
  }
  if (!isSessionValid(ctx.server)) {
    list.innerHTML = '<p class="bs-empty err">Sesión expirada. Vuelve a conectarte desde ⊞ Tableros.</p>';
    return;
  }

  list.innerHTML = '<p class="bs-empty">Cargando bitácora…</p>';

  let data;
  try {
    data = await fetchBoardLog(ctx.server, ctx.remote.boardId, 50);
  } catch (err) {
    const offline = err instanceof RemoteError && err.isOffline;
    list.innerHTML = '<p class="bs-empty' + (offline ? "" : " err") + '">' +
      esc(offline
        ? "Sin conexión con el servidor. La bitácora vive allí, así que no se puede consultar sin red."
        : (err && err.message ? err.message : "No se pudo cargar la bitácora.")) + '</p>';
    return;
  }

  renderBitacora(list, data);
}

function renderBitacora(list, data) {
  const entries = (data && data.log) || [];
  list.innerHTML = "";

  if (!entries.length) {
    list.innerHTML = '<p class="bs-empty">Todavía no hay cambios registrados en este tablero.</p>';
    return;
  }

  for (const entry of entries) {
    list.appendChild(buildEntry(entry));
  }
}

function buildEntry(entry) {
  const box = document.createElement("div");
  box.className = "log-entry";

  const head = document.createElement("div");
  head.className = "log-head";
  head.innerHTML =
    '<span class="log-author">' + esc(entry.author || "alguien") + '</span>' +
    '<span class="log-when">' + esc(formatWhen(entry.at)) + '</span>' +
    '<span class="log-version">v' + esc(String(entry.version)) + '</span>';
  box.appendChild(head);

  const ul = document.createElement("ul");
  ul.className = "log-changes";
  for (const change of entry.changes || []) {
    const li = document.createElement("li");
    li.className = "log-change log-" + esc(change.action);
    li.innerHTML = '<span class="log-verb">' + esc(verbOf(change)) + '</span> ' + describe(change);
    ul.appendChild(li);
  }
  if (entry.omitted) {
    const li = document.createElement("li");
    li.className = "log-change log-more";
    li.textContent = "…y " + entry.omitted + " cambio" + (entry.omitted === 1 ? "" : "s") + " más";
    ul.appendChild(li);
  }
  box.appendChild(ul);
  return box;
}

const VERBS = {
  add: "＋",
  edit: "✎",
  move: "→",
  delete: "🗑",
  comment: "💬"
};

function verbOf(change) {
  return VERBS[change.action] || "·";
}

function colName(key) {
  return COL_NAMES[key] || key || "—";
}

function fieldList(fields) {
  return (fields || []).map(function (f) { return FIELD_NAMES[f] || f; }).join(", ");
}

// Devuelve HTML ya escapado: sólo se interpolan valores pasados por esc().
function describe(change) {
  const title = change.title ? '<b>' + esc(change.title) + '</b>' : "";
  const id = change.id ? '<code>' + esc(change.id) + '</code>' : "";

  if (change.kind === "card") {
    if (change.action === "add") {
      return "creó " + id + " " + title + " en " + esc(colName(change.to));
    }
    if (change.action === "move") {
      return "movió " + id + " " + title + " de " + esc(colName(change.from)) +
             " a " + esc(colName(change.to));
    }
    if (change.action === "delete") {
      return "eliminó " + id + " " + title;
    }
    if (change.action === "comment") {
      const n = change.count || 1;
      return "comentó " + id + " " + title + (n > 1 ? " · " + n + " comentarios" : "");
    }
    const campos = fieldList(change.fields);
    const destino = change.to ? " (ahora en " + esc(colName(change.to)) + ")" : "";
    return "editó " + id + " " + title + " · " + esc(campos) + destino;
  }

  if (change.kind === "ws") {
    if (change.action === "add") return "añadió el frente " + title;
    if (change.action === "delete") return "eliminó el frente " + title;
    return "cambió " + esc(fieldList(change.fields)) + " del frente " + title;
  }

  return "cambió el encabezado · " + esc(fieldList(change.fields));
}

// Fechas relativas para lo reciente y absolutas para lo viejo: en una bitácora
// "hace 5 min" dice más que una marca de tiempo completa.
export function formatWhen(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60000) return "hace un momento";
  if (diff < 3600000) return "hace " + Math.floor(diff / 60000) + " min";
  if (diff < 86400000) return "hace " + Math.floor(diff / 3600000) + " h";
  return d.toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  });
}
