// Fusión por entidad de un tablero Kanban.
//
// El cliente envía sólo lo que cambió desde su `baseVersion` (calculado
// comparando su estado actual contra la instantánea de su última
// sincronización). El servidor fusiona entidad por entidad y devuelve el
// tablero completo, de modo que dos personas que tocan tarjetas distintas
// nunca se pisan.
//
// Resolución de conflictos: gana quien llega último al servidor. Si la
// entidad cambió en el servidor después de la `baseVersion` del cliente, se
// aplica igual el cambio entrante pero se reporta como conflicto para que la
// UI pueda avisar. Las versiones (`v`) las asigna siempre el servidor; nunca
// se confía en las que mande el cliente.

const MAX_STR = 400;
// La descripción admite texto enriquecido (listas de subtareas incluidas), así
// que tiene su propio tope, más holgado que el del resto de campos. Debe ser
// >= MAX_DESC del cliente (src/js/config.js) o el servidor truncaría en
// silencio lo que el usuario escribió.
const MAX_STR_DESC = 2000;
const MAX_CARDS = 2000;
const MAX_WS = 100;
// Las lápidas se conservan este número de versiones para que un cliente
// desactualizado no resucite una tarjeta borrada.
const TOMBSTONE_TTL_VERSIONS = 500;

const CARD_FIELDS = ["id", "ws", "pri", "col", "t", "d", "due", "cr", "st", "dn", "ca"];
// Etiquetas y comentarios son listas, no cadenas: tienen su propio saneado.
const MAX_LABELS = 8;
const MAX_LABEL_LEN = 24;
const MAX_COMMENTS = 60;
const MAX_COMMENT_LEN = 600;
const WS_FIELDS = ["key", "label", "color"];
// PALETTE[6] del cliente (src/js/config.js): el color al que caen los frentes
// cuyo color llega vacio o mal formado.
const DEFAULT_WS_COLOR = "#3c74e0";
const META_FIELDS = ["eyebrow", "title", "titleThin", "subtitle", "branch"];

function str(value, max = MAX_STR) {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

const FIELD_MAX = { d: MAX_STR_DESC };

function pick(source, fields) {
  const out = {};
  for (const f of fields) out[f] = str(source[f], FIELD_MAX[f] || MAX_STR);
  return out;
}

function sanitizeLabels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const label = str(value, MAX_LABEL_LEN).trim().toLowerCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

// Los comentarios son de sólo añadir: sin borrados no
// hacen falta lápidas para fusionarlos, basta la unión por id.
function sanitizeComments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = str(item.id, 60).trim();
    const text = str(item.text, MAX_COMMENT_LEN);
    if (!id || !text.trim() || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: id, at: str(item.at, 40), by: str(item.by, 60), text: text });
  }
  return out.slice(-MAX_COMMENTS);
}

export function sanitizeCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id, 80).trim();
  if (!id) return null;
  const card = pick(raw, CARD_FIELDS);
  card.id = id;
  card.labels = sanitizeLabels(raw.labels);
  card.comments = sanitizeComments(raw.comments);
  return card;
}

// Unión por id, ordenada por fecha. Dos personas que comentan la misma tarjeta
// a la vez conservan los dos comentarios: sin esto, la fusión por entidad
// (gana quien llega último) tiraría el comentario del primero.
export function mergeComments(stored, incoming) {
  const byId = new Map();
  for (const c of Array.isArray(stored) ? stored : []) byId.set(c.id, c);
  for (const c of Array.isArray(incoming) ? incoming : []) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()]
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(-MAX_COMMENTS);
}

// Igualdad por valor. Dos cosas que hay que tratar aquí: las listas no se
// pueden comparar con `===`, y un tablero guardado antes de que existieran los
// campos nuevos no los tiene — comparar "" contra undefined daría "cambiado"
// para todas sus tarjetas y quemaría una versión por cada una en el primer
// envío de cualquier cliente.
function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  const na = a === undefined || a === null ? "" : a;
  const nb = b === undefined || b === null ? "" : b;
  return na === nb;
}

