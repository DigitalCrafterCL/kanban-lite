// Papelera del tablero: nada se borra de golpe.
//
// Toda eliminación de una tarjeta o de un frente guarda antes una copia aquí,
// con su fecha y con lo necesario para devolverla a su sitio (a qué frente se
// reasignaron las tarjetas, qué columna ocupaba, qué id tenía). Deshacer con
// Ctrl+Z sigue existiendo, pero sólo alcanza a la última acción y muere al
// recargar; la papelera sobrevive a la recarga y deja elegir qué recuperar.
//
// Vive FUERA del estado sincronizado, en su propia clave de localStorage: el
// servidor sanea el estado y descartaría cualquier campo que no conozca, y una
// papelera compartida no tendría sentido — el borrado de un compañero ya queda
// en el histórico del servidor y en la bitácora.

import { COLS, LS_TRASH_PREFIX, MAX_TRASH_ENTRIES } from "./config.js";
import { getState, saveState, nextId, getStateSlug } from "./store.js";
import { getActiveSlug } from "./boardselector.js";
import { syncFilters } from "./filters.js";
import { showToast } from "./toast.js";
import { esc, clone } from "./utils.js";
import { denyReadOnly } from "./sync.js";
import { stampMove } from "./metrics.js";

let onTrashChanged = null;

function trashKey(slug) {
  return LS_TRASH_PREFIX + slug;
}

// El tablero del estado en memoria, no el "activo": en otra pestaña el activo
// puede ser otro y la papelera acabaría en el tablero del vecino.
export function trashSlug() {
  return getStateSlug() || getActiveSlug() || "";
}

export function listTrash(slug) {
  const key = slug || trashSlug();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(trashKey(key));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeTrash(slug, entries) {
  try {
    localStorage.setItem(trashKey(slug), JSON.stringify(entries.slice(0, MAX_TRASH_ENTRIES)));
  } catch (e) {
    // Sin espacio no se pierde el borrado: sólo se queda sin copia de rescate.
    console.error("No se pudo escribir la papelera:", e);
  }
}

export function trashCount(slug) {
  return listTrash(slug).length;
}

// Añade una entrada. `data` se clona: quien llama sigue mutando su estado.
export function pushTrash(kind, data, extra) {
  const slug = trashSlug();
  if (!slug) return null;
  const entry = Object.assign({
    tid: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    kind: kind,
    at: Date.now(),
    data: clone(data)
  }, extra || {});
  const entries = listTrash(slug);
  entries.unshift(entry);
  writeTrash(slug, entries);
  updateTrashButton();
  return entry;
}

export function dropTrash(tid) {
  const slug = trashSlug();
  if (!slug) return;
  writeTrash(slug, listTrash(slug).filter(function (e) { return e.tid !== tid; }));
  updateTrashButton();
}

export function clearTrash(slug) {
  const key = slug || trashSlug();
  if (!key) return;
  try { localStorage.removeItem(trashKey(key)); } catch (e) {}
  updateTrashButton();
}

// -- Restauración -----------------------------------------------------------

// Devuelve { ok, mensaje }. El estado vigente se pide aquí, no al renderizar
// la lista: entre abrir la papelera y pulsar «Restaurar» el tablero puede
// haber cambiado por completo (deshacer, plantilla, sincronización).
export function restoreTrash(tid) {
  if (denyReadOnly("No se restauró nada")) return false;
  const slug = trashSlug();
  const entry = listTrash(slug).find(function (e) { return e.tid === tid; });
  if (!entry) return { ok: false, mensaje: "Esa entrada ya no está en la papelera" };

  const resultado = entry.kind === "ws" ? restoreWs(entry) : restoreCard(entry);
  if (resultado.ok) {
    saveState();
    dropTrash(tid);
  }
  return resultado;
}

function restoreCard(entry) {
  const state = getState();
  const card = clone(entry.data);
  const avisos = [];

  if (!state.ws.length) return { ok: false, mensaje: "El tablero no tiene ningún frente" };

  if (state.cards.some(function (c) { return c.id === card.id; })) {
    const anterior = card.id;
    card.id = nextId(card.ws);
    avisos.push("el id " + anterior + " ya estaba ocupado, ahora es " + card.id);
  }
  if (!state.ws.some(function (w) { return w.key === card.ws; })) {
    card.ws = state.ws[0].key;
    avisos.push("su frente ya no existe, va a " + card.ws);
  }
  if (!COLS.some(function (c) { return c.key === card.col; })) {
    card.col = "backlog";
  }

  // Vuelve al tablero ahora: la edad en la columna cuenta desde este momento,
  // no desde antes de que la borraran.
  stampMove(card, "");
  state.cards.push(card);
  return {
    ok: true,
    mensaje: "«" + card.t + "» restaurada" + (avisos.length ? " (" + avisos.join("; ") + ")" : "")
  };
}

function restoreWs(entry) {
  const state = getState();
  const ws = clone(entry.data);

  if (state.ws.some(function (w) { return w.key === ws.key; })) {
    return { ok: false, mensaje: "Ya existe un frente con la clave " + ws.key };
  }
  state.ws.push(ws);

  // Las tarjetas que se reasignaron al eliminar el frente vuelven con él, pero
  // sólo si nadie las movió a otro sitio entretanto.
  let devueltas = 0;
  for (const id of entry.cards || []) {
    const card = state.cards.find(function (c) { return c.id === id; });
    if (card && (!entry.reassignedTo || card.ws === entry.reassignedTo)) {
      card.ws = ws.key;
      devueltas++;
    }
  }
  syncFilters();
  return {
    ok: true,
    mensaje: "Frente «" + ws.label + "» restaurado" +
      (devueltas ? " con " + devueltas + " tarea" + (devueltas === 1 ? "" : "s") : "")
  };
}

// -- Interfaz ---------------------------------------------------------------

export function initTrash(onChanged) {
  onTrashChanged = onChanged;

  const overlay = document.getElementById("trashOverlay");
  const openBtn = document.getElementById("trashBtn");
  const closeBtn = document.getElementById("trashClose");
  const emptyBtn = document.getElementById("trashEmpty");

  if (openBtn) openBtn.addEventListener("click", openTrash);
  if (closeBtn) closeBtn.addEventListener("click", closeTrash);

  if (emptyBtn) {
    let armado = false;
    let timer = null;
    emptyBtn.addEventListener("click", function () {
      if (!armado) {
        armado = true;
        emptyBtn.textContent = "Pulsa otra vez para vaciarla";
        timer = setTimeout(function () {
          armado = false;
          emptyBtn.textContent = "Vaciar papelera";
        }, 4000);
        return;
      }
      clearTimeout(timer);
      armado = false;
      emptyBtn.textContent = "Vaciar papelera";
      clearTrash();
      renderTrash();
      showToast("Papelera vaciada", "info");
    });
  }

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeTrash();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) closeTrash();
  });

  updateTrashButton();
}

