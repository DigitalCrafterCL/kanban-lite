import test from "node:test";
import assert from "node:assert/strict";
import { mergeBoard, sanitizeState, emptyState, diffStates } from "../merge.js";

const board = (cards, ws = [{ key: "GEN", label: "General", color: "#000", v: 1 }]) => ({
  rev: 2,
  meta: { eyebrow: "", title: "T", titleThin: "", subtitle: "", branch: "", v: 1 },
  ws,
  cards,
  deleted: []
});
const card = (id, extra = {}) =>
  Object.assign({ id, ws: "GEN", pri: "media", col: "todo", t: "T " + id, d: "", v: 1 }, extra);

test("ediciones a tarjetas distintas conviven: nadie se pisa", () => {
  let state = board([card("FE-1"), card("BE-2"), card("QA-3")]);

  // Carlos (base 1) mueve FE-1
  let r = mergeBoard(state, { cards: [{ ...card("FE-1"), col: "inprogress" }] }, 1, 2);
  assert.deepEqual(r.conflicts, []);
  state = r.state;

  // Jose (base 1, desactualizado) edita BE-2
  r = mergeBoard(state, { cards: [{ ...card("BE-2"), t: "Editado por Jose" }] }, 1, 3);
  assert.deepEqual(r.conflicts, [], "tocar otra tarjeta no debe ser conflicto");
  state = r.state;

  const byId = Object.fromEntries(state.cards.map(c => [c.id, c]));
  assert.equal(byId["FE-1"].col, "inprogress", "el cambio de Carlos sobrevive");
  assert.equal(byId["BE-2"].t, "Editado por Jose", "el cambio de Jose sobrevive");
  assert.equal(byId["QA-3"].t, "T QA-3", "lo que nadie tocó queda igual");
});

test("editar la misma tarjeta reporta conflicto y gana quien llega último", () => {
  let state = board([card("FE-1")]);
  state = mergeBoard(state, { cards: [{ ...card("FE-1"), t: "version de Carlos" }] }, 1, 2).state;

  const r = mergeBoard(state, { cards: [{ ...card("FE-1"), t: "version de Jose" }] }, 1, 3);
  assert.deepEqual(r.conflicts, ["FE-1"]);
  assert.equal(r.state.cards[0].t, "version de Jose");
});

test("un alta nueva nunca es conflicto", () => {
  const state = board([card("FE-1")]);
  const r = mergeBoard(state, { cards: [card("QA-9")] }, 1, 2);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.state.cards.length, 2);
});

test("el borrado se propaga y no revive al reenviar un cliente viejo", () => {
  let state = board([card("FE-1"), card("BE-2")]);

  // Carlos borra FE-1 en la version 2
  let r = mergeBoard(state, { deletes: [{ id: "FE-1", kind: "card" }] }, 1, 2);
  state = r.state;
  assert.equal(state.cards.length, 1);
  assert.equal(state.deleted.length, 1);

  // Jose, todavia en base 1, reenvia FE-1 como si existiera
  r = mergeBoard(state, { cards: [card("FE-1")] }, 1, 3);
  assert.deepEqual(r.conflicts, ["FE-1"]);
  assert.equal(r.state.cards.length, 1, "la tarjeta borrada no debe resucitar");
});

test("un cliente al dia puede recrear una tarjeta con un id reutilizado", () => {
  let state = board([card("FE-1")]);
  state = mergeBoard(state, { deletes: [{ id: "FE-1", kind: "card" }] }, 1, 2).state;

  // Cliente que ya vio el borrado (base 2) crea FE-1 de nuevo
  const r = mergeBoard(state, { cards: [card("FE-1", { t: "nueva" })] }, 2, 3);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.state.cards.length, 1);
  assert.equal(r.state.cards[0].t, "nueva");
  assert.equal(r.state.deleted.length, 0, "la lapida se limpia al recrear");
});

test("borrar algo que otro acaba de editar avisa del conflicto", () => {
  let state = board([card("FE-1")]);
  state = mergeBoard(state, { cards: [{ ...card("FE-1"), t: "editada" }] }, 1, 2).state;

  const r = mergeBoard(state, { deletes: [{ id: "FE-1", kind: "card" }] }, 1, 3);
  assert.deepEqual(r.conflicts, ["FE-1"]);
  assert.equal(r.state.cards.length, 0, "el borrado gana por orden de llegada");
});

test("reenviar contenido identico no consume version ni marca cambio", () => {
  const state = board([card("FE-1")]);
  const r = mergeBoard(state, { cards: [card("FE-1")] }, 1, 2);
  assert.equal(r.changed, false);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.state.cards[0].v, 1, "la version de la entidad no debe avanzar");
});

