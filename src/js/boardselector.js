import {
  LS_BOARDS_INDEX, LS_ACTIVE, LS_BOARD_PREFIX, LS_SNAPSHOT_PREFIX, LS_TRASH_PREFIX,
  DEFAULT_META, SEED_REV, normalizeStamps
} from "./config.js";
import { clone } from "./utils.js";
import { showToast } from "./toast.js";
import { getServer } from "./remote.js";
// Ciclos intencionales: sólo se usan dentro de manejadores, nunca al evaluar
// el módulo, así que tanto ESM como el bundle IIFE los resuelven sin problema.
import { renderServers } from "./servers.js";
import { invalidateSync } from "./sync.js";

let _onBoardSelected = null;

// -- Índice de tableros -----------------------------------------------------

// Índice en crudo, incluidos los tableros eliminados. Lo usan las funciones
// que tienen que encontrar un tablero por su slug aunque esté en la papelera
// (una pestaña puede seguir teniéndolo en memoria) y la generación de slugs,
// que no puede reutilizar el de un tablero recuperable.
export function listAllBoards() {
  try {
    const raw = localStorage.getItem(LS_BOARDS_INDEX);
    if (raw) return JSON.parse(raw) || [];
  } catch (e) {}
  return [];
}

// La lista de trabajo: sin los eliminados. Todo lo que ya existía la usa, así
// que un tablero en la papelera desaparece de la interfaz sin tocar más código.
export function listBoards() {
  return listAllBoards().filter(function (b) { return !b.deletedAt; });
}

export function listDeletedBoards() {
  return listAllBoards()
    .filter(function (b) { return Boolean(b.deletedAt); })
    .sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
}

function saveBoards(boards) {
  try { localStorage.setItem(LS_BOARDS_INDEX, JSON.stringify(boards)); } catch (e) {}
}

// El tablero activo es POR PESTAÑA (sessionStorage). localStorage sólo guarda
// el último usado, para que una pestaña nueva abra algo razonable. Cuando era
// únicamente global, dos pestañas del mismo navegador se pisaban: la que tenía
// un tablero en memoria acababa guardándolo sobre el de la otra.
export function getActiveSlug() {
  try {
    const propio = sessionStorage.getItem(LS_ACTIVE);
    if (propio) return propio;
  } catch (e) {}
  return localStorage.getItem(LS_ACTIVE) || "";
}

// Fija el tablero de ESTA pestaña al arrancar, para que otra pestaña no pueda
// cambiárselo por debajo al escribir en localStorage.
export function initTabSession() {
  try {
    if (!sessionStorage.getItem(LS_ACTIVE)) {
      const ultimo = localStorage.getItem(LS_ACTIVE);
      if (ultimo) sessionStorage.setItem(LS_ACTIVE, ultimo);
    }
  } catch (e) {}
}

export function setActiveSlug(slug) {
  // Único punto por el que pasa TODO cambio de tablero, así que la
  // invalidación va aquí: hacerlo en cada sitio que llama es imposible de
  // mantener, y hacerlo tarde (con el activo ya cambiado) empuja el contenido
  // del tablero anterior al nuevo.
  if (slug !== getActiveSlug()) invalidateSync();
  try {
    if (slug) sessionStorage.setItem(LS_ACTIVE, slug);
    else sessionStorage.removeItem(LS_ACTIVE);
  } catch (e) {}
  if (slug) {
    localStorage.setItem(LS_ACTIVE, slug);
  } else {
    localStorage.removeItem(LS_ACTIVE);
  }
}

export function getBoardName(slug) {
  const b = listAllBoards().find(function (x) { return x.slug === slug; });
  return b ? b.name : "";
}

export function getBoardKey(slug) {
  return LS_BOARD_PREFIX + slug;
}

function slugify(name) {
  return (name || "tablero")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "tablero";
}

export function createBoard(name, extra) {
  const boards = listAllBoards();
  let base = slugify(name);
  let slug = base;
  let n = 2;
  while (boards.some(function (b) { return b.slug === slug; })) {
    slug = base + "_" + n++;
  }
  const now = new Date().toISOString();
  boards.push(Object.assign({ slug: slug, name: name, kind: "local", createdAt: now, updatedAt: now }, extra || {}));
  saveBoards(boards);
  return slug;
}

