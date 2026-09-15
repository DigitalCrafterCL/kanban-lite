// Sincronización de tableros compartidos.
//
// Modelo: el cliente compara su estado actual contra una instantánea de la
// última sincronización, manda sólo lo que cambió y recibe el tablero
// fusionado. Así dos personas que tocan tarjetas distintas nunca se pisan.
//
// Todo aquí es de mejor esfuerzo: si el servidor no responde, el usuario sigue
// trabajando en local y los cambios se suben en el siguiente intento.

import { LS_SNAPSHOT_PREFIX, SYNC_POLL_MS, SYNC_DEBOUNCE_MS } from "./config.js";
import { getState, setState, getStateSlug } from "./store.js";
import { getActiveSlug, getBoardEntry, patchBoardEntry, getBoardKey } from "./boardselector.js";
import { getServer, isSessionValid, fetchBoard, pushChanges, RemoteError, isDestructiveBlock } from "./remote.js";
import { showToast } from "./toast.js";
import { clone } from "./utils.js";

const CARD_FIELDS = ["ws", "pri", "col", "t", "d", "labels", "due", "comments", "cr", "st", "dn", "ca"];
// Campos de lista: sin un valor por defecto propio, pickFields los pondría a
// "" y `stripVersions` devolvería tarjetas con etiquetas que no son un arreglo.
const CARD_LIST_FIELDS = { labels: true, comments: true };
const WS_FIELDS   = ["label", "color"];
const META_FIELDS = ["eyebrow", "title", "titleThin", "subtitle", "branch"];

// local · synced · pending · syncing · offline · auth · error
let currentStatus = "local";
let statusDetail = "";
const statusListeners = new Set();

let debounceTimer = null;
let pollTimer = null;
let inFlight = false;
// Cada cambio de tablero invalida las respuestas que vengan en vuelo. Sin esto,
// una respuesta del tablero anterior aterriza cuando ya hay otro activo y
// setState() la guarda en el tablero equivocado, machacándolo.
let generation = 0;
let applying = false;   // evita que aplicar el estado remoto dispare otro sync
let onAppliedCallback = null;
// Datos del último frenazo por sincronización destructiva, para que la UI
// pueda ofrecer una salida en vez de quedarse en "error".
let bloqueoDestructivo = null;

export function getDestructiveBlock() { return bloqueoDestructivo; }

// Debe llamarse SIEMPRE antes de cambiar de tablero activo.
export function invalidateSync() {
  // Cancelar el rebote a secas perdería lo que el usuario acaba de escribir,
  // así que primero se envía, y sólo después se invalida.
  flushPendingChanges();
  generation++;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

// Envío de despedida al abandonar un tablero con cambios sin subir. No aplica
// la respuesta a la interfaz (ya estaremos en otro tablero); sólo se asegura de
// que el trabajo llegue al servidor y deja al día la copia de ESE tablero.
function flushPendingChanges() {
  const ctx = activeRemoteContext();
  if (!ctx || !isSessionValid(ctx.server)) return;
  if ((ctx.remote.role || "write") === "read") return;

  const slug = ctx.slug;
  const diff = diffState(getState(), readSnapshot(slug));
  if (!hasChanges(diff)) return;

  pushChanges(ctx.server, ctx.remote.boardId, {
    baseVersion: ctx.remote.baseVersion || 0,
    cards: diff.cards, ws: diff.ws, meta: diff.meta, deletes: diff.deletes
  }).then(function (r) {
    // Si el usuario ya volvió a este tablero, la sincronización normal manda.
    if (getStateSlug() === slug) return;
    const clean = stripVersions(r.state);
    try {
      localStorage.setItem(getBoardKey(slug), JSON.stringify(clean));
    } catch (e) { return; }
    writeSnapshot(slug, clean);
    const entry = getBoardEntry(slug);
    if (entry && entry.remote) {
      patchBoardEntry(slug, {
        remote: Object.assign({}, entry.remote, {
          baseVersion: r.version, lastSync: new Date().toISOString()
        })
      });
    }
  }).catch(function () {
    // Sin conexión: los cambios siguen en localStorage y subirán al volver
    // a abrir el tablero.
  });
}

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  return function () { statusListeners.delete(fn); };
}

