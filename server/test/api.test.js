import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../index.js";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kanban-api-")), "test.db");
const PORT = 8231;
const BASE = `http://127.0.0.1:${PORT}`;

// Usuarios de prueba
for (const name of ["carlos", "jose", "victor", "ajeno"]) {
  await main(["--db", dbPath, "--init", "--create-user", name, "--password", "contrasena-larga"]);
}
const server = await main(["--db", dbPath, "--port", String(PORT), "--host", "127.0.0.1"]);

async function api(method, route, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, etag: res.headers.get("etag"), data: text ? JSON.parse(text) : null };
}

const login = async (username, password = "contrasena-larga") =>
  api("POST", "/api/login", { body: { username, password } });

const card = (id, extra = {}) =>
  Object.assign({ id, ws: "GEN", pri: "media", col: "todo", t: "T " + id, d: "" }, extra);

let carlos, jose, victor, ajeno, boardId;

test("login: credenciales validas devuelven token", async () => {
  const r = await login("carlos");
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.user.username, "carlos");
  carlos = r.data.token;
  jose = (await login("jose")).data.token;
  victor = (await login("victor")).data.token;
  ajeno = (await login("ajeno")).data.token;
});

test("login: contrasena incorrecta da 401 sin filtrar si el usuario existe", async () => {
  const existe = await login("carlos", "clave-equivocada");
  const noExiste = await login("fantasma", "clave-equivocada");
  assert.equal(existe.status, 401);
  assert.equal(noExiste.status, 401);
  assert.equal(existe.data.error, noExiste.data.error);
});

test("las rutas protegidas rechazan peticiones sin token", async () => {
  assert.equal((await api("GET", "/api/boards")).status, 401);
  assert.equal((await api("GET", "/api/boards", { token: "basura" })).status, 401);
});

test("crear tablero: el creador queda como dueno", async () => {
  const r = await api("POST", "/api/boards", {
    token: carlos,
    body: { name: "Equipo", state: { meta: { title: "Equipo" },
            ws: [{ key: "GEN", label: "General", color: "#0a8fa6" }],
            cards: [card("FE-1"), card("BE-2"), card("QA-3")] } }
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.board.role, "owner");
  assert.equal(r.data.state.cards.length, 3);
  boardId = r.data.board.id;
});

test("un extrano recibe 404, no 403: no se filtra que el tablero existe", async () => {
  const r = await api("GET", `/api/boards/${boardId}`, { token: ajeno });
  assert.equal(r.status, 404);
  assert.equal((await api("GET", "/api/boards", { token: ajeno })).data.boards.length, 0);
});

test("invitar miembros con rol de escritura y de lectura", async () => {
  assert.equal((await api("POST", `/api/boards/${boardId}/members`,
    { token: carlos, body: { username: "jose", role: "write" } })).status, 200);
  assert.equal((await api("POST", `/api/boards/${boardId}/members`,
    { token: carlos, body: { username: "victor", role: "read" } })).status, 200);

  const r = await api("GET", `/api/boards/${boardId}/members`, { token: jose });
  assert.deepEqual(r.data.members.map(m => `${m.username}:${m.role}`).sort(),
    ["carlos:owner", "jose:write", "victor:read"]);
});

test("solo el dueno puede invitar", async () => {
  const r = await api("POST", `/api/boards/${boardId}/members`,
    { token: jose, body: { username: "ajeno", role: "write" } });
  assert.equal(r.status, 403);
});

test("invitar a alguien que no existe en el servidor da 404", async () => {
  const r = await api("POST", `/api/boards/${boardId}/members`,
    { token: carlos, body: { username: "fantasma", role: "write" } });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, "user_not_found");
});

test("el rol de lectura puede ver pero no escribir", async () => {
  assert.equal((await api("GET", `/api/boards/${boardId}`, { token: victor })).status, 200);
  const w = await api("POST", `/api/boards/${boardId}/sync`,
    { token: victor, body: { baseVersion: 1, cards: [card("X-1")] } });
  assert.equal(w.status, 403);
});