test("una tarjeta huerfana se reasigna al primer frente disponible", () => {
  const state = board([card("FE-1", { ws: "OPS" })], [
    { key: "GEN", label: "General", color: "#000", v: 1 },
    { key: "OPS", label: "Infra", color: "#111", v: 1 }
  ]);
  const r = mergeBoard(state, { deletes: [{ id: "OPS", kind: "ws" }] }, 1, 2);
  assert.equal(r.state.ws.length, 1);
  assert.equal(r.state.cards[0].ws, "GEN", "no debe quedar apuntando a un frente inexistente");
});

test("el cliente no puede imponer versiones ni colar campos extra", () => {
  const state = board([card("FE-1")]);
  const r = mergeBoard(state, {
    cards: [{ id: "FE-1", ws: "GEN", pri: "alta", col: "todo", t: "x", d: "",
              v: 99999, esAdmin: true, __proto__: { contaminado: true } }]
  }, 1, 2);
  const merged = r.state.cards[0];
  assert.equal(merged.v, 2, "la version la asigna el servidor");
  assert.equal(merged.esAdmin, undefined, "los campos desconocidos se descartan");
  assert.equal({}.contaminado, undefined, "sin contaminacion de prototipo");
});

test("las cadenas se recortan y las tarjetas sin id se descartan", () => {
  const state = emptyState();
  const r = mergeBoard(state, {
    cards: [{ id: "OK-1", t: "x".repeat(5000), ws: "GEN", pri: "media", col: "todo", d: "" },
            { id: "   ", t: "sin id" },
            { t: "tampoco" }]
  }, 1, 2);
  assert.equal(r.state.cards.length, 1);
  assert.equal(r.state.cards[0].t.length, 400);
});

test("la descripción admite más texto que el resto de campos", () => {
  // Con texto enriquecido la descripción sostiene listas de subtareas: su tope
  // es mayor que el de los demás campos (ver MAX_DESC en src/js/config.js).
  const r = mergeBoard(emptyState(), {
    cards: [{ id: "OK-1", t: "titulo", ws: "GEN", pri: "media", col: "todo", d: "d".repeat(5000) }]
  }, 1, 2);
  assert.equal(r.state.cards[0].d.length, 2000);
});

test("etiquetas, fecha de cierre y comentarios sobreviven a la fusión", () => {
  const r = mergeBoard(emptyState(), {
    cards: [{ id: "OK-1", ws: "GEN", pri: "media", col: "todo", t: "T", d: "",
              labels: ["API", "api", "  urgente  ", ""], due: "2026-10-01",
              comments: [{ id: "c1", at: "2026-09-03T10:00:00Z", by: "victor", text: "primero" }] }]
  }, 1, 2);
  const c = r.state.cards[0];
  assert.deepEqual(c.labels, ["api", "urgente"], "se normalizan, se deduplican y se descartan las vacías");
  assert.equal(c.due, "2026-10-01");
  assert.deepEqual(c.comments.map(x => x.text), ["primero"]);
});

test("un cliente no puede colar campos raros en un comentario", () => {
  const r = mergeBoard(emptyState(), {
    cards: [{ id: "OK-1", ws: "GEN", pri: "media", col: "todo", t: "T", d: "",
              comments: [{ id: "c1", at: "x", by: "v", text: "hola", esAdmin: true },
                         { id: "", text: "sin id" },
                         { id: "c2", text: "   " }] }]
  }, 1, 2);
  const comments = r.state.cards[0].comments;
  assert.equal(comments.length, 1, "sin id o sin texto no es un comentario");
  assert.equal(comments[0].esAdmin, undefined);
});

test("dos personas comentando la misma tarjeta conservan los dos comentarios", () => {
  // Es la razón de que los comentarios sean de sólo añadir: la fusión por
  // entidad (gana quien llega último) tiraría el comentario del primero.
  const base = card("FE-1", { comments: [{ id: "c0", at: "2026-09-01T00:00:00Z", by: "a", text: "viejo" }] });
  let state = board([base]);

  state = mergeBoard(state, { cards: [{ ...base,
    comments: [base.comments[0], { id: "c1", at: "2026-09-02T00:00:00Z", by: "carlos", text: "de Carlos" }] }] }, 1, 2).state;

  // Jose sigue en la base 1: no vio el comentario de Carlos.
  const r = mergeBoard(state, { cards: [{ ...base,
    comments: [base.comments[0], { id: "c2", at: "2026-09-03T00:00:00Z", by: "jose", text: "de Jose" }] }] }, 1, 3);

  assert.deepEqual(r.state.cards[0].comments.map(c => c.text), ["viejo", "de Carlos", "de Jose"]);
  assert.deepEqual(r.conflicts, [], "añadir comentarios distintos no es un conflicto");
});