export function getSyncStatus() {
  return { status: currentStatus, detail: statusDetail };
}

function setStatus(status, detail) {
  currentStatus = status;
  statusDetail = detail || "";
  for (const fn of statusListeners) fn(currentStatus, statusDetail);
}

// -- Instantánea de la última sincronización --------------------------------

function snapshotKey(slug) { return LS_SNAPSHOT_PREFIX + slug; }

export function readSnapshot(slug) {
  try {
    const raw = localStorage.getItem(snapshotKey(slug));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

export function writeSnapshot(slug, state) {
  try { localStorage.setItem(snapshotKey(slug), JSON.stringify(state)); } catch (e) {}
}

export function clearSnapshot(slug) {
  try { localStorage.removeItem(snapshotKey(slug)); } catch (e) {}
}

// El campo `v` lo administra el servidor; el modelo local no lo necesita.
function stripVersions(serverState) {
  return {
    rev: serverState.rev || 2,
    meta: pickFields(serverState.meta || {}, META_FIELDS),
    ws: (serverState.ws || []).map(function (w) {
      return Object.assign({ key: w.key }, pickFields(w, WS_FIELDS));
    }),
    cards: (serverState.cards || []).map(function (c) {
      return Object.assign({ id: c.id }, pickFields(c, CARD_FIELDS));
    })
  };
}

function pickFields(source, fields) {
  const out = {};
  for (const f of fields) {
    const v = source[f];
    if (v === undefined || v === null) out[f] = CARD_LIST_FIELDS[f] ? [] : "";
    else out[f] = v;
  }
  return out;
}

// Las etiquetas y los comentarios son listas: compararlas con `===` daría
// "cambiado" en cada sincronización (dos arreglos nunca son el mismo objeto) y
// el cliente subiría el tablero entero cada pocos segundos.
function normValue(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function sameFields(a, b, fields) {
  return fields.every(function (f) { return normValue(a[f]) === normValue(b[f]); });
}

// -- Diferencia entre el estado actual y la instantánea ---------------------

export function diffState(current, snapshot) {
  const base = snapshot || { meta: {}, ws: [], cards: [] };
  const out = { cards: [], ws: [], deletes: [] };

  const baseCards = new Map((base.cards || []).map(function (c) { return [c.id, c]; }));
  for (const card of current.cards || []) {
    const prev = baseCards.get(card.id);
    if (!prev || !sameFields(card, prev, CARD_FIELDS)) {
      out.cards.push(Object.assign({ id: card.id }, pickFields(card, CARD_FIELDS)));
    }
    baseCards.delete(card.id);
  }
  for (const id of baseCards.keys()) out.deletes.push({ id: id, kind: "card" });

  const baseWs = new Map((base.ws || []).map(function (w) { return [w.key, w]; }));
  for (const ws of current.ws || []) {
    const prev = baseWs.get(ws.key);
    if (!prev || !sameFields(ws, prev, WS_FIELDS)) {
      out.ws.push(Object.assign({ key: ws.key }, pickFields(ws, WS_FIELDS)));
    }
    baseWs.delete(ws.key);
  }
  for (const key of baseWs.keys()) out.deletes.push({ id: key, kind: "ws" });

  if (!sameFields(current.meta || {}, base.meta || {}, META_FIELDS)) {
    out.meta = pickFields(current.meta || {}, META_FIELDS);
  }
  return out;
}

export function hasChanges(diff) {
  return Boolean(diff.cards.length || diff.ws.length || diff.deletes.length || diff.meta);
}

// Reaplica sobre `state` los cambios que el usuario hizo mientras la petición
// viajaba, para que no se pierdan al adoptar el estado del servidor.
function applyDiff(state, diff) {
  const next = clone(state);

  const deletedCards = new Set(diff.deletes.filter(d => d.kind === "card").map(d => d.id));
  const deletedWs = new Set(diff.deletes.filter(d => d.kind === "ws").map(d => d.id));
  next.cards = next.cards.filter(function (c) { return !deletedCards.has(c.id); });
  next.ws = next.ws.filter(function (w) { return !deletedWs.has(w.key); });

  for (const card of diff.cards) {
    const i = next.cards.findIndex(function (c) { return c.id === card.id; });
    if (i >= 0) next.cards[i] = Object.assign({}, next.cards[i], card);
    else next.cards.push(Object.assign({}, card));
  }
  for (const ws of diff.ws) {
    const i = next.ws.findIndex(function (w) { return w.key === ws.key; });
    if (i >= 0) next.ws[i] = Object.assign({}, next.ws[i], ws);
    else next.ws.push(Object.assign({}, ws));
  }
  if (diff.meta) next.meta = Object.assign({}, next.meta, diff.meta);
  return next;
}

// -- Contexto del tablero activo --------------------------------------------

export function activeRemoteContext() {
  // getStateSlug(), no getActiveSlug(): el "activo" lo comparten todas las
  // pestañas del navegador, pero el estado en memoria es de esta pestaña.
  const slug = getStateSlug();
  if (!slug) return null;
  const entry = getBoardEntry(slug);
  if (!entry || entry.kind !== "remote" || !entry.remote) return null;
  const server = getServer(entry.remote.serverId);
  if (!server) return null;
  return { slug: slug, entry: entry, server: server, remote: entry.remote };
}

export function isActiveBoardRemote() {
  return Boolean(activeRemoteContext());
}

// -- Sólo lectura -----------------------------------------------------------
//
// Un invitado con permiso de lectura no puede escribir en el servidor, y la
// interfaz tiene que decírselo ANTES de tocar nada. Dejarle editar en local no
// era «offline-first» sino una trampa: el cambio se guardaba, el envío se
// rechazaba con 403 y, como el cliente sólo descarga cuando no tiene nada
// pendiente, dejaba de recibir también las novedades de los demás. Con un solo
// clic, el tablero se quedaba congelado y en error para siempre.

export function activeBoardRole() {
  const ctx = activeRemoteContext();
  if (!ctx) return null;
  return ctx.remote.role || "write";
}

export function isReadOnlyBoard() {
  return activeBoardRole() === "read";
}

/**
 * Guardia para los puntos de escritura de la interfaz. Devuelve true si la
 * acción NO debe seguir adelante.
 */
export function denyReadOnly(accion) {
  if (!isReadOnlyBoard()) return false;
  showToast((accion ? accion + ": " : "") +
    "este tablero es de sólo lectura. Pide permiso de edición a su dueño.", "warn", 5000);
  return true;
}

// -- Sincronización ---------------------------------------------------------

export function initSync(onApplied) {
  onAppliedCallback = onApplied;

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") syncNow();
  });
  window.addEventListener("online", function () { syncNow(); });

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function () {
    if (document.visibilityState === "visible") syncNow();
  }, SYNC_POLL_MS);
}