test("dos personas editando tarjetas distintas desde la misma base no se pisan", async () => {
  const before = await api("GET", `/api/boards/${boardId}`, { token: carlos });
  const base = before.data.version;

  const a = await api("POST", `/api/boards/${boardId}/sync`,
    { token: carlos, body: { baseVersion: base, cards: [card("FE-1", { col: "inprogress" })] } });
  const b = await api("POST", `/api/boards/${boardId}/sync`,
    { token: jose, body: { baseVersion: base, cards: [card("BE-2", { t: "Jose estuvo aqui" })] } });

  assert.deepEqual(a.data.conflicts, []);
  assert.deepEqual(b.data.conflicts, [], "editar otra tarjeta no debe ser conflicto");

  const byId = Object.fromEntries(b.data.state.cards.map(c => [c.id, c]));
  assert.equal(byId["FE-1"].col, "inprogress");
  assert.equal(byId["BE-2"].t, "Jose estuvo aqui");
  assert.equal(byId["QA-3"].t, "T QA-3");
});

test("editar la misma tarjeta desde la misma base reporta conflicto", async () => {
  const base = (await api("GET", `/api/boards/${boardId}`, { token: carlos })).data.version;
  await api("POST", `/api/boards/${boardId}/sync`,
    { token: carlos, body: { baseVersion: base, cards: [card("QA-3", { t: "de Carlos" })] } });
  const b = await api("POST", `/api/boards/${boardId}/sync`,
    { token: jose, body: { baseVersion: base, cards: [card("QA-3", { t: "de Jose" })] } });

  assert.deepEqual(b.data.conflicts, ["QA-3"]);
  assert.equal(b.data.state.cards.find(c => c.id === "QA-3").t, "de Jose");
});

test("el borrado se propaga al otro cliente", async () => {
  const base = (await api("GET", `/api/boards/${boardId}`, { token: carlos })).data.version;
  await api("POST", `/api/boards/${boardId}/sync`,
    { token: carlos, body: { baseVersion: base, deletes: [{ id: "BE-2", kind: "card" }] } });
  const view = await api("GET", `/api/boards/${boardId}`, { token: jose });
  assert.equal(view.data.state.cards.some(c => c.id === "BE-2"), false);
});

test("ETag: un cliente al dia recibe 304 y no vuelve a descargar el tablero", async () => {
  const first = await api("GET", `/api/boards/${boardId}`, { token: jose });
  assert.ok(first.etag);
  const second = await api("GET", `/api/boards/${boardId}`,
    { token: jose, headers: { "If-None-Match": first.etag } });
  assert.equal(second.status, 304);
  assert.equal(second.data, null);
});

test("un sync sin cambios reales no avanza la version", async () => {
  const before = (await api("GET", `/api/boards/${boardId}`, { token: carlos })).data;
  const r = await api("POST", `/api/boards/${boardId}/sync`, {
    token: carlos,
    body: { baseVersion: before.version, cards: [before.state.cards[0]] }
  });
  assert.equal(r.data.applied, false);
  assert.equal(r.data.version, before.version);
});

test("el cliente no puede falsificar la version de una entidad", async () => {
  const base = (await api("GET", `/api/boards/${boardId}`, { token: carlos })).data.version;
  const r = await api("POST", `/api/boards/${boardId}/sync`, {
    token: carlos,
    body: { baseVersion: base, cards: [card("FE-1", { t: "intento", v: 999999 })] }
  });
  assert.equal(r.data.state.cards.find(c => c.id === "FE-1").v, base + 1);
});

test("quitar a un miembro le corta el acceso", async () => {
  const joseId = (await api("GET", `/api/boards/${boardId}/members`, { token: carlos }))
    .data.members.find(m => m.username === "jose").userId;
  assert.equal((await api("DELETE", `/api/boards/${boardId}/members/${joseId}`,
    { token: carlos })).status, 200);
  assert.equal((await api("GET", `/api/boards/${boardId}`, { token: jose })).status, 404);
});

test("no se puede quitar al dueno de su propio tablero", async () => {
  const ownerId = (await api("GET", `/api/boards/${boardId}/members`, { token: carlos }))
    .data.members.find(m => m.role === "owner").userId;
  const r = await api("DELETE", `/api/boards/${boardId}/members/${ownerId}`, { token: carlos });
  assert.equal(r.status, 400);
});

