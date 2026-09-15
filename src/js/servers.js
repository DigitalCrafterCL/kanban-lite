// UI de servidores de tableros compartidos: conexión, lista de tableros
// remotos y gestión de miembros.
//
// Todo es opcional. Sin servidores dados de alta esta sección se muestra
// plegada y nunca se hace una petición.

import {
  listServers, getServer, login, logout, fetchBoards, createRemoteBoard,
  fetchBoard, deleteRemoteBoard, fetchMembers, addMember, removeMember,
  isSessionValid, normalizeUrl, RemoteError,
  fetchDeletedBoards, undeleteRemoteBoard, purgeRemoteBoard
} from "./remote.js";
import {
  listBoards, listAllBoards, createBoard, patchBoardEntry, findRemoteEntry,
  setActiveSlug, getBoardKey, deleteBoard
} from "./boardselector.js";
import { clearSnapshot, writeSnapshot } from "./sync.js";
import { blankState } from "./store.js";
import { showToast } from "./toast.js";
import { esc } from "./utils.js";

let _onBoardOpened = null;   // (slug) => void
let _onIndexChanged = null;  // () => void  (re-renderiza la lista de tableros)

export function initServers(onBoardOpened, onIndexChanged) {
  _onBoardOpened = onBoardOpened;
  _onIndexChanged = onIndexChanged;

  const connectBtn = document.getElementById("srvConnect");
  if (connectBtn) connectBtn.addEventListener("click", handleConnect);

  const passInput = document.getElementById("srvPass");
  if (passInput) {
    passInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") handleConnect();
    });
  }

  const membersOverlay = document.getElementById("membersOverlay");
  const membersClose = document.getElementById("membersClose");
  if (membersClose) membersClose.addEventListener("click", closeMembers);
  if (membersOverlay) {
    membersOverlay.addEventListener("mousedown", function (ev) {
      if (ev.target === membersOverlay) closeMembers();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && membersOverlay && membersOverlay.classList.contains("open")) {
      closeMembers();
    }
  });
}

// -- Conexión ---------------------------------------------------------------