// Punto de enganche desde store.saveState(): un cambio local programa una subida.
export function scheduleSync() {
  if (applying) return;
  const ctx = activeRemoteContext();
  if (!ctx) return;
  // En sólo lectura no hay nada que subir: lo que haya quedado en local se
  // descarta en el siguiente sondeo, así que no se anuncia como «pendiente».
  if ((ctx.remote.role || "write") === "read") {
    setStatus("readonly");
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { syncNow(); }, SYNC_DEBOUNCE_MS);
    return;
  }
  if (currentStatus !== "syncing") setStatus("pending");
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () { syncNow(); }, SYNC_DEBOUNCE_MS);
}

// Llamar al cambiar de tablero para que el indicador refleje el nuevo contexto.
export function refreshSyncStatus() {
  const ctx = activeRemoteContext();
  if (!ctx) { setStatus("local"); return; }
  if (!isSessionValid(ctx.server)) { setStatus("auth", "Sesión expirada"); return; }
  if ((ctx.remote.role || "write") === "read") {
    setStatus("readonly", "Sólo lectura: no puedes editar este tablero");
    return;
  }
  const diff = diffState(getState(), readSnapshot(ctx.slug));
  setStatus(hasChanges(diff) ? "pending" : "synced");
}

// Aplicar el estado remoto vuelve a renderizar el tablero entero, lo que
// cerraría un formulario abierto a media escritura. Mientras haya uno abierto
// se pospone la sincronización hasta el siguiente sondeo.
function isEditorOpen() {
  // Acotado a #board a propósito: la clase .edit-form también la usan modales
  // estáticos del HTML, que están siempre presentes.
  return Boolean(document.querySelector("#board .add-form.open, #board .edit-form"));
}

