// Sincronización de tableros compartidos.
//
// Modelo: el cliente compara su estado actual contra una instantánea de la
// última sincronización, manda sólo lo que cambió y recibe el tablero
// fusionado. Así dos personas que tocan tarjetas distintas nunca se pisan.
//
// Todo aquí es de mejor esfuerzo: si el servidor no responde, el usuario sigue
// trabajando en local y los cambios se suben en el siguiente intento.

import { LS_SNAPSHOT_PREFIX, SYNC_POLL_MS, SYNC_DEBOUNCE_MS, normalizeCols } from "./config.js";
import { getState, setState, getStateSlug } from "./store.js";
import { getBoardEntry, patchBoardEntry, getBoardKey, listAllBoards } from "./boardselector.js";
import {
  getServer, listServers, isSessionValid, fetchBoard, pushChanges, RemoteError, isDestructiveBlock,
  markSessionExpired
} from "./remote.js";
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

// Reconciliación pendiente de decisión del usuario tras volver a conectar:
// { slug, version, role, base, remote, conflicts }. Mientras exista, ese
// tablero no sube ni baja nada.
let pendingConflict = null;
const conflictListeners = new Set();

export function onConflict(fn) {
  conflictListeners.add(fn);
  return function () { conflictListeners.delete(fn); };
}

export function getPendingConflict() {
  if (pendingConflict && pendingConflict.slug === getStateSlug()) return pendingConflict;
  return null;
}