export function getBoardEntry(slug) {
  return listAllBoards().find(function (b) { return b.slug === slug; }) || null;
}

export function patchBoardEntry(slug, patch) {
  const boards = listAllBoards();
  const b = boards.find(function (x) { return x.slug === slug; });
  if (!b) return null;
  Object.assign(b, patch);
  saveBoards(boards);
  return b;
}

// Un tablero remoto se identifica por (servidor, id), no por su nombre: así no
// se duplica la entrada local si lo abres dos veces o si le cambian el nombre.
// Busca también entre los eliminados: si el usuario vuelve a abrir el tablero
// compartido desde el servidor, se recupera su entrada en vez de crear una
// segunda copia con el mismo contenido.
export function findRemoteEntry(serverId, boardId) {
  return listAllBoards().find(function (b) {
    return b.kind === "remote" && b.remote &&
           b.remote.serverId === serverId && b.remote.boardId === boardId;
  }) || null;
}

export function isRemote(entry) {
  return Boolean(entry && entry.kind === "remote" && entry.remote);
}

export function touchBoard(slug) {
  if (!slug) return;
  const boards = listAllBoards();
  const b = boards.find(function (b) { return b.slug === slug; });
  if (b) {
    b.updatedAt = new Date().toISOString();
    saveBoards(boards);
  }
}

// Borrado suave: el tablero sale de la interfaz pero su contenido sigue en
// localStorage. Eliminar un tablero por error es el accidente más caro de la
// app —se va el trabajo de meses de una vez— y hasta ahora era irreversible.
export function deleteBoard(slug) {
  const entry = patchBoardEntry(slug, { deletedAt: new Date().toISOString() });
  if (!entry) return null;
  if (getActiveSlug() === slug) setActiveSlug("");
  return entry;
}

export function restoreBoard(slug) {
  const entry = getBoardEntry(slug);
  if (!entry) return null;
  // Sin contenido no hay nada que recuperar: la entrada se retira del índice.
  if (!hasStoredBoard(slug)) {
    purgeBoard(slug);
    return null;
  }
  return patchBoardEntry(slug, { deletedAt: null });
}

export function hasStoredBoard(slug) {
  try {
    return Boolean(localStorage.getItem(getBoardKey(slug)));
  } catch (e) {
    return false;
  }
}

// Borrado definitivo: índice, contenido, instantánea de sincronización y
// papelera del tablero. Sólo se llega aquí desde la papelera de tableros.
export function purgeBoard(slug) {
  saveBoards(listAllBoards().filter(function (b) { return b.slug !== slug; }));
  try { localStorage.removeItem(getBoardKey(slug)); } catch (e) {}
  try { localStorage.removeItem(LS_SNAPSHOT_PREFIX + slug); } catch (e) {}
  try { localStorage.removeItem(LS_TRASH_PREFIX + slug); } catch (e) {}
  if (getActiveSlug() === slug) setActiveSlug("");
}

// -- UI del modal -----------------------------------------------------------

export function initBoardSelector(onSelected) {
  _onBoardSelected = onSelected;

  const overlay  = document.getElementById("boardSelectorOverlay");
  const closeBtn = document.getElementById("boardSelectorClose");
  const createBtn = document.getElementById("newBoardCreate");
  const nameInput = document.getElementById("newBoardName");

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      if (getActiveSlug()) closeBoardSelector();
    });
  }

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay && getActiveSlug()) closeBoardSelector();
    });
  }

  document.addEventListener("keydown", function (ev) {
    const isOpen = overlay && overlay.classList.contains("open");
    if (ev.key === "Escape" && isOpen && getActiveSlug()) closeBoardSelector();
  });

  if (createBtn) createBtn.addEventListener("click", handleCreate);
  if (nameInput) {
    nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") handleCreate();
    });
  }
}

function handleCreate() {
  const input = document.getElementById("newBoardName");
  const name = input ? input.value.trim() : "";
  if (!name) { if (input) input.focus(); return; }
  const isFirstEver = listBoards().length === 0;
  const slug = createBoard(name);
  setActiveSlug(slug);
  if (input) input.value = "";
  if (typeof _onBoardSelected === "function") _onBoardSelected(slug, true, isFirstEver);
}