function setConnectMsg(text, isError) {
  const el = document.getElementById("srvMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("err", Boolean(isError));
}

async function handleConnect() {
  const urlInput = document.getElementById("srvUrl");
  const userInput = document.getElementById("srvUser");
  const passInput = document.getElementById("srvPass");
  const button = document.getElementById("srvConnect");
  if (!urlInput || !userInput || !passInput) return;

  const url = normalizeUrl(urlInput.value);
  const username = userInput.value.trim();
  const password = passInput.value;

  if (!url || !username || !password) {
    setConnectMsg("Completa dirección, usuario y contraseña.", true);
    return;
  }

  button.disabled = true;
  setConnectMsg("Conectando…", false);
  try {
    const server = await login(url, username, password);
    passInput.value = "";
    setConnectMsg("", false);
    showToast("Conectado a " + server.url + " como " + server.username, "success");
    await renderServers();
    if (typeof _onIndexChanged === "function") _onIndexChanged();
  } catch (err) {
    setConnectMsg(describeError(err), true);
  } finally {
    button.disabled = false;
  }
}

function describeError(err) {
  if (err instanceof RemoteError) {
    if (err.isOffline) return "No se pudo contactar al servidor. Revisa la dirección y que esté encendido.";
    if (err.status === 401) return "Usuario o contraseña incorrectos.";
    if (err.status === 429) return "Demasiados intentos fallidos. Espera unos minutos.";
    return err.message;
  }
  return "Error inesperado: " + (err && err.message ? err.message : err);
}

// -- Lista de servidores y sus tableros -------------------------------------

export async function renderServers() {
  const host = document.getElementById("serverList");
  if (!host) return;

  const servers = listServers();
  host.innerHTML = "";

  if (!servers.length) {
    const p = document.createElement("p");
    p.className = "bs-empty";
    p.textContent = "Sin servidores. Conéctate a uno para ver tableros compartidos.";
    host.appendChild(p);
    return;
  }

  for (const server of servers) {
    host.appendChild(buildServerBlock(server));
  }
  // Las listas se cargan en paralelo y sin bloquear el render.
  servers.forEach(function (server) { loadServerBoards(server); });
}

function buildServerBlock(server) {
  const block = document.createElement("div");
  block.className = "srv-block";
  block.dataset.server = server.id;

  const head = document.createElement("div");
  head.className = "srv-head";
  head.innerHTML =
    '<span class="srv-user">' + esc(server.username) + '</span>' +
    '<span class="srv-url">' + esc(server.url) + '</span>';

  const actions = document.createElement("span");
  actions.className = "srv-actions";

  const newBtn = document.createElement("button");
  newBtn.className = "srv-btn";
  newBtn.textContent = "+ Tablero";
  newBtn.title = "Crear un tablero compartido en este servidor";
  newBtn.addEventListener("click", function () { promptNewRemoteBoard(server, block); });

  const outBtn = document.createElement("button");
  outBtn.className = "srv-btn";
  outBtn.textContent = "Desconectar";
  outBtn.addEventListener("click", function () { handleDisconnect(server); });

  actions.appendChild(newBtn);
  actions.appendChild(outBtn);
  head.appendChild(actions);
  block.appendChild(head);

  const list = document.createElement("div");
  list.className = "srv-boards";
  list.innerHTML = '<p class="bs-empty">Cargando tableros…</p>';
  block.appendChild(list);

  return block;
}

async function loadServerBoards(server) {
  const block = document.querySelector('.srv-block[data-server="' + cssEscape(server.id) + '"]');
  if (!block) return;
  const list = block.querySelector(".srv-boards");

  if (!isSessionValid(server)) {
    list.innerHTML = '<p class="bs-empty err">Sesión expirada. Vuelve a conectarte.</p>';
    return;
  }

  let boards;
  try {
    boards = await fetchBoards(server);
  } catch (err) {
    const offline = err instanceof RemoteError && err.isOffline;
    list.innerHTML = '<p class="bs-empty' + (offline ? "" : " err") + '">' +
      esc(offline ? "Sin conexión. Los tableros ya abiertos siguen disponibles sin red."
                  : describeError(err)) + '</p>';
    return;
  }

  // La papelera se pide siempre, incluso sin tableros vivos: el caso que hay
  // que poder resolver es justo ese, el de haberlos eliminado todos.
  loadDeletedRemoteBoards(server, block);

  list.innerHTML = "";
  if (!boards.length) {
    list.innerHTML = '<p class="bs-empty">Este servidor no tiene tableros para ti todavía.</p>';
    return;
  }

  for (const board of boards) {
    list.appendChild(buildRemoteBoardRow(server, board));
  }
}

// Papelera del servidor: sólo trae algo para el dueño de un tablero eliminado.
// Es la vía de recuperación cuando alguien borra un tablero compartido por
// error, que se lleva por delante el trabajo de todo el equipo.
async function loadDeletedRemoteBoards(server, block) {
  let deleted = [];
  try {
    deleted = await fetchDeletedBoards(server);
  } catch (err) {
    return; // la papelera es accesoria: si falla, no se estorba la lista normal
  }

  const previo = block.querySelector(".srv-trash");
  if (previo) previo.remove();
  if (!deleted.length) return;

  const box = document.createElement("div");
  box.className = "srv-trash";
  const head = document.createElement("div");
  head.className = "lbl-sec";
  head.textContent = "Tableros eliminados en el servidor";
  box.appendChild(head);

  for (const board of deleted) {
    box.appendChild(buildDeletedRemoteRow(server, board, block));
  }
  block.appendChild(box);
}

function buildDeletedRemoteRow(server, board, block) {
  const row = document.createElement("div");
  row.className = "bs-item srv-board bs-deleted";

  const info = document.createElement("div");
  info.className = "bs-info";

  const name = document.createElement("span");
  name.className = "bs-name bs-name-static";
  name.textContent = board.name;

  const meta = document.createElement("span");
  meta.className = "bs-meta";
  const cuando = board.deletedAt ? new Date(board.deletedAt) : null;
  meta.textContent = "Eliminado " + (cuando
    ? cuando.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "hace un rato") + " · v" + board.version;

  info.appendChild(name);
  info.appendChild(meta);
  row.appendChild(info);

  const restore = document.createElement("button");
  restore.className = "btn bs-restore";
  restore.textContent = "Restaurar";
  restore.title = "Devolverlo al servidor con todo su contenido y sus miembros";
  restore.addEventListener("click", async function (ev) {
    ev.stopPropagation();
    restore.disabled = true;
    try {
      await undeleteRemoteBoard(server, board.id);
      showToast('Tablero "' + board.name + '" recuperado en el servidor', "success", 5000);
      await loadServerBoards(server);
      if (typeof _onIndexChanged === "function") _onIndexChanged();
    } catch (err) {
      showToast(describeError(err), "error", 6000);
      restore.disabled = false;
    }
  });
  row.appendChild(restore);

  const purge = document.createElement("button");
  purge.className = "bs-delete";
  purge.textContent = "✕";
  purge.title = "Eliminar definitivamente del servidor, con su histórico. No se puede deshacer.";
  armTwoStep(purge, "¿Definitivo?", async function () {
    try {
      await purgeRemoteBoard(server, board.id);
      showToast('"' + board.name + '" eliminado definitivamente del servidor', "info", 5000);
      await loadServerBoards(server);
    } catch (err) {
      showToast(describeError(err), "error", 6000);
    }
  });
  row.appendChild(purge);

  return row;
}

function buildRemoteBoardRow(server, board) {
  const row = document.createElement("div");
  row.className = "bs-item srv-board";

  const openBtn = document.createElement("button");
  openBtn.className = "bs-name";
  openBtn.textContent = board.name;
  openBtn.title = "Abrir este tablero compartido";
  openBtn.addEventListener("click", function () { openRemoteBoard(server, board); });

  const meta = document.createElement("span");
  meta.className = "bs-meta";
  const roleLabel = { owner: "dueño", write: "edición", read: "sólo lectura" }[board.role] || board.role;
  meta.textContent = roleLabel + " · de " + board.ownerName;

  const info = document.createElement("div");
  info.className = "bs-info";
  info.appendChild(openBtn);
  info.appendChild(meta);
  row.appendChild(info);

  if (board.role === "owner") {
    const membersBtn = document.createElement("button");
    membersBtn.className = "bs-delete srv-members";
    membersBtn.textContent = "👥";
    membersBtn.title = "Gestionar miembros";
    membersBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openMembers(server, board);
    });
    row.appendChild(membersBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "bs-delete";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar del servidor para todos";
    armTwoStep(delBtn, "¿Borrar?", function () { handleDeleteRemote(server, board); });
    row.appendChild(delBtn);
  }

  return row;
}