// Solo se aceptan colores hexadecimales: el cliente los inyecta en un atributo
// HTML y en una variable CSS, asi que no pueden llevar comillas ni parentesis.
// Admite las cuatro longitudes validas en CSS (#rgb, #rgba, #rrggbb, #rrggbbaa).
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function sanitizeWs(raw) {
  if (!raw || typeof raw !== "object") return null;
  const key = str(raw.key, 40).trim();
  if (!key) return null;
  const ws = pick(raw, WS_FIELDS);
  ws.key = key;
  if (!HEX_COLOR_RE.test(ws.color)) ws.color = DEFAULT_WS_COLOR;
  return ws;
}

// Columnas del tablero: nombre, orden y color. Viajan como una lista entera
// con una sola versión (`colsV`): el orden es una propiedad del conjunto, no
// de cada columna, y fusionarlas por separado podría dejar dos columnas en la
// misma posición. Las claves las decide el cliente; aquí sólo se acotan.
const MAX_COLS = 20;
const MAX_COL_NAME = 30;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function sanitizeCols(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const c of raw.slice(0, MAX_COLS)) {
    if (!c || typeof c !== "object") continue;
    const key = str(c.key, 40).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const color = str(c.color, 7);
    out.push({ key, name: str(c.name, MAX_COL_NAME).trim(), color: HEX_COLOR.test(color) ? color.toLowerCase() : "" });
  }
  return out.length ? out : null;
}

function sameCols(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

export function sanitizeMeta(raw) {
  return pick(raw && typeof raw === "object" ? raw : {}, META_FIELDS);
}

export function emptyState() {
  return {
    rev: 2,
    meta: Object.assign(sanitizeMeta({}), { v: 1 }),
    ws: [],
    cards: [],
    deleted: []
  };
}

// Normaliza un estado completo recibido del cliente (al crear un tablero).
export function sanitizeState(raw, version) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;

  base.meta = Object.assign(sanitizeMeta(raw.meta), { v: version });

  const seenWs = new Set();
  for (const w of Array.isArray(raw.ws) ? raw.ws.slice(0, MAX_WS) : []) {
    const clean = sanitizeWs(w);
    if (!clean || seenWs.has(clean.key)) continue;
    seenWs.add(clean.key);
    base.ws.push(Object.assign(clean, { v: version }));
  }

  const cols = sanitizeCols(raw.cols);
  if (cols) { base.cols = cols; base.colsV = version; }

  const seenCards = new Set();
  for (const c of Array.isArray(raw.cards) ? raw.cards.slice(0, MAX_CARDS) : []) {
    const clean = sanitizeCard(c);
    if (!clean || seenCards.has(clean.id)) continue;
    seenCards.add(clean.id);
    base.cards.push(Object.assign(clean, { v: version }));
  }

  return base;
}

function indexBy(list, key) {
  const map = new Map();
  for (const item of list) map.set(item[key], item);
  return map;
}

/**
 * @param {object} stored      estado actual en el servidor
 * @param {object} incoming    { meta?, ws?: [], cards?: [], deletes?: [{id,kind}] }
 * @param {number} baseVersion versión que el cliente tenía sincronizada
 * @param {number} version     versión nueva a asignar a lo que cambie
 * @returns {{ state: object, conflicts: string[], changed: boolean }}
 */
// Cuánto destruye una sincronización respecto a lo que hay guardado. Sirve
// para frenar el caso catastrófico: un percance local (una importación, una
// condición de carrera, un tablero equivocado) se propaga al tablero
// compartido como "borra todo y mete esto otro", y nadie se entera hasta que
// el trabajo de los demás ya no está.
export function assessDestruction(stored, incoming) {
  const existentes = new Set([
    ...stored.cards.map(c => "card:" + c.id),
    ...stored.ws.map(w => "ws:" + w.key)
  ]);
  const borradas = new Set();
  for (const d of Array.isArray(incoming.deletes) ? incoming.deletes : []) {
    const clave = (d && d.kind === "ws" ? "ws:" : "card:") + (d && d.id);
    if (existentes.has(clave)) borradas.add(clave);
  }
  const total = existentes.size;
  return {
    deletes: borradas.size,
    total: total,
    ratio: total ? borradas.size / total : 0
  };
}