test("solo el dueno borra el tablero", async () => {
  assert.equal((await api("DELETE", `/api/boards/${boardId}`, { token: victor })).status, 403);
  assert.equal((await api("DELETE", `/api/boards/${boardId}`, { token: carlos })).status, 200);
  assert.equal((await api("GET", `/api/boards/${boardId}`, { token: carlos })).status, 404);
});

test("logout invalida el token", async () => {
  const t = (await login("victor")).data.token;
  assert.equal((await api("GET", "/api/me", { token: t })).status, 200);
  await api("POST", "/api/logout", { token: t });
  assert.equal((await api("GET", "/api/me", { token: t })).status, 401);
});

test("el limitador corta los intentos de fuerza bruta", async () => {
  let blocked = false;
  for (let i = 0; i < 14; i++) {
    if ((await login("carlos", "clave-mala-" + i)).status === 429) { blocked = true; break; }
  }
  assert.ok(blocked, "deberia responder 429 antes del intento 14");
  // Y el bloqueo no debe permitir entrar ni con la contrasena correcta
  assert.equal((await login("carlos")).status, 429);
});

test("los comandos de usuario no crean una base nueva sin --init", async () => {
  const stray = path.join(path.dirname(dbPath), "no-existe.db");
  const realExit = process.exit;
  const realError = console.error;
  let exitCode = null;
  process.exit = code => { exitCode = code; throw new Error("__exit__"); };
  console.error = () => {};
  try {
    await main(["--db", stray, "--create-user", "fantasma", "--password", "contrasena-larga"]);
  } catch (e) {
    if (e.message !== "__exit__") throw e;
  } finally {
    process.exit = realExit;
    console.error = realError;
  }
  assert.equal(exitCode, 1, "debe salir con error en vez de crear la base");
  assert.equal(fs.existsSync(stray), false, "no debe quedar ninguna base huérfana en disco");
});

test.after(() => { server.close(); fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); });

test("una sincronización que arrasa el tablero se frena", async () => {
  const r = await api("POST", "/api/boards", {
    token: carlos,
    body: { name: "Grande", state: { meta: { title: "G" },
            ws: [{ key: "GEN", label: "General", color: "#000" }],
            cards: Array.from({ length: 20 }, (_, i) => card("G-" + i)) } }
  });
  const id = r.data.board.id;
  const base = r.data.board.version;

  // Borrar 3 de 21 es trabajo normal
  const pocas = await api("POST", `/api/boards/${id}/sync`, {
    token: carlos,
    body: { baseVersion: base, deletes: [0, 1, 2].map(i => ({ id: "G-" + i, kind: "card" })) }
  });
  assert.equal(pocas.status, 200, "un borrado pequeño debe pasar");

  // Arrasar con lo que queda, no
  const v = pocas.data.version;
  const arrasar = await api("POST", `/api/boards/${id}/sync`, {
    token: carlos,
    body: { baseVersion: v, deletes: Array.from({ length: 17 }, (_, i) => ({ id: "G-" + (i + 3), kind: "card" })) }
  });
  assert.equal(arrasar.status, 409);
  assert.equal(arrasar.data.error, "destructive_sync");

  // El tablero quedó intacto
  const tras = await api("GET", `/api/boards/${id}`, { token: carlos });
  assert.equal(tras.data.state.cards.length, 17, "no debe haberse borrado nada");

  // Con confirmación explícita sí procede
  const forzado = await api("POST", `/api/boards/${id}/sync`, {
    token: carlos,
    body: { baseVersion: v, confirmDestructive: true,
            deletes: Array.from({ length: 17 }, (_, i) => ({ id: "G-" + (i + 3), kind: "card" })) }
  });
  assert.equal(forzado.status, 200);
  assert.equal(forzado.data.state.cards.length, 0);

  // Y el histórico permite deshacerlo
  const hist = await api("GET", `/api/boards/${id}/history`, { token: carlos });
  assert.ok(hist.data.history.length >= 2, "debe haber versiones archivadas");
  const conTodo = hist.data.history.find(h => h.cards === 20);
  assert.ok(conTodo, "debe estar archivada la versión con las 20 tarjetas");

  const rest = await api("POST", `/api/boards/${id}/restore`,
    { token: carlos, body: { version: conTodo.version } });
  assert.equal(rest.status, 200);
  assert.equal(rest.data.state.cards.length, 20, "restaurado con todo su contenido");
});

