#!/usr/bin/env node
// Kanban Lite — servidor opcional de tableros compartidos.
//
// Cero dependencias npm: sólo node:http, node:sqlite y node:crypto.
// El frontend NUNCA lo necesita: es estrictamente aditivo. La app sigue
// arrancando y funcionando completa con este servidor apagado.
//
//   node server/index.js --db ./kanban.db --port 8090
//   node server/index.js --db ./kanban.db --create-user carlos
//
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  openDb, newId, createUser, findUserByName, findUserById, verifyPassword,
  hashPassword, issueToken, userForToken, revokeToken, purgeExpiredTokens,
  roleFor, boardsForUser, getBoard, recordHistory, listHistory, getHistoryState,
  listHistoryStates, deletedBoardsForUser, softDeleteBoard, undeleteBoard, hardDeleteBoard
} from "./db.js";
import { mergeBoard, sanitizeState, emptyState, assessDestruction, diffStates } from "./merge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// -- Argumentos -------------------------------------------------------------

function parseArgs(argv) {
  const args = { port: 8090, host: "0.0.0.0", db: "./kanban.db", tokenDays: 30, serve: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--port") args.port = Number(next());
    else if (a === "--host") args.host = next();
    else if (a === "--db") args.db = next();
    else if (a === "--token-days") args.tokenDays = Number(next());
    else if (a === "--serve") args.serve = true;
    else if (a === "--create-user") args.createUser = next();
    else if (a === "--set-password") args.setPassword = next();
    else if (a === "--list-users") args.listUsers = true;
    else if (a === "--list-boards") args.listBoards = true;
    else if (a === "--history") args.history = next();
    else if (a === "--restore") args.restore = next();
    else if (a === "--list-deleted") args.listDeleted = true;
    else if (a === "--undelete") args.undelete = next();
    else if (a === "--purge") args.purge = next();
    else if (a === "--to-version") args.toVersion = Number(next());
    else if (a === "--init") args.init = true;
    else if (a === "--password") args.password = next();
    else if (a === "--help" || a === "-h") args.help = true;
    else { console.error(`Argumento desconocido: ${a}`); process.exit(1); }
  }
  return args;
}

const HELP = `
Kanban Lite — servidor de tableros compartidos

  node server/index.js [opciones]

Servidor
  --port <n>          Puerto (por defecto 8090)
  --host <ip>         Interfaz de escucha (por defecto 0.0.0.0)
  --db <ruta>         Archivo SQLite (por defecto ./kanban.db)
  --token-days <n>    Vigencia de la sesion en dias (por defecto 30)
  --serve             Servir tambien dist/index.html en / (opcional)

Usuarios
  --create-user <nombre>   Crear usuario (pide la contrasena por consola)
  --set-password <nombre>  Cambiar la contrasena de un usuario
  --list-users             Listar usuarios
  --password <clave>       Contrasena no interactiva (para scripts)
  --init                   Permitir crear la base de datos si no existe

Tableros
  --list-boards            Listar tableros con su version actual
  --history <id|nombre>    Ver el historico de versiones de un tablero
  --restore <id|nombre> --to-version <n>
                           Volver un tablero a una version archivada
  --list-deleted           Listar los tableros eliminados (papelera)
  --undelete <id|nombre>   Recuperar un tablero eliminado
  --purge <id|nombre>      Borrado definitivo de un tablero YA eliminado

Ojo con --db: si se omite, la ruta por defecto es ./kanban.db RELATIVA al
directorio actual. Un --db equivocado crea una base vacia y el usuario acaba
en un archivo que el servicio no lee. Por eso los comandos de usuario se
niegan a crear una base nueva salvo que se pase --init.
`;

// -- Utilidades HTTP --------------------------------------------------------

const MAX_BODY = 4 * 1024 * 1024;

// Umbrales del freno ante sincronizaciones destructivas.
const DESTRUCTIVE_MIN = 5;      // menos de esto nunca se frena
const DESTRUCTIVE_RATIO = 0.5;  // y ademas ha de arrasar al menos la mitad

// Sin cookies ni credenciales: el token viaja en Authorization, asi que "*"
// es seguro y ademas cubre el Origin "null" de las paginas abiertas con file://
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type,if-none-match",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "etag",
  "Access-Control-Max-Age": "86400"
};