export function mergeBoard(stored, incoming, baseVersion, version) {
  const state = {
    rev: stored.rev || 2,
    meta: Object.assign({}, stored.meta),
    ws: stored.ws.map(w => Object.assign({}, w)),
    cards: stored.cards.map(c => Object.assign({}, c)),
    deleted: (stored.deleted || []).map(d => Object.assign({}, d))
  };
  if (stored.cols) { state.cols = stored.cols.map(c => Object.assign({}, c)); state.colsV = stored.colsV || 0; }

  const conflicts = [];
  let changed = false;

  const cardIndex = indexBy(state.cards, "id");
  const wsIndex = indexBy(state.ws, "key");
  const tombIndex = new Map(state.deleted.map(d => [d.kind + ":" + d.id, d]));

  // -- Borrados --
  for (const del of Array.isArray(incoming.deletes) ? incoming.deletes : []) {
    const kind = del && del.kind === "ws" ? "ws" : "card";
    const id = str(del && del.id, 80).trim();
    if (!id) continue;

    const index = kind === "ws" ? wsIndex : cardIndex;
    const existing = index.get(id);
    if (!existing) continue; // ya no estaba: nada que hacer

    // Alguien lo modificó después de nuestra base: el borrado gana, pero avisamos.
    if (existing.v > baseVersion) conflicts.push(id);

    index.delete(id);
    const key = kind + ":" + id;
    const tomb = { id, kind, v: version };
    tombIndex.set(key, tomb);
    changed = true;
  }

  // -- Altas y ediciones --
  const upsert = (raw, kind, sanitize, index) => {
    const clean = sanitize(raw);
    if (!clean) return;
    const id = kind === "ws" ? clean.key : clean.id;
    const existing = index.get(id);

    if (!existing) {
      // Si otro cliente lo borró después de nuestra base, no lo resucitamos.
      const tomb = tombIndex.get(kind + ":" + id);
      if (tomb && tomb.v > baseVersion) {
        conflicts.push(id);
        return;
      }
      tombIndex.delete(kind + ":" + id);
      index.set(id, Object.assign(clean, { v: version }));
      changed = true;
      return;
    }

    // Los comentarios se unen antes de comparar: lo que trae el cliente puede
    // no incluir los que otro añadió después de su base.
    if (kind === "card") clean.comments = mergeComments(existing.comments, clean.comments);

    // Sin cambios reales: no gastamos una versión.
    const sameContent = Object.keys(clean).every(k => sameValue(clean[k], existing[k]));
    if (sameContent) return;

    // Añadir un comentario no pisa el trabajo de nadie: la unión conserva los
    // de todos, así que no es un conflicto aunque la tarjeta haya cambiado
    // desde la base del cliente.
    const soloComentarios = kind === "card" &&
      Object.keys(clean).every(k => k === "comments" || sameValue(clean[k], existing[k]));

    if (existing.v > baseVersion && !soloComentarios) conflicts.push(id);
    index.set(id, Object.assign(clean, { v: version }));
    changed = true;
  };

  for (const w of Array.isArray(incoming.ws) ? incoming.ws.slice(0, MAX_WS) : []) {
    upsert(w, "ws", sanitizeWs, wsIndex);
  }
  for (const c of Array.isArray(incoming.cards) ? incoming.cards.slice(0, MAX_CARDS) : []) {
    upsert(c, "card", sanitizeCard, cardIndex);
  }

  // -- Encabezado --
  if (incoming.meta && typeof incoming.meta === "object") {
    const clean = sanitizeMeta(incoming.meta);
    const same = META_FIELDS.every(f => clean[f] === state.meta[f]);
    if (!same) {
      if (state.meta.v > baseVersion) conflicts.push("meta");
      state.meta = Object.assign(clean, { v: version });
      changed = true;
    }
  }

  // -- Columnas --
  const cols = sanitizeCols(incoming.cols);
  if (cols && !sameCols(cols, state.cols)) {
    if ((state.colsV || 0) > baseVersion) conflicts.push("cols");
    state.cols = cols;
    state.colsV = version;
    changed = true;
  }

  state.ws = [...wsIndex.values()];
  state.cards = [...cardIndex.values()];
  state.deleted = [...tombIndex.values()]
    .filter(d => d.v > version - TOMBSTONE_TTL_VERSIONS);

  // Referencias colgantes: una tarjeta cuyo frente borró otra persona.
  const validWs = new Set(state.ws.map(w => w.key));
  const fallback = state.ws.length ? state.ws[0].key : "";
  for (const card of state.cards) {
    if (!validWs.has(card.ws)) {
      card.ws = fallback;
      card.v = version;
      changed = true;
    }
  }

  return { state, conflicts: [...new Set(conflicts)], changed };
}

