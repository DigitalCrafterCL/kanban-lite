import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,
  pass_salt  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boards (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL DEFAULT 1,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Borrado suave. Un DELETE de verdad se llevaba por delante el tablero, sus
  -- miembros y todo su histórico de una vez y sin retorno.
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('owner','write','read')),
  PRIMARY KEY (board_id, user_id)
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
-- Histórico de estados. Sin esto, cualquier sincronización destructiva es
-- irreversible: el estado anterior se pierde en el UPDATE.
CREATE TABLE IF NOT EXISTS board_history (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  version  INTEGER NOT NULL,
  state    TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  author   TEXT,
  PRIMARY KEY (board_id, version)
);
CREATE INDEX IF NOT EXISTS idx_history_board ON board_history(board_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user  ON tokens(user_id);
`;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// CREATE TABLE IF NOT EXISTS no añade columnas a una tabla que ya existe, así
// que las bases anteriores necesitan el ALTER explícito.
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(boards)").all().map(c => c.name);
  if (!cols.includes("deleted_at")) {
    db.exec("ALTER TABLE boards ADD COLUMN deleted_at INTEGER");
  }
}

// -- Identificadores y contraseñas ------------------------------------------

export function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("base64url");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  // scrypt con parámetros por defecto de Node (N=16384, r=8, p=1)
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// El token en claro sólo lo ve el cliente; en disco guardamos su SHA-256.
export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// -- Consultas --------------------------------------------------------------

export function createUser(db, username, password) {
  const { hash, salt } = hashPassword(password);
  const id = newId("u");
  db.prepare(
    "INSERT INTO users (id, username, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, username, hash, salt, Date.now());
  return { id, username };
}

export function findUserByName(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) || null;
}

export function findUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function issueToken(db, userId, ttlMs) {
  const token = newToken();
  const expiresAt = Date.now() + ttlMs;
  db.prepare("INSERT INTO tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM tokens WHERE token_hash = ?").get(hashToken(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(row.token_hash);
    return null;
  }
  return findUserById(db, row.user_id);
}

export function revokeToken(db, token) {
  db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(hashToken(token));
}

export function purgeExpiredTokens(db) {
  db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(Date.now());
}

export function roleFor(db, boardId, userId) {
  const row = db.prepare("SELECT role FROM members WHERE board_id = ? AND user_id = ?")
    .get(boardId, userId);
  return row ? row.role : null;
}

export function boardsForUser(db, userId) {
  return db.prepare(`
    SELECT b.id, b.name, b.version, b.updated_at AS updatedAt, m.role,
           u.username AS ownerName
    FROM boards b
    JOIN members m ON m.board_id = b.id AND m.user_id = ?
    JOIN users u   ON u.id = b.owner_id
    WHERE b.deleted_at IS NULL
    ORDER BY b.updated_at DESC
  `).all(userId);
}

// Los tableros en la papelera del servidor. Sólo los ve su dueño: para el resto
// del equipo el tablero ya no existe.
export function deletedBoardsForUser(db, userId) {
  return db.prepare(`
    SELECT b.id, b.name, b.version, b.updated_at AS updatedAt, b.deleted_at AS deletedAt,
           m.role, u.username AS ownerName
    FROM boards b
    JOIN members m ON m.board_id = b.id AND m.user_id = ?
    JOIN users u   ON u.id = b.owner_id
    WHERE b.deleted_at IS NOT NULL AND m.role = 'owner'
    ORDER BY b.deleted_at DESC
  `).all(userId);
}

// Un tablero eliminado se comporta como inexistente en todas las rutas salvo
// las de recuperación, que piden `includeDeleted`.
export function getBoard(db, id, options) {
  const row = db.prepare("SELECT * FROM boards WHERE id = ?").get(id) || null;
  if (!row) return null;
  if (row.deleted_at && !(options && options.includeDeleted)) return null;
  return row;
}

export function softDeleteBoard(db, id) {
  const now = Date.now();
  db.prepare("UPDATE boards SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, id);
  return now;
}

export function undeleteBoard(db, id) {
  db.prepare("UPDATE boards SET deleted_at = NULL WHERE id = ?").run(id);
  return getBoard(db, id);
}

// Borrado real, con su histórico y sus miembros. Sólo desde la papelera.
export function hardDeleteBoard(db, id) {
  db.prepare("DELETE FROM boards WHERE id = ?").run(id);
}

// -- Histórico --------------------------------------------------------------

const HISTORY_KEEP = 100;

// Guarda el estado que va a ser reemplazado, no el nuevo: así la versión N del
// histórico es exactamente lo que había justo antes de pasar a N+1.
export function recordHistory(db, board, author) {
  db.prepare("INSERT OR REPLACE INTO board_history (board_id, version, state, saved_at, author) VALUES (?, ?, ?, ?, ?)")
    .run(board.id, board.version, board.state, Date.now(), author || null);
  db.prepare(`
    DELETE FROM board_history
    WHERE board_id = ? AND version <= (
      SELECT MIN(version) FROM (
        SELECT version FROM board_history WHERE board_id = ? ORDER BY version DESC LIMIT ?
      )
    ) AND version NOT IN (
      SELECT version FROM board_history WHERE board_id = ? ORDER BY version DESC LIMIT ?
    )
  `).run(board.id, board.id, HISTORY_KEEP, board.id, HISTORY_KEEP);
}

export function listHistory(db, boardId, limit = 30) {
  return db.prepare(`
    SELECT version, saved_at AS savedAt, author,
           json_array_length(state, '$.cards') AS cards,
           json_array_length(state, '$.ws')    AS ws
    FROM board_history WHERE board_id = ? ORDER BY version DESC LIMIT ?
  `).all(boardId, limit);
}

export function getHistoryState(db, boardId, version) {
  const row = db.prepare("SELECT state FROM board_history WHERE board_id = ? AND version = ?")
    .get(boardId, version);
  return row ? row.state : null;
}

// Estados archivados en crudo, del más reciente al más antiguo. La bitácora
// los compara por pares: la versión N frente a la N+1.
export function listHistoryStates(db, boardId, limit = 30) {
  return db.prepare(`
    SELECT version, state, saved_at AS savedAt, author
    FROM board_history WHERE board_id = ? ORDER BY version DESC LIMIT ?
  `).all(boardId, limit);
}