function send(res, status, body, extraHeaders = {}) {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    ...extraHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "payload_too_large", "Cuerpo demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new HttpError(400, "invalid_json", "JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

// -- Limitador de intentos de login -----------------------------------------

const attempts = new Map();
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW = 15 * 60 * 1000;

function checkRateLimit(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start > ATTEMPT_WINDOW) {
    attempts.set(key, { start: now, count: 1 });
    return;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    fail(429, "too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos.");
  }
}
const clearRateLimit = key => attempts.delete(key);

// -- Rutas ------------------------------------------------------------------

// -- Bitacora ---------------------------------------------------------------

const MAX_LOG_ENTRIES = 100;
const MAX_LOG_CHANGES = 60;   // por entrada; el resto se resume como "y N mas"

// Reconstruye la bitacora comparando cada version archivada con la siguiente.
// La fila archivada de la version N guarda el estado ANTERIOR al cambio y el
// autor que lo provoco, asi que la transicion N -> N+1 es una entrada.
function buildBoardLog(db, board, limit) {
  const filas = listHistoryStates(db, board.id, limit + 1);
  const porVersion = new Map(filas.map(f => [f.version, f]));
  const entradas = [];

  for (const fila of filas) {
    if (entradas.length >= limit) break;
    // El estado "despues" de la version N es el archivado en N+1; para la
    // ultima transicion no hay archivo todavia: es el estado vivo del tablero.
    const siguiente = porVersion.get(fila.version + 1);
    let despues;
    if (siguiente) despues = JSON.parse(siguiente.state);
    else if (fila.version + 1 === board.version) despues = JSON.parse(board.state);
    else continue;   // hueco en el historico: no se puede comparar

    const cambios = diffStates(JSON.parse(fila.state), despues);
    if (!cambios.length) continue;
    entradas.push({
      version: fila.version + 1,
      at: fila.savedAt,
      author: fila.author || null,
      changes: cambios.slice(0, MAX_LOG_CHANGES),
      omitted: Math.max(0, cambios.length - MAX_LOG_CHANGES)
    });
  }
  return entradas;
}