test("reenviar una tarjeta con listas idénticas no consume versión", () => {
  // Comparar arreglos con === los daría por distintos siempre y el cliente
  // subiría el tablero entero en cada sondeo.
  const c = card("FE-1", { labels: ["api"], due: "2026-10-01",
                           comments: [{ id: "c1", at: "z", by: "a", text: "hola" }] });
  const state = board([c]);
  const r = mergeBoard(state, { cards: [c] }, 1, 2);
  assert.equal(r.changed, false);
  assert.equal(r.state.cards[0].v, 1);
});

test("un tablero guardado antes de los campos nuevos no gasta versiones", () => {
  // Las tarjetas del servidor no tienen `due` ni `labels`: si comparar ""
  // contra undefined contara como cambio, el primer envío de cualquier
  // cliente marcaría el tablero entero como editado.
  const state = board([{ id: "FE-1", ws: "GEN", pri: "media", col: "todo", t: "T FE-1", d: "", v: 1 }]);
  const r = mergeBoard(state, { cards: [{ id: "FE-1", ws: "GEN", pri: "media", col: "todo", t: "T FE-1", d: "" }] }, 1, 2);
  assert.equal(r.changed, false);
});

test("sanitizeState descarta ids duplicados al crear un tablero", () => {
  const s = sanitizeState({
    meta: { title: "Equipo" },
    ws: [{ key: "GEN", label: "G", color: "#000" }, { key: "GEN", label: "duplicado", color: "#fff" }],
    cards: [card("A-1"), card("A-1")]
  }, 1);
  assert.equal(s.ws.length, 1);
  assert.equal(s.ws[0].label, "G");
  assert.equal(s.cards.length, 1);
});

// El cliente mete `ws.color` en un atributo HTML (`value="..."` del selector de
// color) y en una variable CSS. Un color con comillas dentro se saldria del
// atributo, asi que el servidor solo deja pasar hexadecimales.
test("un color que no es hexadecimal cae al color por defecto", () => {
  const s = sanitizeState({
    meta: { title: "Equipo" },
    ws: [
      { key: "XSS", label: "Hostil", color: '"><img src=x onerror=alert(1)>' },
      { key: "URL", label: "Fuga",   color: "url(http://ejemplo/pixel.png)" },
      { key: "VAC", label: "Vacio",  color: "" }
    ],
    cards: []
  }, 1);
  assert.deepEqual(s.ws.map(w => w.color), ["#3c74e0", "#3c74e0", "#3c74e0"]);
});

test("los hexadecimales validos se conservan tal cual", () => {
  const s = sanitizeState({
    meta: { title: "Equipo" },
    ws: [
      { key: "A", label: "a", color: "#000" },
      { key: "B", label: "b", color: "#0a8fa6" },
      { key: "C", label: "c", color: "#0A8FA6FF" }
    ],
    cards: []
  }, 1);
  assert.deepEqual(s.ws.map(w => w.color), ["#000", "#0a8fa6", "#0A8FA6FF"]);
});

test("tres clientes concurrentes desde la misma base conservan los tres cambios", () => {
  let state = board([card("FE-1"), card("BE-2"), card("QA-3")]);
  const base = 1;
  let v = 1;
  for (const [id, titulo] of [["FE-1", "Carlos"], ["BE-2", "Jose"], ["QA-3", "Victor"]]) {
    const r = mergeBoard(state, { cards: [{ ...card(id), t: titulo }] }, base, ++v);
    assert.deepEqual(r.conflicts, [], `${id} no deberia entrar en conflicto`);
    state = r.state;
  }
  assert.deepEqual(state.cards.map(c => c.t).sort(), ["Carlos", "Jose", "Victor"]);
});

// -- Bitácora ---------------------------------------------------------------

test("diffStates distingue alta, movimiento, edición y borrado", () => {
  const antes = board([card("FE-1"), card("BE-2"), card("QA-3")]);
  const despues = board([
    { ...card("FE-1"), col: "inprogress" },
    { ...card("BE-2"), t: "Nuevo título", pri: "alta" },
    card("NW-9")
  ]);

  const cambios = diffStates(antes, despues);
  const porId = Object.fromEntries(cambios.map(c => [c.id, c]));

  assert.equal(porId["FE-1"].action, "move");
  assert.equal(porId["FE-1"].from, "todo");
  assert.equal(porId["FE-1"].to, "inprogress");

  assert.equal(porId["BE-2"].action, "edit");
  assert.deepEqual(porId["BE-2"].fields.sort(), ["pri", "t"]);

  assert.equal(porId["NW-9"].action, "add");
  assert.equal(porId["QA-3"].action, "delete");
  assert.equal(porId["QA-3"].title, "T QA-3", "el borrado conserva el título de antes");
});