// El contador en el botón es la única pista de que hay algo recuperable.
export function updateTrashButton() {
  const btn = document.getElementById("trashBtn");
  if (!btn) return;
  const n = trashCount();
  btn.textContent = n ? "🗑 Papelera (" + n + ")" : "🗑 Papelera";
  btn.classList.toggle("has-items", n > 0);
}

export function openTrash() {
  const overlay = document.getElementById("trashOverlay");
  if (!overlay) return;
  renderTrash();
  overlay.classList.add("open");
}

export function closeTrash() {
  const overlay = document.getElementById("trashOverlay");
  if (overlay) overlay.classList.remove("open");
}

function renderTrash() {
  const list = document.getElementById("trashList");
  if (!list) return;
  const entries = listTrash();
  list.innerHTML = "";

  if (!entries.length) {
    list.innerHTML = '<p class="bs-empty">La papelera de este tablero está vacía. ' +
      'Lo que elimines aparecerá aquí y podrás devolverlo a su sitio.</p>';
    return;
  }

  for (const entry of entries) {
    list.appendChild(buildTrashRow(entry));
  }
}

function buildTrashRow(entry) {
  const row = document.createElement("div");
  row.className = "trash-row";

  const esWs = entry.kind === "ws";
  const data = entry.data || {};
  const titulo = esWs ? data.label || data.key : data.t || "(sin título)";

  const info = document.createElement("div");
  info.className = "trash-info";
  info.innerHTML =
    '<span class="trash-kind">' + (esWs ? "frente" : "tarjeta") + '</span>' +
    '<span class="trash-title">' + esc(titulo) + '</span>' +
    (esWs
      ? ''
      : '<code class="trash-id">' + esc(data.id || "") + '</code>') +
    '<span class="trash-when">' + esc(formatTrashDate(entry.at)) + '</span>';
  row.appendChild(info);

  const restore = document.createElement("button");
  restore.className = "btn trash-restore";
  restore.textContent = "Restaurar";
  restore.addEventListener("click", function () {
    const r = restoreTrash(entry.tid);
    showToast(r.mensaje, r.ok ? "success" : "warn", r.ok ? 5000 : 6000);
    renderTrash();
    if (r.ok && typeof onTrashChanged === "function") onTrashChanged();
  });
  row.appendChild(restore);

  const drop = document.createElement("button");
  drop.className = "bs-delete";
  drop.textContent = "✕";
  drop.title = "Quitar de la papelera definitivamente";
  let armado = false;
  let timer = null;
  drop.addEventListener("click", function () {
    if (!armado) {
      armado = true;
      drop.textContent = "¿Borrar?";
      drop.classList.add("armed");
      timer = setTimeout(function () {
        armado = false;
        drop.textContent = "✕";
        drop.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    dropTrash(entry.tid);
    renderTrash();
  });
  row.appendChild(drop);

  return row;
}

export function formatTrashDate(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60000) return "hace un momento";
  if (diff < 3600000) return "hace " + Math.floor(diff / 60000) + " min";
  if (diff < 86400000) return "hace " + Math.floor(diff / 3600000) + " h";
  return new Date(ms).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  });
}
