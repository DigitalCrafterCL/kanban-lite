import seedData from "../data/seed.js";
import { SEED_REV, REV_PATCHES, DEFAULT_META, normalizeStamps, applyBoardCols, normalizeCols } from "./config.js";
import { clone } from "./utils.js";
import { getBoardKey, getActiveSlug, touchBoard, getBoardName, getBoardEntry, isRemote } from "./boardselector.js";
import { showToast } from "./toast.js";

let state = null;
// El tablero al que pertenece `state`. Sin esto, saveState() guardaba en
// "el tablero activo ahora", que en otra pestaña del mismo navegador puede ser
// OTRO: la pestaña con el tablero A en memoria escribía sobre el tablero B.
let stateSlug = null;
const listeners = new Set();
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 30;
let quotaWarned = false;
let saveHook = null;

// app.js engancha aquí la sincronización. store.js no importa sync.js a
// propósito: evita un ciclo de módulos y deja el estado independiente de la red.
export function setSaveHook(fn) { saveHook = fn; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

// Las columnas son del tablero: cada vez que cambia el estado en memoria se
// vuelcan en COLS, que es lo que recorren el render, las métricas y la ficha.
function syncCols() {
  applyBoardCols(state && state.cols);
}

export function pushHistory() {
  if (state) {
    undoStack.push(clone(state));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
  }
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function undo() {
  if (!canUndo()) return false;
  redoStack.push(clone(state));
  state = undoStack.pop();
  syncCols();
  saveState();
  notify();
  return true;
}

export function redo() {
  if (!canRedo()) return false;
  undoStack.push(clone(state));
  state = redoStack.pop();
  syncCols();
  saveState();
  notify();
  return true;
}

export function baseState() {
  return normalizeStamps({
    meta: clone(seedData.meta || DEFAULT_META),
    cards: clone(seedData.cards),
    ws: clone(seedData.ws),
    rev: SEED_REV
  });
}

// Estado vacío para tableros recién creados (sin el tutorial de bienvenida)
export function blankState(name) {
  return {
    meta: {
      eyebrow: "Nuevo Proyecto",
      title: name || DEFAULT_META.title,
      titleThin: "",
      subtitle: "Personaliza tus frentes y tarjetas",
      branch: "v1.0"
    },
    cards: [],
    ws: [{ key: "GEN", label: "General", color: "#0a8fa6" }],
    rev: SEED_REV
  };
}

export function applyMigrations(s) {
  const rev = s.rev || 1;
  for (let r = rev + 1; r <= SEED_REV; r++) {
    if (REV_PATCHES[r]) REV_PATCHES[r](s);
  }
  if (!s.meta) s.meta = clone(DEFAULT_META);
  s.rev = SEED_REV;
  return s;
}

// Limpia el estado en memoria (necesario al cambiar de tablero)
export function resetStore() {
  state = null;
  stateSlug = null;
  syncCols();
  undoStack.length = 0;
  redoStack.length = 0;
}

// Tablero al que pertenece el estado en memoria. La sincronización debe usar
// este, no el "activo", que es información compartida entre pestañas.
export function getStateSlug() {
  return stateSlug;
}

export function loadState() {
  const slug = getActiveSlug();
  if (!slug) return blankState();
  try {
    const raw = localStorage.getItem(getBoardKey(slug));
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.cards) && Array.isArray(s.ws)) {
        return applyMigrations(s);
      }
    }
  } catch (e) {
    console.error("Error loading state from localStorage:", e);
  }
  return blankState(getBoardName(slug));
}

export function initStore() {
  if (!state) {
    stateSlug = getActiveSlug();
    state = loadState();
    syncCols();
  }
  return state;
}

// Relee desde localStorage. Se usa cuando otra pestaña modificó este mismo
// tablero, para no seguir trabajando sobre una copia vieja.
export function reloadFromStorage() {
  if (!stateSlug) return false;
  state = loadState();
  syncCols();
  notify();
  return true;
}

export function getState() {
  if (!state) initStore();
  return state;
}

export function setState(newState, shouldSave = true) {
  if (!newState.meta) newState.meta = clone(DEFAULT_META);
  if (!stateSlug) stateSlug = getActiveSlug();
  state = newState;
  syncCols();
  if (shouldSave) saveState();
  notify();
}

export function getMeta() {
  return getState().meta || clone(DEFAULT_META);
}

export function setMeta(newMeta, shouldSave = true) {
  const current = getState();
  current.meta = Object.assign({}, current.meta || DEFAULT_META, newMeta);
  if (shouldSave) saveState();
  notify();
}

export function saveState() {
  if (!state) return;
  // Se guarda en el tablero del que salió el estado, nunca en "el activo".
  const slug = stateSlug;
  if (!slug) return;
  try {
    localStorage.setItem(getBoardKey(slug), JSON.stringify(state));
    touchBoard(slug);
    quotaWarned = false;
    if (saveHook) saveHook();
  } catch (e) {
    console.error("Error saving state to localStorage:", e);
    if (!quotaWarned) {
      quotaWarned = true;
      showToast("No se pudo guardar: almacenamiento del navegador lleno. Exporta tu tablero en ⇅ Datos.", "error", 8000);
    }
  }
}

// Personalización de columnas: [{ key, name, color }] en el orden del tablero.
// Se guarda la lista completa: así la sincronización la trata como una sola
// pieza y el orden viaja junto con los nombres y los colores.
export function setCols(cols) {
  const current = getState();
  current.cols = normalizeCols(cols);
  syncCols();
  saveState();
  notify();
}

export function wsById(key) {
  const current = getState();
  for (let i = 0; i < current.ws.length; i++) {
    if (current.ws[i].key === key) return current.ws[i];
  }
  return { key: key, label: key || "—", color: "#8494a8" };
}

export function nextId(ws) {
  const prefix = String(ws || "T").toUpperCase();
  const current = getState();

  // En un tablero compartido un contador secuencial no sirve: dos personas que
  // crean una tarjeta a la vez calculan el mismo número desde su propia vista,
  // la fusión las trata como la misma entidad y una de las dos se pierde.
  // Un sufijo aleatorio hace el id único entre clientes sin coordinación.
  // Un tablero desconectado del servidor también: volverá a él al reconectar.
  const entry = getBoardEntry(stateSlug || getActiveSlug());
  if (isRemote(entry) || (entry && entry.detached)) {
    const taken = new Set(current.cards.map(function (c) { return c.id; }));
    let id;
    do {
      id = prefix + "-" + Math.random().toString(36).slice(2, 6);
    } while (taken.has(id));
    return id;
  }

  let n = 1;
  current.cards.forEach(function (c) {
    const m = c.id.match(new RegExp("^" + prefix + "-N(\\d+)$"));
    if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
  });
  return prefix + "-N" + n;
}