// Debe llamarse SIEMPRE antes de cambiar de tablero activo.
export function invalidateSync() {
  // Cancelar el rebote a secas perdería lo que el usuario acaba de escribir,
  // así que primero se envía, y sólo después se invalida.
  flushPendingChanges();
  generation++;
  // Se recalcula al volver: la marca `reconcile` sigue en el índice.
  pendingConflict = null;
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
  // Pendiente de reconciliar: subir a ciegas pisaría lo que el equipo hizo
  // mientras estábamos desconectados, que es justo lo que el usuario decide.
  if (ctx.remote.reconcile) return;

  const slug = ctx.slug;
  const diff = diffState(getState(), readSnapshot(slug));
  if (!hasChanges(diff)) return;

  pushChanges(ctx.server, ctx.remote.boardId, {
    baseVersion: ctx.remote.baseVersion || 0,
    cards: diff.cards, ws: diff.ws, meta: diff.meta, cols: diff.cols, deletes: diff.deletes
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
  const out = {
    rev: serverState.rev || 2,
    meta: pickFields(serverState.meta || {}, META_FIELDS),
    ws: (serverState.ws || []).map(function (w) {
      return Object.assign({ key: w.key }, pickFields(w, WS_FIELDS));
    }),
    cards: (serverState.cards || []).map(function (c) {
      return Object.assign({ id: c.id }, pickFields(c, CARD_FIELDS));
    })
  };
  if (Array.isArray(serverState.cols)) out.cols = normalizeCols(serverState.cols);
  return out;
}

// Las columnas se comparan como lista entera: el orden también es un cambio.
// Un tablero que nunca tocó sus columnas no tiene `cols`, y eso equivale a la
// lista de fábrica.
function colsKey(cols) {
  return JSON.stringify(normalizeCols(cols));
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
  if (Array.isArray(current.cols) && colsKey(current.cols) !== colsKey(base.cols)) {
    out.cols = normalizeCols(current.cols);
  }
  return out;
}

export function hasChanges(diff) {
  return Boolean(diff.cards.length || diff.ws.length || diff.deletes.length || diff.meta || diff.cols);
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
  if (diff.cols) next.cols = clone(diff.cols);
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
  if (getPendingConflict()) return;
  if (currentStatus !== "syncing") setStatus("pending");
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(function () { syncNow(); }, SYNC_DEBOUNCE_MS);
}

// Llamar al cambiar de tablero para que el indicador refleje el nuevo contexto.
export function refreshSyncStatus() {
  const ctx = activeRemoteContext();
  if (!ctx) { setLocalStatus(); return; }
  if (!isSessionValid(ctx.server)) { expireSession(ctx.server); return; }
  if (getPendingConflict()) { setStatus("conflict", CONFLICT_DETAIL); return; }
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
  if (!ctx) { setLocalStatus(); return; }
  if (!isSessionValid(ctx.server)) { expireSession(ctx.server); return; }
  if (getPendingConflict()) { setStatus("conflict", CONFLICT_DETAIL); return; }

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
    // Recién reenganchado tras una desconexión: antes de subir nada se
    // compara con lo que el equipo hizo mientras tanto.
    if (ctx.remote.reconcile) {
      const listo = await reconcile(ctx, sigueVigente);
      if (!listo) return;
      // Reconciliado sin choques: el estado ya está fusionado y la
      // instantánea al día; lo que quede por subir sale en el próximo turno.
      setTimeout(function () { syncNow(); }, 0);
      return;
    }

    let version, serverState, conflicts = [];

    // El `if` mira el rol antes que la diferencia: si un invitado de sólo
    // lectura tiene cambios locales (los hizo antes de este arreglo, otra
    // pestaña, una importación) no se pueden subir, y si intentáramos subirlos
    // el 403 impediría además descargar. Se descarga y su copia se descarta.
    if (!soloLectura && hasChanges(diff)) {
      const r = await pushChanges(ctx.server, ctx.remote.boardId, {
        baseVersion: baseVersion,
        cards: diff.cards, ws: diff.ws, meta: diff.meta, cols: diff.cols, deletes: diff.deletes,
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
    const ctx = activeRemoteContext();
    if (ctx) expireSession(ctx.server);
    else setStatus("auth", "Sesión expirada");
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

// -- Desconexión automática y reenganche ------------------------------------
//
// Cuando la sesión caduca, los tableros de ese servidor pasan a ser locales
// sin que nadie tenga que pulsar «Desconectar»: se puede seguir trabajando.
// Pero no se olvida de dónde venían: la entrada guarda `detached` (el enlace
// remoto) y la instantánea de la última sincronización se conserva. Al volver
// a entrar en el mismo servidor con el mismo usuario se reenganchan solos y se
// reconcilian contra lo que el equipo hizo mientras tanto.

const DETACHED_DETAIL = "Desconectado del servidor. Vuelve a conectarte desde ⊞ Tableros y los cambios se sincronizarán solos.";
const CONFLICT_DETAIL = "Hay cambios tuyos y del equipo sobre lo mismo. Pulsa para decidir qué versión se queda.";

function setLocalStatus() {
  const entry = getBoardEntry(getStateSlug());
  if (entry && entry.kind !== "remote" && entry.detached) setStatus("detached", DETACHED_DETAIL);
  else setStatus("local");
}

export function detachedServerOf(slug) {
  const entry = getBoardEntry(slug);
  return entry && entry.kind !== "remote" && entry.detached ? entry.detached.serverId : null;
}

// Pasa a locales los tableros de un servidor recordando su enlace.
export function detachServerBoards(serverId) {
  const now = new Date().toISOString();
  let n = 0;
  for (const entry of listAllBoards()) {
    if (entry.kind === "remote" && entry.remote && entry.remote.serverId === serverId) {
      patchBoardEntry(entry.slug, {
        kind: "local", remote: null,
        detached: Object.assign({}, entry.remote, { detachedAt: now })
      });
      n++;
    }
  }
  return n;
}

// Reengancha los tableros desconectados de un servidor. Devuelve sus slugs.
export function reattachServerBoards(serverId) {
  const slugs = [];
  for (const entry of listAllBoards()) {
    const d = entry.detached;
    if (entry.kind === "remote" || !d || d.serverId !== serverId) continue;
    const remote = Object.assign({}, d, { reconcile: true });
    delete remote.detachedAt;
    patchBoardEntry(entry.slug, { kind: "remote", remote: remote, detached: null });
    slugs.push(entry.slug);
  }
  return slugs;
}

// Tras reenganchar: si el tablero en pantalla es uno de ellos, la interfaz se
// pone al día (bitácora, sólo lectura, indicador) y arranca la reconciliación.
export function resumeAfterReattach(slugs) {
  if (!slugs || slugs.indexOf(getStateSlug()) < 0) return;
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  refreshSyncStatus();
  syncNow();
}

// Tras desconectar a mano: el tablero en pantalla pudo dejar de ser remoto.
export function notifyBoardsChanged() {
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  refreshSyncStatus();
}

// Desconexión automática por sesión caducada. Idempotente: varias pestañas o
// varios sondeos pueden llegar aquí a la vez.
export function expireSession(server) {
  const yaCaducada = !server.token;
  markSessionExpired(server.id);
  const n = detachServerBoards(server.id);
  if (n || !yaCaducada) {
    showToast("Tu sesión en " + server.url + " expiró. " +
      (n ? (n === 1 ? "El tablero compartido sigue" : "Los " + n + " tableros compartidos siguen") +
           " aquí como local" + (n === 1 ? "" : "es") + "; al volver a conectarte se sincronizará" +
           (n === 1 ? "" : "n") + " solo" + (n === 1 ? "" : "s") + "."
         : "Vuelve a conectarte desde ⊞ Tableros."), "warn", 9000);
  }
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  setLocalStatus();
}

// Al arrancar: sesiones caducadas por reloj. No toca la red.
export function expireStaleSessions() {
  for (const server of listServers()) {
    if (server.token && !isSessionValid(server)) expireSession(server);
  }
}

// -- Reconciliación a tres vías ---------------------------------------------
//
// base = instantánea de la última sincronización (lo que ambos lados tenían),
// local = lo que hay en este navegador, remote = lo que hay ahora en el
// servidor. Lo que sólo cambió de un lado se combina solo, campo a campo. Lo
// que cambió de los dos lados de forma distinta es un conflicto y lo decide
// el usuario: «mine» se queda con lo de este navegador, «theirs» con lo del
// servidor. Los comentarios nunca chocan: se unen.

const CARD_MERGE_FIELDS = CARD_FIELDS.filter(function (f) { return f !== "comments"; });

function unionComments(a, b) {
  const byId = new Map();
  (Array.isArray(a) ? a : []).forEach(function (c) { if (c && c.id) byId.set(c.id, c); });
  (Array.isArray(b) ? b : []).forEach(function (c) { if (c && c.id && !byId.has(c.id)) byId.set(c.id, c); });
  return [...byId.values()].sort(function (x, y) { return String(x.at || "").localeCompare(String(y.at || "")); });
}

function changedFields(a, b, fields) {
  return fields.filter(function (f) { return normValue(a[f]) !== normValue(b[f]); });
}

function mergeEntities(kind, idKey, fields, baseList, localList, out, choices, conflicts) {
  const baseMap = new Map((baseList || []).map(function (x) { return [x[idKey], x]; }));
  const localMap = new Map((localList || []).map(function (x) { return [x[idKey], x]; }));
  const ids = new Set([...baseMap.keys(), ...localMap.keys()]);
  const titleOf = function (x) { return x ? (kind === "card" ? x.t : x.label) : ""; };

  for (const id of ids) {
    const b = baseMap.get(id), l = localMap.get(id);
    const ri = out.findIndex(function (x) { return x[idKey] === id; });
    const r = ri >= 0 ? out[ri] : null;
    const key = kind + ":" + id;
    const mine = (choices[key] || "mine") === "mine";
    const conflict = function (clash) {
      conflicts.push({ key: key, kind: kind, id: id, title: titleOf(l) || titleOf(r) || titleOf(b),
                       fields: clash, mine: l ? clone(l) : null, theirs: r ? clone(r) : null });
    };

    if (!b) {
      // Nuevo en este navegador (o creado a la vez en los dos lados).
      if (!l) continue;
      if (!r) { out.push(clone(l)); continue; }
      const clash = changedFields(l, r, fields);
      if (clash.length) {
        conflict(clash);
        if (mine) out[ri] = Object.assign({}, r, clone(l));
      }
      if (kind === "card") out[ri].comments = unionComments(r.comments, l.comments);
      continue;
    }

    if (!l) {
      // Borrado aquí.
      if (!r) continue;
      if (!changedFields(r, b, fields).length) { out.splice(ri, 1); continue; }
      conflict(changedFields(r, b, fields));
      if (mine) out.splice(ri, 1);
      continue;
    }

    const localChanged = changedFields(l, b, fields);
    if (!r) {
      // Borrado en el servidor. Si aquí no se tocó, se acepta el borrado.
      if (!localChanged.length) continue;
      conflict(localChanged);
      if (mine) out.push(clone(l));
      continue;
    }
    const remoteChanged = changedFields(r, b, fields);
    const clash = localChanged.filter(function (f) {
      return remoteChanged.indexOf(f) >= 0 && normValue(l[f]) !== normValue(r[f]);
    });
    if (clash.length) conflict(clash);
    const next = Object.assign({}, r);
    localChanged.forEach(function (f) {
      if (clash.indexOf(f) < 0 || mine) next[f] = clone(l[f]);
    });
    if (kind === "card") next.comments = unionComments(r.comments, l.comments);
    out[ri] = next;
  }
}

/**
 * Fusiona base/local/remote. Con `choices` vacío sirve para detectar: lo que
 * choca se apunta en `conflicts` (y provisionalmente se resuelve a favor de
 * lo local). Con las decisiones del usuario produce el estado definitivo.
 */
export function threeWayMerge(base, local, remote, choices) {
  choices = choices || {};
  base = base || { meta: {}, ws: [], cards: [] };
  const conflicts = [];
  const out = clone(remote);
  out.cards = out.cards || [];
  out.ws = out.ws || [];

  mergeEntities("ws", "key", WS_FIELDS, base.ws, local.ws, out.ws, choices, conflicts);
  mergeEntities("card", "id", CARD_MERGE_FIELDS, base.cards, local.cards, out.cards, choices, conflicts);

  // Encabezado: una sola entidad, campo a campo.
  const bm = base.meta || {}, lm = local.meta || {}, rm = remote.meta || {};
  const metaLocal = changedFields(lm, bm, META_FIELDS);
  if (metaLocal.length) {
    const metaRemote = changedFields(rm, bm, META_FIELDS);
    const clash = metaLocal.filter(function (f) {
      return metaRemote.indexOf(f) >= 0 && normValue(lm[f]) !== normValue(rm[f]);
    });
    const mine = (choices["meta:meta"] || "mine") === "mine";
    if (clash.length) {
      conflicts.push({ key: "meta:meta", kind: "meta", id: "meta", title: lm.title || rm.title || "",
                       fields: clash, mine: clone(lm), theirs: clone(rm) });
    }
    out.meta = Object.assign({}, rm);
    metaLocal.forEach(function (f) {
      if (clash.indexOf(f) < 0 || mine) out.meta[f] = lm[f];
    });
  }

  // Columnas: la lista entera es una pieza (el orden es del conjunto).
  const colsLocal = colsKey(local.cols) !== colsKey(base.cols);
  if (colsLocal) {
    const colsRemote = colsKey(remote.cols) !== colsKey(base.cols);
    const clash = colsRemote && colsKey(local.cols) !== colsKey(remote.cols);
    const mine = (choices["cols:cols"] || "mine") === "mine";
    if (clash) {
      conflicts.push({ key: "cols:cols", kind: "cols", id: "cols", title: "Columnas",
                       fields: ["cols"], mine: normalizeCols(local.cols), theirs: normalizeCols(remote.cols) });
    }
    if (!clash || mine) out.cols = normalizeCols(local.cols);
  }

  return { state: out, conflicts: conflicts };
}

// Primer contacto tras reenganchar. Devuelve true si quedó reconciliado sin
// intervención; false si hay que esperar al usuario (o se abandonó).
async function reconcile(ctx, sigueVigente) {
  const slug = ctx.slug;
  const fresh = await fetchBoard(ctx.server, ctx.remote.boardId);
  if (!sigueVigente()) return false;

  const remote = stripVersions(fresh.state);
  const base = readSnapshot(slug) || { meta: {}, ws: [], cards: [] };
  const role = fresh.role || ctx.remote.role || "write";

  // Sin permiso de escritura no hay nada que decidir: manda el servidor.
  if (role === "read") {
    finishReconcile(slug, fresh.version, role, remote, remote);
    if (hasChanges(diffState(getState(), remote))) {
      showToast("Tablero de sólo lectura: se descartaron los cambios hechos sin conexión", "warn", 7000);
    }
    return true;
  }

  const r = threeWayMerge(base, getState(), remote);
  if (!r.conflicts.length) {
    finishReconcile(slug, fresh.version, role, remote, r.state);
    return true;
  }

  pendingConflict = { slug: slug, version: fresh.version, role: role, base: base, remote: remote,
                      conflicts: r.conflicts };
  setStatus("conflict", CONFLICT_DETAIL);
  showToast(r.conflicts.length === 1
    ? "Al reconectar, un elemento cambió aquí y en el servidor: decide cuál se queda"
    : "Al reconectar, " + r.conflicts.length + " elementos cambiaron aquí y en el servidor: decide cuáles se quedan",
    "warn", 8000);
  for (const fn of conflictListeners) fn(pendingConflict);
  return false;
}

function finishReconcile(slug, version, role, remote, merged) {
  const entry = getBoardEntry(slug);
  if (!entry || !entry.remote || getStateSlug() !== slug) return;
  writeSnapshot(slug, remote);
  const nextRemote = Object.assign({}, entry.remote, {
    baseVersion: version, role: role, lastSync: new Date().toISOString()
  });
  delete nextRemote.reconcile;
  patchBoardEntry(slug, { remote: nextRemote });
  pendingConflict = null;
  applying = true;
  try { setState(merged, true); } finally { applying = false; }
  if (typeof onAppliedCallback === "function") onAppliedCallback();
  setStatus(role === "read" ? "readonly" : (hasChanges(diffState(getState(), remote)) ? "pending" : "synced"));
}

// Decisión del usuario: { "card:ID": "mine" | "theirs", ... }. Se recalcula
// sobre el estado local de ahora, por si se siguió editando con el aviso
// abierto; lo que no tenga decisión se queda con lo local.
export function resolveConflicts(choices) {
  const p = getPendingConflict();
  if (!p) return false;
  const r = threeWayMerge(p.base, getState(), p.remote, choices || {});
  finishReconcile(p.slug, p.version, p.role, p.remote, r.state);
  syncNow();
  return true;
}