// -- Bitácora: diferencia legible entre dos estados consecutivos ------------
//
// El histórico guarda estados completos, no acciones. La bitácora se deriva
// comparando la versión archivada N contra la N+1: así no hace falta un
// registro de eventos paralelo que se pueda desincronizar del estado real.
// El servidor devuelve datos (qué entidad, qué acción, qué campos); el texto
// lo compone el cliente, que es quien conoce los nombres de las columnas.

// Los sellos de flujo (cr, st, dn, ca) NO entran aquí a propósito. Dos
// razones, y la segunda es una regresión de verdad:
//   1. Cambian siempre junto a `col`, así que la bitácora repetiría "cambió
//      ca" en cada movimiento, sin decir nada que no dijera ya la línea.
//   2. El movimiento se reconoce abajo por `fields` === ["col"] a secas. Con
//      los sellos dentro, `fields` sería ["col","ca"] y TODO movimiento
//      degradaría a `action: "edit"`: la bitácora dejaría de decir "movió X
//      de A a B".
const DIFF_CARD_FIELDS = ["ws", "pri", "col", "t", "d", "labels", "due"];
const DIFF_WS_FIELDS = ["label", "color"];

// Cuántos comentarios se añadieron entre dos versiones (nunca se borran).
function nuevosComentarios(before, after) {
  const antes = new Set((Array.isArray(before) ? before : []).map(c => c.id));
  return (Array.isArray(after) ? after : []).filter(c => !antes.has(c.id)).length;
}

export function diffStates(prev, next) {
  const changes = [];
  const prevCards = indexBy(prev.cards || [], "id");
  const nextCards = indexBy(next.cards || [], "id");

  for (const [id, card] of nextCards) {
    const before = prevCards.get(id);
    if (!before) {
      changes.push({ kind: "card", action: "add", id, title: card.t, to: card.col });
      continue;
    }
    const nuevos = nuevosComentarios(before.comments, card.comments);
    if (nuevos) {
      changes.push({ kind: "card", action: "comment", id, title: card.t, count: nuevos });
    }
    const fields = DIFF_CARD_FIELDS.filter(f => !sameValue(before[f] || "", card[f] || ""));
    if (!fields.length) continue;
    if (fields.length === 1 && fields[0] === "col") {
      changes.push({ kind: "card", action: "move", id, title: card.t, from: before.col, to: card.col });
    } else {
      const change = { kind: "card", action: "edit", id, title: card.t, fields };
      if (fields.includes("col")) { change.from = before.col; change.to = card.col; }
      changes.push(change);
    }
  }
  for (const [id, card] of prevCards) {
    if (!nextCards.has(id)) changes.push({ kind: "card", action: "delete", id, title: card.t });
  }

  const prevWs = indexBy(prev.ws || [], "key");
  const nextWs = indexBy(next.ws || [], "key");
  for (const [key, ws] of nextWs) {
    const before = prevWs.get(key);
    if (!before) {
      changes.push({ kind: "ws", action: "add", id: key, title: ws.label });
      continue;
    }
    const fields = DIFF_WS_FIELDS.filter(f => (before[f] || "") !== (ws[f] || ""));
    if (fields.length) changes.push({ kind: "ws", action: "edit", id: key, title: ws.label, fields });
  }
  for (const [key, ws] of prevWs) {
    if (!nextWs.has(key)) changes.push({ kind: "ws", action: "delete", id: key, title: ws.label });
  }

  if (!sameCols(prev.cols, next.cols)) {
    const antes = new Map((prev.cols || []).map(c => [c.key, c]));
    const fields = [];
    const orden = c => (c || []).map(x => x.key).join(",");
    if (prev.cols && orden(prev.cols) !== orden(next.cols)) fields.push("order");
    if ((next.cols || []).some(c => (antes.get(c.key) || {}).name !== c.name)) fields.push("name");
    if ((next.cols || []).some(c => ((antes.get(c.key) || {}).color || "") !== c.color)) fields.push("color");
    changes.push({ kind: "cols", action: "edit", id: "cols", title: "", fields: fields.length ? fields : ["name"] });
  }

  const metaFields = META_FIELDS.filter(f =>
    ((prev.meta || {})[f] || "") !== ((next.meta || {})[f] || ""));
  if (metaFields.length) {
    changes.push({ kind: "meta", action: "edit", id: "meta",
                   title: (next.meta || {}).title || "", fields: metaFields });
  }

  return changes;
}