// Descarta la copia local y adopta la del servidor. Es la salida segura
// cuando el frenazo se debió a que este navegador tenía el tablero equivocado.
export async function discardLocalAndPull() {
  const ctx = activeRemoteContext();
  if (!ctx) return false;
  const fresh = await fetchBoard(ctx.server, ctx.remote.boardId);
  const clean = stripVersions(fresh.state);
  writeSnapshot(ctx.slug, clean);
  patchBoardEntry(ctx.slug, {
    remote: Object.assign({}, ctx.remote, {
      baseVersion: fresh.version, lastSync: new Date().toISOString()
    })
  });
  applying = true;
  try { setState(clean, true); } finally { applying = false; }
  bloqueoDestructivo = null;
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  setStatus(isReadOnlyBoard() ? "readonly" : "synced");
  return true;
}

// Sube igualmente, asumiendo el borrado masivo.
export async function forceDestructiveSync() {
  bloqueoDestructivo = null;
  await syncNow({ confirmDestructive: true });
  return true;
}

// Vuelve a la última instantánea sincronizada, que es exactamente lo que el
// servidor tenía en `baseVersion`. Funciona sin red.
function dropLocalDivergence(slug) {
  const snap = readSnapshot(slug);
  if (!snap) return false;
  if (!hasChanges(diffState(getState(), snap))) return false;

  applying = true;
  try { setState(clone(snap), true); } finally { applying = false; }
  showToast("Tablero de sólo lectura: se descartaron los cambios locales", "warn", 6000);
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  return true;
}

export async function syncNow(opciones) {
  if (inFlight) return;
  if (isEditorOpen()) return;
  const ctx = activeRemoteContext();
  if (!ctx) { setStatus("local"); return; }
  if (!isSessionValid(ctx.server)) { setStatus("auth", "Sesión expirada"); return; }

  const slug = ctx.slug;
  const myGeneration = generation;
  const baseVersion = ctx.remote.baseVersion || 0;
  const soloLectura = (ctx.remote.role || "write") === "read";

  // En sólo lectura, lo que haya quedado divergente se descarta ANTES de
  // hablar con el servidor. Esperar a la respuesta no sirve: si el tablero no
  // cambió, el servidor contesta 304 y la copia local se quedaría divergente
  // para siempre —y con ella el aviso de «cambios sin subir» que nunca subirán.
  if (soloLectura) dropLocalDivergence(slug);

  const stateAtRequest = clone(getState());
  const diff = diffState(stateAtRequest, readSnapshot(slug));

  // Comprueba que seguimos en el mismo tablero que cuando salió la petición.
  const sigueVigente = function () {
    return myGeneration === generation && getStateSlug() === slug;
  };

  inFlight = true;
  setStatus("syncing");
  try {
    let version, serverState, conflicts = [];

    // El `if` mira el rol antes que la diferencia: si un invitado de sólo
    // lectura tiene cambios locales (los hizo antes de este arreglo, otra
    // pestaña, una importación) no se pueden subir, y si intentáramos subirlos
    // el 403 impediría además descargar. Se descarga y su copia se descarta.
    if (!soloLectura && hasChanges(diff)) {
      const r = await pushChanges(ctx.server, ctx.remote.boardId, {
        baseVersion: baseVersion,
        cards: diff.cards, ws: diff.ws, meta: diff.meta, deletes: diff.deletes,
        confirmDestructive: Boolean(opciones && opciones.confirmDestructive)
      });
      // El servidor ya aplicó el cambio; sólo descartamos la respuesta local.
      // El siguiente sondeo del tablero traerá el estado al día.
      if (!sigueVigente()) return;
      version = r.version; serverState = r.state; conflicts = r.conflicts || [];
    } else {
      const r = await fetchBoard(ctx.server, ctx.remote.boardId, '"' + baseVersion + '"');
      if (!sigueVigente()) return;
      if (r.notModified) {
        patchBoardEntry(slug, { remote: Object.assign({}, ctx.remote, { lastSync: new Date().toISOString() }) });
        setStatus(soloLectura ? "readonly" : "synced",
          soloLectura ? "Sólo lectura: no puedes editar este tablero" : "");
        return;
      }
      version = r.version; serverState = r.state;
    }

    applyServerState(slug, stateAtRequest, version, serverState, conflicts, soloLectura);
  } catch (err) {
    if (!sigueVigente()) return;
    handleSyncError(err);
  } finally {
    inFlight = false;
  }
}