export function openBoardSelector() {
  renderBoardList();
  renderDeletedBoards();
  // La sección de servidores se dibuja aparte y carga sus listas sin bloquear.
  renderServers();
  const overlay = document.getElementById("boardSelectorOverlay");
  if (overlay) overlay.classList.add("open");
  // Ocultar cierre si no hay tablero activo (no se puede cerrar sin elegir)
  const closeBtn = document.getElementById("boardSelectorClose");
  if (closeBtn) {
    closeBtn.style.visibility = getActiveSlug() ? "" : "hidden";
  }
  // Foco en el input si no hay tableros
  if (!listBoards().length) {
    const input = document.getElementById("newBoardName");
    if (input) setTimeout(function () { input.focus(); }, 80);
  }
}

export function closeBoardSelector() {
  const overlay = document.getElementById("boardSelectorOverlay");
  if (overlay) overlay.classList.remove("open");
}

export function renderBoardList() {
  const list = document.getElementById("boardList");
  if (!list) return;

  const boards = listBoards();
  const active = getActiveSlug();
  list.innerHTML = "";

  if (!boards.length) {
    const p = document.createElement("p");
    p.className = "bs-empty";
    p.textContent = "Aún no tienes tableros. Crea uno a continuación.";
    list.appendChild(p);
    return;
  }

  boards.forEach(function (b) {
    const remote = isRemote(b);
    const row = document.createElement("div");
    row.className = "bs-item" + (b.slug === active ? " bs-active" : "") + (remote ? " bs-shared" : "");

    // Nombre / selector
    const nameBtn = document.createElement("button");
    nameBtn.className = "bs-name";
    nameBtn.textContent = b.name;
    nameBtn.title = "Abrir este tablero";
    if (remote) {
      const badge = document.createElement("span");
      badge.className = "bs-badge";
      badge.textContent = "compartido";
      nameBtn.appendChild(badge);
    } else if (b.detached) {
      // Era compartido y la sesión se cerró: se reengancha al reconectar.
      const badge = document.createElement("span");
      badge.className = "bs-badge bs-badge-detached";
      badge.textContent = "desconectado";
      badge.title = "Se sincronizará al volver a conectarte a su servidor";
      nameBtn.appendChild(badge);
    }

    const metaEl = document.createElement("span");
    metaEl.className = "bs-meta";
    if (b.updatedAt) {
      const d = new Date(b.updatedAt);
      metaEl.textContent = "Actualizado " + d.toLocaleDateString("es", {
        day: "2-digit", month: "short", year: "numeric"
      });
    }
    if (remote) {
      const server = getServer(b.remote.serverId);
      metaEl.textContent += server ? " · " + server.username + "@" + server.url : " · servidor desconectado";
    } else if (b.detached) {
      const server = getServer(b.detached.serverId);
      const donde = server ? server.username + "@" + server.url : String(b.detached.serverId || "").replace("#", " · ");
      metaEl.textContent += " · pendiente de reconectar a " + donde;
    }

    const info = document.createElement("div");
    info.className = "bs-info";
    info.appendChild(nameBtn);
    info.appendChild(metaEl);

    // Botón eliminar (dos clics para confirmar)
    const delBtn = document.createElement("button");
    delBtn.className = "bs-delete";
    delBtn.title = remote
      ? "Quitar la copia de este navegador (no borra el tablero del servidor)"
      : "Eliminar tablero";
    delBtn.textContent = "✕";

    let armed = false;
    let armTimer = null;

    delBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!armed) {
        armed = true;
        delBtn.textContent = "¿Borrar?";
        delBtn.classList.add("armed");
        armTimer = setTimeout(function () {
          armed = false;
          delBtn.textContent = "✕";
          delBtn.classList.remove("armed");
        }, 3000);
      } else {
        clearTimeout(armTimer);
        const name = b.name;
        // La instantánea de sincronización NO se borra: hace falta para que el
        // tablero vuelva a su sitio si se recupera. Se va con la purga.
        deleteBoard(b.slug);
        showToast(remote
          ? "Copia local de \"" + name + "\" eliminada · recupérala más abajo, en Tableros eliminados"
          : "Tablero \"" + name + "\" eliminado · recupéralo más abajo, en Tableros eliminados",
          "info", 6000);
        openBoardSelector(); // re-renderiza la lista (y gestiona activo vacío)
      }
    });

    nameBtn.addEventListener("click", function () {
      setActiveSlug(b.slug);
      if (typeof _onBoardSelected === "function") _onBoardSelected(b.slug, false);
    });

    // Botón clonar (dos clics para confirmar: nadie quiere duplicar un
    // tablero por un clic de más)
    const cloneBtn = document.createElement("button");
    cloneBtn.className = "bs-clone";
    cloneBtn.title = "Clonar: tablero nuevo con los mismos frentes y tarjetas, " +
      "todas en Backlog (sin comentarios ni fechas de cierre)";
    cloneBtn.textContent = "⧉";

    let cloneArmed = false;
    let cloneTimer = null;

    cloneBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!cloneArmed) {
        cloneArmed = true;
        cloneBtn.textContent = "¿Clonar?";
        cloneBtn.classList.add("armed");
        cloneTimer = setTimeout(function () {
          cloneArmed = false;
          cloneBtn.textContent = "⧉";
          cloneBtn.classList.remove("armed");
        }, 3000);
        return;
      }
      clearTimeout(cloneTimer);
      const hecho = cloneBoard(b.slug);
      if (!hecho) {
        showToast("No se pudo clonar \"" + b.name + "\": sin contenido guardado o sin espacio en el navegador", "error", 6000);
        openBoardSelector();
        return;
      }
      showToast("Clonado como \"" + hecho.name + "\": " + hecho.cards +
        (hecho.cards === 1 ? " tarjeta" : " tarjetas") + " en Backlog y " + hecho.ws +
        (hecho.ws === 1 ? " frente" : " frentes") + " · sin comentarios ni fechas", "success", 6000);
      // Se abre el clon: clonar es empezar a trabajar en él.
      setActiveSlug(hecho.slug);
      if (typeof _onBoardSelected === "function") _onBoardSelected(hecho.slug, false);
    });

    row.appendChild(info);
    row.appendChild(cloneBtn);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}