test("diffStates informa de etiquetas, fecha de cierre y comentarios nuevos", () => {
  const antes = board([card("FE-1", { labels: ["api"], due: "", comments: [] })]);
  const despues = board([card("FE-1", {
    labels: ["api", "urgente"], due: "2026-10-01",
    comments: [{ id: "c1", at: "z", by: "victor", text: "hola" }]
  })]);

  const cambios = diffStates(antes, despues);
  const edit = cambios.find(c => c.action === "edit");
  const comment = cambios.find(c => c.action === "comment");

  assert.deepEqual(edit.fields.sort(), ["due", "labels"]);
  assert.equal(comment.count, 1);
  assert.equal(comment.id, "FE-1");
});

test("diffStates no inventa cambios cuando el estado es idéntico", () => {
  const estado = board([card("FE-1")]);
  assert.deepEqual(diffStates(estado, JSON.parse(JSON.stringify(estado))), []);
});

test("diffStates reporta frentes y encabezado", () => {
  const antes = board([], [{ key: "GEN", label: "General", color: "#000", v: 1 }]);
  const despues = board([], [{ key: "GEN", label: "Plataforma", color: "#000", v: 2 },
                             { key: "SEC", label: "Seguridad", color: "#f00", v: 2 }]);
  despues.meta = { ...despues.meta, title: "Otro" };

  const cambios = diffStates(antes, despues);
  assert.ok(cambios.some(c => c.kind === "ws" && c.action === "edit" && c.id === "GEN"));
  assert.ok(cambios.some(c => c.kind === "ws" && c.action === "add" && c.id === "SEC"));
  const meta = cambios.find(c => c.kind === "meta");
  assert.deepEqual(meta.fields, ["title"]);
});

// -- Sellos de flujo (cr, st, dn, ca) --------------------------------------

test("los sellos de flujo sobreviven al saneado y a la fusión", () => {
  const sellos = { cr: "2026-09-01T08:00:00.000Z", st: "2026-09-02T09:00:00.000Z", dn: "", ca: "2026-09-02T09:00:00.000Z" };
  const state = sanitizeState(board([card("FE-1", sellos)]));
  assert.deepEqual(
    { cr: state.cards[0].cr, st: state.cards[0].st, dn: state.cards[0].dn, ca: state.cards[0].ca },
    sellos,
    "sanitizeCard tiene que conocer los cuatro campos o no llegan a guardarse"
  );

  const r = mergeBoard(state, { cards: [card("FE-1", Object.assign({}, sellos, {
    col: "done", dn: "2026-09-05T10:00:00.000Z", ca: "2026-09-05T10:00:00.000Z"
  }))] }, 1, 2);
  assert.equal(r.state.cards[0].dn, "2026-09-05T10:00:00.000Z");
});

test("un sello que no es cadena no entra en el estado", () => {
  const state = sanitizeState(board([card("FE-1", { cr: 1757000000000, st: null, dn: {}, ca: [] })]));
  assert.deepEqual(
    { cr: state.cards[0].cr, st: state.cards[0].st, dn: state.cards[0].dn, ca: state.cards[0].ca },
    { cr: "", st: "", dn: "", ca: "" }
  );
});

// La razón de que los sellos NO estén en DIFF_CARD_FIELDS: el movimiento se
// reconoce por `fields` === ["col"] a secas, así que con `ca` dentro toda
// tarjeta movida se reportaría como una edición cualquiera y la bitácora
// dejaría de decir "movió X de A a B".
test("mover una tarjeta sigue siendo un movimiento aunque cambie su sello ca", () => {
  const antes = board([card("FE-1", { col: "todo", ca: "2026-09-01T08:00:00.000Z" })]);
  const despues = board([card("FE-1", { col: "inprogress", ca: "2026-09-04T11:00:00.000Z", st: "2026-09-04T11:00:00.000Z" })]);

  const cambios = diffStates(antes, despues);
  assert.equal(cambios.length, 1, "el sello no puede generar una línea propia en la bitácora");
  assert.equal(cambios[0].action, "move");
  assert.equal(cambios[0].from, "todo");
  assert.equal(cambios[0].to, "inprogress");
});

test("un tablero guardado antes de los sellos no se marca entero como modificado", () => {
  const viejo = sanitizeState(board([card("FE-1"), card("BE-2")]));
  // El cliente vuelve a enviar exactamente lo mismo, ya con los campos vacíos
  // que el saneado añadió: si sameValue no equiparara undefined con "", esto
  // quemaría una versión por tarjeta en el primer contacto de cada cliente.
  assert.deepEqual(diffStates(board([card("FE-1"), card("BE-2")]), viejo), []);
});