test("sólo el dueño puede restaurar una versión", async () => {
  const r = await api("POST", "/api/boards", { token: carlos, body: { name: "Perm", state: { ws: [{ key: "G", label: "g", color: "#000" }], cards: [card("P-1")] } } });
  const id = r.data.board.id;
  await api("POST", `/api/boards/${id}/members`, { token: carlos, body: { username: "victor", role: "write" } });
  const intento = await api("POST", `/api/boards/${id}/restore`, { token: victor, body: { version: 1 } });
  assert.equal(intento.status, 403);
});

test("bitácora: registra quién hizo cada cambio y de qué tipo fue", async () => {
  const creado = await api("POST", "/api/boards", {
    token: carlos,
    body: { name: "Bitacora", state: {
      ws: [{ key: "GEN", label: "General", color: "#000" }],
      cards: [card("B-1"), card("B-2")] } }
  });
  const id = creado.data.board.id;
  await api("POST", `/api/boards/${id}/members`, { token: carlos, body: { username: "jose", role: "write" } });

  // v1 -> v2: José mueve una tarjeta
  const mover = await api("POST", `/api/boards/${id}/sync`, {
    token: jose, body: { baseVersion: 1, cards: [card("B-1", { col: "inprogress" })] }
  });
  assert.equal(mover.status, 200);

  // v2 -> v3: Carlos crea una y borra otra
  await api("POST", `/api/boards/${id}/sync`, {
    token: carlos,
    body: { baseVersion: mover.data.version, cards: [card("B-9")],
            deletes: [{ id: "B-2", kind: "card" }] }
  });

  const r = await api("GET", `/api/boards/${id}/log`, { token: jose });
  assert.equal(r.status, 200);
  assert.equal(r.data.log.length, 2, "dos transiciones registradas");

  const ultima = r.data.log[0];
  assert.equal(ultima.author, "carlos");
  assert.ok(ultima.at > 0);
  const acciones = Object.fromEntries(ultima.changes.map(c => [c.id, c.action]));
  assert.equal(acciones["B-9"], "add");
  assert.equal(acciones["B-2"], "delete");

  const previa = r.data.log[1];
  assert.equal(previa.author, "jose");
  const movimiento = previa.changes.find(c => c.id === "B-1");
  assert.equal(movimiento.action, "move");
  assert.equal(movimiento.to, "inprogress");
});

test("bitácora: un extraño no la ve", async () => {
  const r = await api("GET", `/api/boards/${boardId}/log`, { token: ajeno });
  assert.equal(r.status, 404);
});

test("bitácora: un tablero recién creado devuelve una lista vacía, no un error", async () => {
  const creado = await api("POST", "/api/boards", {
    token: carlos, body: { name: "Recien nacido" }
  });
  const r = await api("GET", `/api/boards/${creado.data.board.id}/log`, { token: carlos });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.log, []);
});

// -- Borrado suave de tableros ----------------------------------------------