// -- Clonar un tablero ------------------------------------------------------
//
// Clonar es empezar otra vuelta del mismo trabajo: se conservan los frentes y
// las tarjetas —con su título, descripción, etiquetas, prioridad y frente— y
// todas caen en Backlog, que es donde vive lo que aún no está comprometido.
//
// Dos decisiones que conviene no revertir sin pensarlo:
//
//  1. **El clon es siempre local.** Clonar un tablero compartido copia lo que
//     tienes en el navegador; no crea nada en el servidor ni arrastra la
//     entrada `remote`. Así clonar funciona sin red y con permiso de sólo
//     lectura, y nadie duplica sin querer el tablero de su equipo.
//  2. **No viajan los comentarios ni las fechas de cierre.** Son del ciclo
//     anterior: los comentarios son una conversación ya cerrada y una fecha
//     pasada marcaría el tablero nuevo entero como vencido el primer día.

export const CLONE_COL = "backlog";

function readStoredState(slug) {
  try {
    const raw = localStorage.getItem(getBoardKey(slug));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && Array.isArray(s.cards) && Array.isArray(s.ws)) return s;
  } catch (e) {}
  return null;
}

// "Tablero" -> "Tablero (copia)" -> "Tablero (copia 2)"…
export function cloneName(base) {
  const tomados = new Set(listBoards().map(function (b) { return b.name; }));
  let nombre = base + " (copia)";
  let n = 2;
  while (tomados.has(nombre)) nombre = base + " (copia " + n++ + ")";
  return nombre;
}

/**
 * Crea un tablero local a partir de otro. Devuelve
 * `{ slug, name, cards, ws }` o null si el origen no tiene contenido.
 */