function applyServerState(slug, stateAtRequest, version, serverState, conflicts, soloLectura) {
  // Última defensa: setState() persiste en el tablero ACTIVO, no en `slug`.
  // Aplicar aquí con otro tablero activo sobrescribiría el tablero equivocado.
  const entry = getBoardEntry(slug);
  if (getStateSlug() !== slug || !entry || !entry.remote) return;

  const clean = stripVersions(serverState);

  // Lo que el usuario tocó mientras la petición viajaba no se puede perder…
  // salvo en sólo lectura, donde no hay forma de subirlo: conservarlo dejaría
  // el tablero divergente para siempre y bloquearía las descargas.
  const duringFlight = diffState(getState(), stateAtRequest);
  const next = (!soloLectura && hasChanges(duringFlight)) ? applyDiff(clean, duringFlight) : clean;

  writeSnapshot(slug, clean);
  patchBoardEntry(slug, {
    remote: Object.assign({}, entry.remote, {
      baseVersion: version,
      lastSync: new Date().toISOString()
    })
  });

  applying = true;
  try {
    setState(next, true);
  } finally {
    applying = false;
  }

  if (typeof onAppliedCallback === "function") onAppliedCallback();

  if (conflicts && conflicts.length) {
    const label = conflicts.length === 1
      ? "«" + conflicts[0] + "»"
      : conflicts.length + " elementos";
    showToast("Alguien editó " + label + " a la vez; se conservó tu versión", "warn", 6000);
  }

  if (soloLectura) {
    setStatus("readonly", "Sólo lectura: no puedes editar este tablero");
    return;
  }
  setStatus(hasChanges(diffState(getState(), clean)) ? "pending" : "synced");
}

function handleSyncError(err) {
  if (isDestructiveBlock(err)) {
    // El servidor rechazó el envío para no arrasar el tablero compartido.
    // No es un error de red: hay que decidir qué copia vale.
    bloqueoDestructivo = { mensaje: err.message, cuando: Date.now() };
    setStatus("blocked", err.message);
    showToast("Sincronización frenada: revisa el aviso junto al estado", "error", 9000);
    return;
  }
  if (err instanceof RemoteError && err.isOffline) {
    setStatus("offline", "Sin conexión con el servidor");
    return;
  }
  if (err instanceof RemoteError && err.isAuth) {
    setStatus("auth", "Sesión expirada");
    showToast("Tu sesión en el servidor expiró. Vuelve a entrar desde ⊞ Tableros.", "warn", 7000);
    return;
  }
  if (err instanceof RemoteError && err.status === 404) {
    setStatus("error", "El tablero ya no existe en el servidor");
    return;
  }
  if (err instanceof RemoteError && err.status === 403) {
    // El rol pudo cambiar en el servidor después de abrir el tablero. Se
    // apunta en el índice para que la interfaz se bloquee ya y el sondeo
    // siguiente vuelva a descargar en vez de reintentar el envío.
    const ctx = activeRemoteContext();
    if (ctx && (ctx.remote.role || "write") !== "read") {
      patchBoardEntry(ctx.slug, {
        remote: Object.assign({}, ctx.remote, { role: "read" })
      });
      showToast("Ya sólo tienes permiso de lectura en este tablero", "warn", 7000);
      if (typeof onAppliedCallback === "function") onAppliedCallback();
    }
    setStatus("readonly", "Sólo lectura: no puedes editar este tablero");
    return;
  }
  console.error("Error de sincronización:", err);
  setStatus("error", (err && err.message) || "Error desconocido");
}