function createRouter(db, config) {
  const routes = [];
  const route = (method, pattern, handler, auth = true) => {
    const names = [];
    const regex = new RegExp("^" + pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
      names.push(name);
      return "([^/]+)";
    }) + "$");
    routes.push({ method, regex, names, handler, auth });
  };

  const requireRole = (boardId, user, allowed, options) => {
    const board = getBoard(db, boardId, options);
    if (!board) fail(404, "not_found", "Tablero no encontrado");
    const role = roleFor(db, boardId, user.id);
    // Sin membresia respondemos 404, no 403: no revelamos que el tablero existe.
    if (!role) fail(404, "not_found", "Tablero no encontrado");
    if (!allowed.includes(role)) fail(403, "forbidden", "No tienes permiso para esta accion");
    return { board, role };
  };

  const publicUser = u => ({ id: u.id, username: u.username });
  const publicBoard = (b, role, ownerName) => ({
    id: b.id, name: b.name, version: b.version, updatedAt: b.updated_at,
    role: role, ownerName: ownerName
  });

  // -- Sesion --
  route("POST", "/api/login", async ({ body, req }) => {
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) fail(400, "missing_credentials", "Faltan usuario o contrasena");

    const ip = req.socket.remoteAddress || "?";
    checkRateLimit(ip + "|" + username);

    const user = findUserByName(db, username);
    if (!user || !verifyPassword(password, user.pass_hash, user.pass_salt)) {
      fail(401, "invalid_credentials", "Usuario o contrasena incorrectos");
    }
    clearRateLimit(ip + "|" + username);
    purgeExpiredTokens(db);
    const { token, expiresAt } = issueToken(db, user.id, config.tokenDays * 86400000);
    return { token, expiresAt, user: publicUser(user) };
  }, false);

  route("POST", "/api/logout", async ({ token }) => {
    revokeToken(db, token);
    return { ok: true };
  });

  route("GET", "/api/me", async ({ user }) => ({ user: publicUser(user) }));

  // -- Tableros --
  route("GET", "/api/boards", async ({ user, query }) => {
    // ?deleted=1 devuelve la papelera del servidor, no la lista normal.
    if (query.get("deleted") === "1") return { boards: deletedBoardsForUser(db, user.id) };
    return { boards: boardsForUser(db, user.id) };
  });

  route("POST", "/api/boards", async ({ user, body }) => {
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) fail(400, "missing_name", "Falta el nombre del tablero");

    const id = newId("b");
    const state = body.state ? sanitizeState(body.state, 1) : emptyState();
    const now = Date.now();
    db.prepare("INSERT INTO boards (id, name, owner_id, version, state, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .run(id, name, user.id, JSON.stringify(state), now);
    db.prepare("INSERT INTO members (board_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(id, user.id);
    return { board: { id, name, version: 1, updatedAt: now, role: "owner", ownerName: user.username }, state };
  });

  route("GET", "/api/boards/:id", async ({ user, params, req, res }) => {
    const { board, role } = requireRole(params.id, user, ["owner", "write", "read"]);
    const etag = `"${board.version}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ...CORS, ETag: etag, "Cache-Control": "no-store" });
      res.end();
      return undefined; // ya respondido
    }
    return {
      body: { id: board.id, name: board.name, role, version: board.version,
              state: JSON.parse(board.state) },
      headers: { ETag: etag }
    };
  });

  route("POST", "/api/boards/:id/sync", async ({ user, params, body }) => {
    const { board } = requireRole(params.id, user, ["owner", "write"]);
    const baseVersion = Number.isFinite(body.baseVersion) ? body.baseVersion : 0;
    const stored = JSON.parse(board.state);
    const nextVersion = board.version + 1;

    // Freno de mano ante una sincronizacion que arrasa el tablero. Borrar
    // unas pocas tarjetas es normal; borrar la mayoria de golpe casi siempre
    // significa que el cliente tiene el tablero equivocado en memoria.
    const dano = assessDestruction(stored, body);
    if (!body.confirmDestructive &&
        dano.deletes >= DESTRUCTIVE_MIN && dano.ratio >= DESTRUCTIVE_RATIO) {
      fail(409, "destructive_sync",
        `Esta sincronizacion borraria ${dano.deletes} de ${dano.total} elementos del tablero. ` +
        `Se ha frenado por seguridad.`);
    }

    const { state, conflicts, changed } = mergeBoard(stored, body, baseVersion, nextVersion);

    if (!changed) {
      return { version: board.version, state: stored, conflicts, applied: false };
    }
    // El estado anterior se archiva ANTES de reemplazarlo: sin esto ningun
    // error es reversible.
    recordHistory(db, board, user.username);
    const now = Date.now();
    db.prepare("UPDATE boards SET state = ?, version = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(state), nextVersion, now, board.id);
    return { version: nextVersion, state, conflicts, applied: true };
  });

  // -- Historico --
  route("GET", "/api/boards/:id/history", async ({ user, params }) => {
    requireRole(params.id, user, ["owner", "write", "read"]);
    return { history: listHistory(db, params.id) };
  });

  // Bitacora: quien cambio que, derivada de comparar versiones archivadas
  // consecutivas. No hay registro de eventos aparte, asi que no puede
  // desincronizarse del estado real del tablero.
  route("GET", "/api/boards/:id/log", async ({ user, params, query }) => {
    const { board } = requireRole(params.id, user, ["owner", "write", "read"]);
    const limit = Math.min(Math.max(Number(query.get("limit")) || 30, 1), MAX_LOG_ENTRIES);
    return { version: board.version, log: buildBoardLog(db, board, limit) };
  });

  route("POST", "/api/boards/:id/restore", async ({ user, params, body }) => {
    const { board } = requireRole(params.id, user, ["owner"]);
    const version = Number(body.version);
    const archived = getHistoryState(db, params.id, version);
    if (!archived) fail(404, "version_not_found", `No hay copia archivada de la version ${version}`);

    recordHistory(db, board, user.username);
    const nextVersion = board.version + 1;
    // Se reetiquetan las entidades con la version nueva para que los clientes
    // al dia detecten el cambio y se lo traigan.
    const state = JSON.parse(archived);
    state.meta = Object.assign({}, state.meta, { v: nextVersion });
    state.ws = (state.ws || []).map(w => Object.assign({}, w, { v: nextVersion }));
    state.cards = (state.cards || []).map(c => Object.assign({}, c, { v: nextVersion }));
    state.deleted = [];

    db.prepare("UPDATE boards SET state = ?, version = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(state), nextVersion, Date.now(), board.id);
    return { version: nextVersion, state, restoredFrom: version };
  });

  // Borrado suave. El tablero desaparece para todo el equipo, pero su estado,
  // su historico y sus miembros siguen ahi: borrar un tablero compartido por
  // error se llevaba el trabajo de todos sin vuelta atras (regla 8).
  route("DELETE", "/api/boards/:id", async ({ user, params, query }) => {
    const purgar = query.get("purge") === "1";
    const { board } = requireRole(params.id, user, ["owner"], { includeDeleted: purgar });

    if (!purgar) {
      const deletedAt = softDeleteBoard(db, params.id);
      return { ok: true, deleted: true, deletedAt };
    }
    // La purga exige que ya estuviera en la papelera: nunca se destruye un
    // tablero vivo de una sola peticion.
    if (!board.deleted_at) {
      fail(409, "not_deleted", "Primero hay que eliminar el tablero; la purga sólo vacía la papelera");
    }
    hardDeleteBoard(db, params.id);
    return { ok: true, purged: true };
  });

  route("POST", "/api/boards/:id/undelete", async ({ user, params }) => {
    const { board } = requireRole(params.id, user, ["owner"], { includeDeleted: true });
    if (!board.deleted_at) return { board: publicBoard(board, "owner", user.username), restored: false };
    const restored = undeleteBoard(db, params.id);
    return { board: publicBoard(restored, "owner", user.username), restored: true };
  });

  // -- Miembros --
  route("GET", "/api/boards/:id/members", async ({ user, params }) => {
    requireRole(params.id, user, ["owner", "write", "read"]);
    const members = db.prepare(`
      SELECT u.id AS userId, u.username, m.role
      FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.board_id = ? ORDER BY m.role, u.username
    `).all(params.id);
    return { members };
  });

  route("POST", "/api/boards/:id/members", async ({ user, params, body }) => {
    requireRole(params.id, user, ["owner"]);
    const username = String(body.username || "").trim().toLowerCase();
    const role = ["write", "read"].includes(body.role) ? body.role : "write";
    const target = findUserByName(db, username);
    if (!target) fail(404, "user_not_found", "No existe ese usuario en este servidor");
    if (target.id === user.id) fail(400, "cannot_change_owner", "No puedes cambiar tu propio rol de dueno");
    db.prepare("INSERT INTO members (board_id, user_id, role) VALUES (?, ?, ?) " +
               "ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role")
      .run(params.id, target.id, role);
    return { member: { userId: target.id, username: target.username, role } };
  });

  route("DELETE", "/api/boards/:id/members/:userId", async ({ user, params }) => {
    const { board } = requireRole(params.id, user, ["owner"]);
    if (params.userId === board.owner_id) fail(400, "cannot_remove_owner", "No se puede quitar al dueno");
    db.prepare("DELETE FROM members WHERE board_id = ? AND user_id = ?")
      .run(params.id, params.userId);
    return { ok: true };
  });

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.regex.exec(pathname);
      if (!match) continue;

      const params = {};
      r.names.forEach((name, i) => { params[name] = match[i + 1]; });

      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      let user = null;
      if (r.auth) {
        user = userForToken(db, token);
        if (!user) return send(res, 401, { error: "unauthorized", message: "Sesion invalida o expirada" });
      }

      const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ req, res, user, token, params, body, query: url.searchParams });

      if (result === undefined) return; // el handler ya respondio
      if (result && result.body !== undefined && result.headers !== undefined) {
        return send(res, 200, result.body, result.headers);
      }
      return send(res, 200, result);
    }
    return null; // ninguna ruta coincide
  };
}

// -- Servidor estatico opcional ---------------------------------------------

function serveDist(res) {
  const distPath = path.join(ROOT_DIR, "dist", "index.html");
  if (!fs.existsSync(distPath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("dist/index.html no existe todavia. Ejecuta: npm run build");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  fs.createReadStream(distPath).pipe(res);
}

// -- Gestion de usuarios por consola ----------------------------------------

function askPassword(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(prompt, answer => { rl.close(); resolve(answer); });
  });
}

// Encuentra el tablero incluso si esta en la papelera: los comandos de
// recuperacion son justo para esos.
function resolveBoard(db, ref) {
  const porId = db.prepare("SELECT * FROM boards WHERE id = ?").get(ref);
  if (porId) return porId;
  const porNombre = db.prepare("SELECT * FROM boards WHERE name = ? COLLATE NOCASE").all(ref);
  if (porNombre.length === 1) return porNombre[0];
  if (porNombre.length > 1) {
    console.error(`Hay varios tableros llamados "${ref}". Usa el id:`);
    for (const b of porNombre) console.error(`  ${b.id}`);
    process.exit(1);
  }
  console.error(`No existe el tablero "${ref}".`);
  process.exit(1);
}

async function runBoardCommand(db, args) {
  if (args.listBoards) {
    const filas = db.prepare("SELECT id, name, version, updated_at, deleted_at FROM boards ORDER BY name").all();
    if (!filas.length) console.log("No hay tableros.");
    for (const b of filas) {
      const s = JSON.parse(db.prepare("SELECT state FROM boards WHERE id = ?").get(b.id).state);
      console.log(`${b.name}\t${b.id}\tv${b.version}\t${(s.cards || []).length} tarjetas\t` +
                  `${new Date(b.updated_at).toISOString()}${b.deleted_at ? "\t(eliminado)" : ""}`);
    }
    return true;
  }

  if (args.listDeleted) {
    const filas = db.prepare(
      "SELECT id, name, version, deleted_at FROM boards WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
    ).all();
    if (!filas.length) console.log("La papelera está vacía: no hay tableros eliminados.");
    for (const b of filas) {
      const s = JSON.parse(db.prepare("SELECT state FROM boards WHERE id = ?").get(b.id).state);
      console.log(`${b.name}\t${b.id}\tv${b.version}\t${(s.cards || []).length} tarjetas\t` +
                  `eliminado ${new Date(b.deleted_at).toISOString()}`);
    }
    if (filas.length) console.log(`\nPara recuperar uno: --undelete "${filas[0].name}"`);
    return true;
  }

  if (args.undelete) {
    const board = resolveBoard(db, args.undelete);
    if (!board.deleted_at) {
      console.log(`"${board.name}" no está eliminado: sigue disponible para su equipo.`);
      return true;
    }
    undeleteBoard(db, board.id);
    console.log(`[ok] "${board.name}" recuperado (v${board.version}). Los clientes lo verán en su próximo sondeo.`);
    return true;
  }

  if (args.purge) {
    const board = resolveBoard(db, args.purge);
    if (!board.deleted_at) {
      console.error(`[error] "${board.name}" no está eliminado. Primero elimínalo desde la app;`);
      console.error("  --purge sólo vacía la papelera, para no destruir un tablero vivo por error.");
      process.exit(1);
    }
    hardDeleteBoard(db, board.id);
    console.log(`[ok] "${board.name}" eliminado definitivamente, con su histórico y sus miembros.`);
    return true;
  }

  if (args.history) {
    const board = resolveBoard(db, args.history);
    const filas = listHistory(db, board.id, 50);
    console.log(`${board.name} (${board.id}) — actual: v${board.version}`);
    if (!filas.length) { console.log("  (sin histórico todavía)"); return true; }
    console.log("  version\ttarjetas\tfrentes\tguardado\t\tpor");
    for (const h of filas) {
      console.log(`  v${h.version}\t\t${h.cards ?? "?"}\t\t${h.ws ?? "?"}\t${new Date(h.savedAt).toISOString()}\t${h.author || "-"}`);
    }
    console.log(`\nPara volver a una: --restore "${board.name}" --to-version <n>`);
    return true;
  }

  if (args.restore) {
    const board = resolveBoard(db, args.restore);
    if (!Number.isFinite(args.toVersion)) {
      console.error("Falta --to-version <n>. Mira las disponibles con --history.");
      process.exit(1);
    }
    const archivado = getHistoryState(db, board.id, args.toVersion);
    if (!archivado) {
      console.error(`No hay copia archivada de la versión ${args.toVersion} de "${board.name}".`);
      process.exit(1);
    }
    recordHistory(db, board, "cli");
    const nueva = board.version + 1;
    const state = JSON.parse(archivado);
    state.meta = Object.assign({}, state.meta, { v: nueva });
    state.ws = (state.ws || []).map(w => Object.assign({}, w, { v: nueva }));
    state.cards = (state.cards || []).map(c => Object.assign({}, c, { v: nueva }));
    state.deleted = [];
    db.prepare("UPDATE boards SET state = ?, version = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(state), nueva, Date.now(), board.id);
    console.log(`[ok] "${board.name}" restaurado desde v${args.toVersion} -> ahora v${nueva} ` +
                `(${state.cards.length} tarjetas, ${state.ws.length} frentes)`);
    console.log("  Los clientes se lo traerán en su próximo sondeo.");
    return true;
  }
  return false;
}

async function runUserCommand(db, args) {
  if (args.listUsers) {
    const users = db.prepare("SELECT username, created_at FROM users ORDER BY username").all();
    if (!users.length) console.log("No hay usuarios. Crea uno con --create-user <nombre>");
    for (const u of users) console.log(`${u.username}\t${new Date(u.created_at).toISOString()}`);
    return true;
  }

  const name = args.createUser || args.setPassword;
  if (!name) return false;

  const username = String(name).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    console.error("Nombre invalido. Usa 2-32 caracteres: letras, numeros, punto, guion o guion bajo.");
    process.exit(1);
  }
  const password = args.password || await askPassword(`Contrasena para ${username}: `);
  if (password.length < 8) {
    console.error("La contrasena debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  if (args.createUser) {
    if (findUserByName(db, username)) {
      console.error(`El usuario ${username} ya existe.`);
      process.exit(1);
    }
    createUser(db, username, password);
    console.log(`Usuario ${username} creado.`);
  } else {
    const user = findUserByName(db, username);
    if (!user) { console.error(`No existe el usuario ${username}.`); process.exit(1); }
    const { hash, salt } = hashPassword(password);
    db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").run(hash, salt, user.id);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(user.id); // cerrar sesiones abiertas
    console.log(`Contrasena de ${username} actualizada. Se cerraron sus sesiones.`);
  }
  return true;
}

// -- Arranque ---------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(HELP); return; }

  const dbPath = path.resolve(args.db);
  const dbExisted = fs.existsSync(dbPath);
  const isUserCommand = Boolean(args.createUser || args.setPassword || args.listUsers ||
                                args.listBoards || args.history || args.restore ||
                                args.listDeleted || args.undelete || args.purge);

  // Guarda contra el error mas facil de cometer: olvidar --db. Sin esta
  // comprobacion se crea una base vacia en el directorio actual, el usuario se
  // da de alta ahi y el servicio nunca lo ve, sin ningun mensaje de error.
  if (!dbExisted && isUserCommand && !args.init) {
    console.error(`[error] No existe la base de datos: ${dbPath}`);
    console.error("");
    console.error("  Si es la primera vez en este servidor, anade --init para crearla.");
    console.error("  Si no, lo mas probable es que falte --db o que apunte al sitio");
    console.error("  equivocado: el usuario acabaria en una base que el servicio no lee.");
    process.exit(1);
  }

  const db = openDb(dbPath);
  if (!dbExisted) console.log(`Base de datos creada: ${dbPath}`);
  if (await runBoardCommand(db, args)) return;
  if (await runUserCommand(db, args)) return;

  if (!db.prepare("SELECT COUNT(*) AS n FROM users").get().n) {
    console.log("[aviso] No hay usuarios todavia. Crea el primero con:");
    console.log(`   node server/index.js --db ${dbPath} --create-user <nombre>\n`);
  }

  const handle = createRouter(db, args);
  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handle(req, res);
      if (handled !== null) return;
      if (args.serve && (req.url === "/" || req.url === "/index.html")) return serveDist(res);
      send(res, 404, { error: "not_found", message: "Ruta no encontrada" });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
      console.error("Error no controlado:", err);
      if (!res.headersSent) send(res, 500, { error: "internal", message: "Error interno" });
    }
  });

  await new Promise(resolve => server.listen(args.port, args.host, resolve));
  console.log(`Kanban Lite server escuchando en http://${args.host}:${args.port}`);
  console.log(`   Base de datos: ${path.resolve(args.db)}`);
  if (args.serve) console.log(`   Sirviendo dist/index.html en /`);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