// Botón de confirmación en dos pasos, con reversión automática.
function armTwoStep(button, armedLabel, onConfirm) {
  const original = button.textContent;
  let armed = false;
  let timer = null;
  button.addEventListener("click", function (ev) {
    ev.stopPropagation();
    if (!armed) {
      armed = true;
      button.textContent = armedLabel;
      button.classList.add("armed");
      timer = setTimeout(function () {
        armed = false;
        button.textContent = original;
        button.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}

// -- Abrir un tablero remoto ------------------------------------------------

export async function openRemoteBoard(server, board) {
  const existing = findRemoteEntry(server.id, board.id);

  // Si ya lo teníamos descargado, se abre tal cual y la sincronización normal
  // se encarga de traer lo nuevo y subir lo pendiente. Descargar y sobrescribir
  // aquí borraría cualquier cambio local que aún no hubiera subido.
  if (existing && hasLocalCopy(existing.slug)) {
    // deletedAt a null: si su copia local estaba en la papelera, volver a
    // abrirlo desde el servidor la recupera en vez de dejar dos entradas del
    // mismo tablero (una invisible y otra nueva).
    patchBoardEntry(existing.slug, { name: board.name, deletedAt: null });
    finishOpen(existing.slug);
    return;
  }

  let state = null;
  try {
    const fresh = await fetchBoard(server, board.id);
    state = stripForLocal(fresh.state);
    var version = fresh.version;
  } catch (err) {
    // Sin red: sólo podemos abrirlo si ya lo teníamos descargado.
    if (!existing) {
      showToast(describeError(err), "error", 6000);
      return;
    }
    showToast("Sin conexión: abriendo la última copia descargada", "warn", 5000);
    patchBoardEntry(existing.slug, { deletedAt: null });
    finishOpen(existing.slug);
    return;
  }

  let slug;
  if (existing) {
    slug = existing.slug;
    patchBoardEntry(slug, {
      name: board.name,
      deletedAt: null,
      remote: Object.assign({}, existing.remote, {
        baseVersion: version, role: board.role, lastSync: new Date().toISOString()
      })
    });
  } else {
    slug = createBoard(board.name, {
      kind: "remote",
      remote: {
        serverId: server.id, boardId: board.id, baseVersion: version,
        role: board.role, lastSync: new Date().toISOString()
      }
    });
  }

  // Sembramos el estado y la instantánea ANTES de activar el tablero: así el
  // primer diff sale vacío y no le empujamos basura local al tablero compartido.
  try {
    localStorage.setItem(getBoardKey(slug), JSON.stringify(state));
  } catch (e) {
    showToast("No hay espacio en el navegador para descargar este tablero.", "error", 7000);
    return;
  }
  writeSnapshot(slug, state);
  finishOpen(slug);
}

function hasLocalCopy(slug) {
  try {
    const raw = localStorage.getItem(getBoardKey(slug));
    if (!raw) return false;
    const s = JSON.parse(raw);
    return Boolean(s && Array.isArray(s.cards) && Array.isArray(s.ws));
  } catch (e) {
    return false;
  }
}

function stripForLocal(serverState) {
  return {
    rev: serverState.rev || 2,
    meta: serverState.meta ? omit(serverState.meta, "v") : {},
    ws: (serverState.ws || []).map(function (w) { return omit(w, "v"); }),
    cards: (serverState.cards || []).map(function (c) { return omit(c, "v"); })
  };
}

function omit(obj, key) {
  const out = {};
  for (const k of Object.keys(obj)) if (k !== key) out[k] = obj[k];
  return out;
}

function finishOpen(slug) {
  setActiveSlug(slug);
  if (typeof _onBoardOpened === "function") _onBoardOpened(slug);
}

// -- Crear y borrar tableros remotos ----------------------------------------

function promptNewRemoteBoard(server, block) {
  const existing = block.querySelector(".srv-new");
  if (existing) { existing.querySelector("input").focus(); return; }

  const bar = document.createElement("div");
  bar.className = "srv-new";
  bar.innerHTML =
    '<input type="text" class="ff-in" placeholder="Nombre del tablero compartido" maxlength="40">' +
    '<button class="btn primary">Crear</button>' +
    '<button class="btn">Cancelar</button>';

  const input = bar.querySelector("input");
  const [createBtn, cancelBtn] = bar.querySelectorAll("button");

  const submit = async function () {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    createBtn.disabled = true;
    try {
      const created = await createRemoteBoard(server, name, blankState(name));
      bar.remove();
      showToast('Tablero compartido "' + name + '" creado', "success");
      await openRemoteBoard(server, Object.assign({ role: "owner", ownerName: server.username }, created.board));
    } catch (err) {
      showToast(describeError(err), "error", 6000);
      createBtn.disabled = false;
    }
  };

  createBtn.addEventListener("click", submit);
  input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") submit(); });
  cancelBtn.addEventListener("click", function () { bar.remove(); });

  block.appendChild(bar);
  input.focus();
}

async function handleDeleteRemote(server, board) {
  try {
    await deleteRemoteBoard(server, board.id);
  } catch (err) {
    showToast(describeError(err), "error", 6000);
    return;
  }
  // La copia local también va a la papelera (no se purga): si el tablero se
  // recupera en el servidor, se recupera aquí con su contenido y su instantánea.
  const entry = findRemoteEntry(server.id, board.id);
  if (entry) deleteBoard(entry.slug);
  showToast('Tablero "' + board.name + '" eliminado · recuperable desde «Tableros eliminados en el servidor»',
    "info", 7000);
  await renderServers();
  if (typeof _onIndexChanged === "function") _onIndexChanged();
}

async function handleDisconnect(server) {
  // Las copias locales se conservan: desconectarse no debe borrar trabajo.
  for (const entry of listAllBoards()) {
    if (entry.kind === "remote" && entry.remote && entry.remote.serverId === server.id) {
      patchBoardEntry(entry.slug, { kind: "local", remote: null });
      clearSnapshot(entry.slug);
    }
  }
  await logout(server);
  showToast("Desconectado. Los tableros descargados quedaron como copias locales.", "info", 6000);
  await renderServers();
  if (typeof _onIndexChanged === "function") _onIndexChanged();
}

// -- Miembros ---------------------------------------------------------------

let membersContext = null;

export async function openMembers(server, board) {
  membersContext = { server: server, board: board };
  const overlay = document.getElementById("membersOverlay");
  const title = document.getElementById("membersBoardName");
  if (title) title.textContent = board.name;
  if (overlay) overlay.classList.add("open");
  setMembersMsg("", false);

  const addBtn = document.getElementById("memberAdd");
  if (addBtn) addBtn.onclick = handleAddMember;
  const nameInput = document.getElementById("memberName");
  if (nameInput) {
    nameInput.value = "";
    nameInput.onkeydown = function (ev) { if (ev.key === "Enter") handleAddMember(); };
  }
  await renderMembers();
}

export function closeMembers() {
  const overlay = document.getElementById("membersOverlay");
  if (overlay) overlay.classList.remove("open");
  membersContext = null;
}

function setMembersMsg(text, isError) {
  const el = document.getElementById("membersMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("err", Boolean(isError));
}

async function renderMembers() {
  const list = document.getElementById("membersList");
  if (!list || !membersContext) return;
  list.innerHTML = '<p class="bs-empty">Cargando…</p>';

  let members;
  try {
    members = await fetchMembers(membersContext.server, membersContext.board.id);
  } catch (err) {
    list.innerHTML = '<p class="bs-empty err">' + esc(describeError(err)) + '</p>';
    return;
  }

  list.innerHTML = "";
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "member-row";

    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = member.username;

    const role = document.createElement("span");
    role.className = "member-role";
    role.textContent = { owner: "dueño", write: "edición", read: "sólo lectura" }[member.role] || member.role;

    row.appendChild(name);
    row.appendChild(role);

    if (member.role !== "owner") {
      const del = document.createElement("button");
      del.className = "bs-delete";
      del.textContent = "✕";
      del.title = "Quitar acceso";
      armTwoStep(del, "¿Quitar?", async function () {
        try {
          await removeMember(membersContext.server, membersContext.board.id, member.userId);
          await renderMembers();
        } catch (err) {
          setMembersMsg(describeError(err), true);
        }
      });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
}

async function handleAddMember() {
  if (!membersContext) return;
  const nameInput = document.getElementById("memberName");
  const roleSelect = document.getElementById("memberRole");
  const username = nameInput ? nameInput.value.trim() : "";
  if (!username) { if (nameInput) nameInput.focus(); return; }

  setMembersMsg("Invitando…", false);
  try {
    await addMember(membersContext.server, membersContext.board.id, username,
      roleSelect ? roleSelect.value : "write");
    nameInput.value = "";
    setMembersMsg("", false);
    await renderMembers();
  } catch (err) {
    setMembersMsg(describeError(err), true);
  }
}

// document.querySelector necesita escapar el id del servidor, que lleva "/" y "#".
function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\#.:/?&=@\[\]]/g, "\\$&");
}