export function cloneBoard(slug) {
  const origen = readStoredState(slug);
  if (!origen) return null;

  const nombre = cloneName(getBoardName(slug) || "Tablero");
  const estado = {
    rev: SEED_REV,
    // El nombre del tablero manda sobre el título del encabezado: si no, el
    // clon se abriría anunciándose como el original.
    meta: Object.assign({}, clone(origen.meta || DEFAULT_META), { title: nombre }),
    ws: (origen.ws || []).map(function (w) {
      return { key: w.key, label: w.label, color: w.color };
    }),
    cards: (origen.cards || []).map(function (c) {
      return {
        id: c.id,
        ws: c.ws,
        pri: c.pri,
        col: CLONE_COL,
        t: c.t,
        d: c.d || "",
        labels: Array.isArray(c.labels) ? c.labels.slice() : [],
        due: "",
        comments: []
      };
    })
  };
  // Las columnas son la forma del tablero, no del ciclo: el clon las hereda.
  if (Array.isArray(origen.cols)) estado.cols = clone(origen.cols);

  // El clon empieza otra vuelta del mismo trabajo: las tarjetas nacen hoy y
  // sin ciclo anterior. Como todas caen en Backlog, normalizeStamps las deja
  // con `cr`/`ca` de ahora y sin `st` ni `dn`; heredar el cierre del ciclo
  // anterior daría Cycle Times de meses el primer día.
  normalizeStamps(estado);

  const nuevoSlug = createBoard(nombre);
  try {
    localStorage.setItem(getBoardKey(nuevoSlug), JSON.stringify(estado));
  } catch (e) {
    // Sin sitio en el navegador: se deshace el alta para no dejar en la lista
    // un tablero que abriría vacío.
    purgeBoard(nuevoSlug);
    return null;
  }

  return { slug: nuevoSlug, name: nombre, cards: estado.cards.length, ws: estado.ws.length };
}

// -- Papelera de tableros ---------------------------------------------------
//
// Un tablero eliminado sigue entero en localStorage hasta que se purga a mano.
// Esta sección es la única vía de recuperación: sin ella el borrado suave no
// serviría de nada, porque el tablero desaparece igual de la lista.

export function renderDeletedBoards() {
  const host = document.getElementById("deletedBoards");
  const section = document.getElementById("deletedBoardsSection");
  if (!host) return;

  const deleted = listDeletedBoards();
  if (section) section.hidden = deleted.length === 0;
  host.innerHTML = "";
  if (!deleted.length) return;

  deleted.forEach(function (b) {
    const row = document.createElement("div");
    row.className = "bs-item bs-deleted";

    const info = document.createElement("div");
    info.className = "bs-info";

    const name = document.createElement("span");
    name.className = "bs-name bs-name-static";
    name.textContent = b.name;
    if (isRemote(b)) {
      const badge = document.createElement("span");
      badge.className = "bs-badge";
      badge.textContent = "compartido";
      name.appendChild(badge);
    }

    const meta = document.createElement("span");
    meta.className = "bs-meta";
    const cuando = b.deletedAt ? new Date(b.deletedAt) : null;
    meta.textContent = "Eliminado " + (cuando
      ? cuando.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "hace un rato") + " · " + describeStored(b.slug);

    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);

    const restore = document.createElement("button");
    restore.className = "btn bs-restore";
    restore.textContent = "Restaurar";
    restore.title = "Devolver este tablero a la lista con todo su contenido";
    restore.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const entry = restoreBoard(b.slug);
      showToast(entry
        ? "Tablero \"" + b.name + "\" restaurado"
        : "Ya no queda contenido guardado de \"" + b.name + "\"",
        entry ? "success" : "warn", 5000);
      openBoardSelector();
    });
    row.appendChild(restore);

    const purge = document.createElement("button");
    purge.className = "bs-delete";
    purge.textContent = "✕";
    purge.title = "Eliminar definitivamente: esto ya no se puede deshacer";

    let armado = false;
    let timer = null;
    purge.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!armado) {
        armado = true;
        purge.textContent = "¿Definitivo?";
        purge.classList.add("armed");
        timer = setTimeout(function () {
          armado = false;
          purge.textContent = "✕";
          purge.classList.remove("armed");
        }, 4000);
        return;
      }
      clearTimeout(timer);
      purgeBoard(b.slug);
      showToast("\"" + b.name + "\" eliminado definitivamente", "info");
      openBoardSelector();
    });
    row.appendChild(purge);

    host.appendChild(row);
  });
}

// Cuánto contenido queda guardado del tablero, para que la decisión de purgar
// o restaurar no se tome a ciegas.
function describeStored(slug) {
  try {
    const raw = localStorage.getItem(getBoardKey(slug));
    if (!raw) return "sin contenido guardado";
    const s = JSON.parse(raw);
    const cards = Array.isArray(s.cards) ? s.cards.length : 0;
    const ws = Array.isArray(s.ws) ? s.ws.length : 0;
    return cards + " tarjeta" + (cards === 1 ? "" : "s") + " · " +
           ws + " frente" + (ws === 1 ? "" : "s");
  } catch (e) {
    return "contenido ilegible";
  }
}
