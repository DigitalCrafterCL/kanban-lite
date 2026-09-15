// Cliente HTTP del backend opcional de tableros compartidos.
//
// Regla inviolable: nada de este módulo se ejecuta durante el arranque de la
// aplicación. Si el usuario nunca da de alta un servidor, la app jamás toca
// la red y se comporta exactamente igual que antes.

import { LS_SERVERS, SYNC_TIMEOUT_MS } from "./config.js";

// -- Registro de servidores -------------------------------------------------

export function listServers() {
  try {
    const raw = localStorage.getItem(LS_SERVERS);
    if (raw) return JSON.parse(raw) || [];
  } catch (e) {}
  return [];
}

function saveServers(servers) {
  try { localStorage.setItem(LS_SERVERS, JSON.stringify(servers)); } catch (e) {}
}

export function getServer(id) {
  return listServers().find(function (s) { return s.id === id; }) || null;
}

export function normalizeUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/+$/, "");
}

export function upsertServer(server) {
  const servers = listServers();
  const i = servers.findIndex(function (s) { return s.id === server.id; });
  if (i >= 0) servers[i] = Object.assign({}, servers[i], server);
  else servers.push(server);
  saveServers(servers);
  return server;
}

export function removeServer(id) {
  saveServers(listServers().filter(function (s) { return s.id !== id; }));
}

// El id combina URL y usuario: la misma persona puede tener cuentas distintas
// en servidores distintos, y dos personas pueden usar el mismo navegador.
export function serverId(url, username) {
  return normalizeUrl(url) + "#" + String(username || "").trim().toLowerCase();
}

export function isSessionValid(server) {
  return Boolean(server && server.token && (!server.expiresAt || server.expiresAt > Date.now()));
}

// -- Errores ----------------------------------------------------------------

export class RemoteError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status || 0;
  }
  get isOffline() { return this.code === "network" || this.code === "timeout"; }
  get isAuth() { return this.status === 401; }
}

// -- Peticiones -------------------------------------------------------------

async function request(server, method, route, options = {}) {
  const url = normalizeUrl(server.url) + route;
  const headers = {};
  if (server.token) headers["Authorization"] = "Bearer " + server.token;
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.etag) headers["If-None-Match"] = options.etag;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, SYNC_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: method,
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store"
    });
  } catch (e) {
    throw new RemoteError(controller.signal.aborted ? "timeout" : "network",
      "No se pudo contactar al servidor", 0);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 304) return { notModified: true, etag: options.etag };

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch (e) { throw new RemoteError("bad_response", "El servidor devolvió una respuesta inesperada", res.status); }
  }

  if (!res.ok) {
    throw new RemoteError((data && data.error) || "http_" + res.status,
      (data && data.message) || "Error " + res.status, res.status);
  }
  return { data: data, etag: res.headers.get("etag") };
}

// -- API --------------------------------------------------------------------

export async function login(url, username, password) {
  const base = { url: normalizeUrl(url) };
  const r = await request(base, "POST", "/api/login", {
    body: { username: String(username).trim().toLowerCase(), password: password }
  });
  return upsertServer({
    id: serverId(url, username),
    url: base.url,
    username: r.data.user.username,
    userId: r.data.user.id,
    token: r.data.token,
    expiresAt: r.data.expiresAt
  });
}

export async function logout(server) {
  try { await request(server, "POST", "/api/logout"); } catch (e) { /* da igual */ }
  removeServer(server.id);
}

export async function fetchBoards(server) {
  return (await request(server, "GET", "/api/boards")).data.boards;
}

export async function createRemoteBoard(server, name, state) {
  return (await request(server, "POST", "/api/boards", { body: { name: name, state: state } })).data;
}

export async function fetchBoard(server, boardId, etag) {
  const r = await request(server, "GET", "/api/boards/" + encodeURIComponent(boardId), { etag: etag });
  if (r.notModified) return { notModified: true };
  return r.data;
}

// Detalle del freno del servidor ante una sincronización destructiva.
export function isDestructiveBlock(err) {
  return err instanceof RemoteError && err.code === "destructive_sync";
}

export async function pushChanges(server, boardId, payload) {
  return (await request(server, "POST", "/api/boards/" + encodeURIComponent(boardId) + "/sync",
    { body: payload })).data;
}

// Borrado suave en el servidor: el tablero deja de existir para el equipo pero
// su dueño puede recuperarlo desde la papelera.
export async function deleteRemoteBoard(server, boardId) {
  await request(server, "DELETE", "/api/boards/" + encodeURIComponent(boardId));
}

export async function fetchDeletedBoards(server) {
  return (await request(server, "GET", "/api/boards?deleted=1")).data.boards;
}

export async function undeleteRemoteBoard(server, boardId) {
  return (await request(server, "POST",
    "/api/boards/" + encodeURIComponent(boardId) + "/undelete")).data.board;
}

// Borrado definitivo; sólo vale para un tablero que ya está en la papelera.
export async function purgeRemoteBoard(server, boardId) {
  await request(server, "DELETE", "/api/boards/" + encodeURIComponent(boardId) + "?purge=1");
}

export async function fetchMembers(server, boardId) {
  return (await request(server, "GET", "/api/boards/" + encodeURIComponent(boardId) + "/members")).data.members;
}

export async function addMember(server, boardId, username, role) {
  return (await request(server, "POST", "/api/boards/" + encodeURIComponent(boardId) + "/members",
    { body: { username: username, role: role } })).data.member;
}

export async function removeMember(server, boardId, userId) {
  await request(server, "DELETE",
    "/api/boards/" + encodeURIComponent(boardId) + "/members/" + encodeURIComponent(userId));
}

// Bitácora del tablero compartido: qué cambió en cada versión y quién lo hizo.
export async function fetchBoardLog(server, boardId, limit) {
  const query = limit ? "?limit=" + encodeURIComponent(limit) : "";
  return (await request(server, "GET",
    "/api/boards/" + encodeURIComponent(boardId) + "/log" + query)).data;
}