test("borrar un tablero es reversible: sale de la lista pero se puede recuperar", async () => {
  const creado = await api("POST", "/api/boards", {
    token: carlos,
    body: { name: "Reversible", state: {
      ws: [{ key: "GEN", label: "General", color: "#000" }],
      cards: [card("R-1"), card("R-2")] } }
  });
  const id = creado.data.board.id;
  await api("POST", `/api/boards/${id}/members`, { token: carlos, body: { username: "jose", role: "write" } });

  // Una versión archivada, para comprobar que el histórico sobrevive
  await api("POST", `/api/boards/${id}/sync`,
    { token: carlos, body: { baseVersion: 1, cards: [card("R-3")] } });

  const borrado = await api("DELETE", `/api/boards/${id}`, { token: carlos });
  assert.equal(borrado.status, 200);
  assert.equal(borrado.data.deleted, true);

  // Para todo el mundo el tablero ya no existe
  assert.equal((await api("GET", `/api/boards/${id}`, { token: carlos })).status, 404);
  assert.equal((await api("GET", `/api/boards/${id}`, { token: jose })).status, 404);
  assert.equal((await api("POST", `/api/boards/${id}/sync`,
    { token: jose, body: { baseVersion: 1, cards: [card("R-9")] } })).status, 404);
  const lista = await api("GET", "/api/boards", { token: carlos });
  assert.ok(!lista.data.boards.some(b => b.id === id), "no aparece en la lista normal");

  // Pero está en la papelera del dueño
  const papelera = await api("GET", "/api/boards?deleted=1", { token: carlos });
  const enPapelera = papelera.data.boards.find(b => b.id === id);
  assert.ok(enPapelera, "el dueño lo ve en la papelera");
  assert.ok(enPapelera.deletedAt > 0);
  const papeleraJose = await api("GET", "/api/boards?deleted=1", { token: jose });
  assert.equal(papeleraJose.data.boards.length, 0, "quien no es dueño no ve la papelera");

  // Y se recupera entero, con su histórico
  const recuperado = await api("POST", `/api/boards/${id}/undelete`, { token: carlos });
  assert.equal(recuperado.status, 200);
  assert.equal(recuperado.data.restored, true);
  const tras = await api("GET", `/api/boards/${id}`, { token: carlos });
  assert.equal(tras.status, 200);
  assert.equal(tras.data.state.cards.length, 3, "vuelve con todo su contenido");
  assert.equal((await api("GET", `/api/boards/${id}`, { token: jose })).status, 200,
    "los miembros recuperan su acceso");
  assert.ok((await api("GET", `/api/boards/${id}/history`, { token: carlos })).data.history.length >= 1,
    "el histórico sobrevive al borrado");
});

test("la purga sólo vacía la papelera, nunca un tablero vivo", async () => {
  const creado = await api("POST", "/api/boards", {
    token: carlos, body: { name: "Purgable", state: {
      ws: [{ key: "GEN", label: "General", color: "#000" }], cards: [card("P-1")] } }
  });
  const id = creado.data.board.id;

  const intento = await api("DELETE", `/api/boards/${id}?purge=1`, { token: carlos });
  assert.equal(intento.status, 409);
  assert.equal(intento.data.error, "not_deleted");
  assert.equal((await api("GET", `/api/boards/${id}`, { token: carlos })).status, 200,
    "el tablero sigue intacto");

  await api("DELETE", `/api/boards/${id}`, { token: carlos });
  const purga = await api("DELETE", `/api/boards/${id}?purge=1`, { token: carlos });
  assert.equal(purga.status, 200);
  assert.equal(purga.data.purged, true);
  assert.equal((await api("POST", `/api/boards/${id}/undelete`, { token: carlos })).status, 404,
    "purgado ya no se puede recuperar");
  assert.equal((await api("GET", "/api/boards?deleted=1", { token: carlos }))
    .data.boards.filter(b => b.id === id).length, 0);
});

test("sólo el dueño elimina y recupera", async () => {
  const creado = await api("POST", "/api/boards", {
    token: carlos, body: { name: "Permisos borrado", state: {
      ws: [{ key: "GEN", label: "General", color: "#000" }], cards: [card("PB-1")] } }
  });
  const id = creado.data.board.id;
  await api("POST", `/api/boards/${id}/members`, { token: carlos, body: { username: "victor", role: "write" } });

  assert.equal((await api("DELETE", `/api/boards/${id}`, { token: victor })).status, 403);
  await api("DELETE", `/api/boards/${id}`, { token: carlos });
  // Sin acceso al tablero eliminado, victor recibe 404 (no se le revela nada)
  assert.equal((await api("POST", `/api/boards/${id}/undelete`, { token: victor })).status, 403);
  assert.equal((await api("POST", `/api/boards/${id}/undelete`, { token: ajeno })).status, 404);
  assert.equal((await api("POST", `/api/boards/${id}/undelete`, { token: carlos })).status, 200);
});
