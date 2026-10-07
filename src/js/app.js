import {
  initStore, resetStore, setState, baseState, blankState, setSaveHook,
  getStateSlug, reloadFromStorage
} from "./store.js";
import { initTheme } from "./theme.js";
import { initHeader, renderHeader } from "./header.js";
import { buildFilters, initSearch, resetFilters } from "./filters.js";
import { render } from "./render.js";
import { initFrentesModal, openCfg } from "./frentes.js";
import { initDataModals } from "./io.js";
import { initTemplatesModal, openTemplatesModal } from "./templates.js";
import { initHotkeys } from "./hotkeys.js";
import { initPaste } from "./paste.js";
import { initBitacora, updateBitacoraButton } from "./bitacora.js";
import { initMetrics } from "./metricsui.js";
import { initCardDetail } from "./carddetail.js";
import { initHeadMenu } from "./headmenu.js";
import { initTrash, updateTrashButton } from "./trash.js";
import {
  initBoardSelector, openBoardSelector,
  closeBoardSelector, getActiveSlug, getBoardName, renderBoardList,
  initTabSession, getBoardKey
} from "./boardselector.js";
import {
  initSync, scheduleSync, refreshSyncStatus, onSyncStatus, syncNow,
  getDestructiveBlock, discardLocalAndPull, forceDestructiveSync, expireStaleSessions
} from "./sync.js";
import { initColumnsModal } from "./columns.js";
import { initConflictsModal, openConflicts } from "./conflicts.js";
import { showToast } from "./toast.js";
import { initServers } from "./servers.js";

const SYNC_LABELS = {
  synced:  "sincronizado",
  pending: "cambios sin subir",
  syncing: "sincronizando…",
  offline: "sin conexión",
  auth:    "sesión expirada",
  error:   "error de sincronización",
  readonly: "👁 sólo lectura",
  blocked: "⚠ frenada — pulsa aquí",
  detached: "desconectado — reconectar",
  conflict: "⚠ conflictos — decidir"
};

function renderSyncBadge(status, detail) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  if (status === "local") {
    el.hidden = true;
    el.className = "sync-status";
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.className = "sync-status is-" + status;
  el.textContent = SYNC_LABELS[status] || status;
  el.title = detail || SYNC_LABELS[status] || "";
}

function initBlockedModal(onResolved) {
  const overlay = document.getElementById("blockedOverlay");
  const cerrar = document.getElementById("blockedClose");
  const badge = document.getElementById("syncStatus");

  const abrir = function () {
    const bloqueo = getDestructiveBlock();
    if (!bloqueo) return;
    const msg = document.getElementById("blockedMsg");
    if (msg) msg.textContent = bloqueo.mensaje;
    if (overlay) overlay.classList.add("open");
  };
  const cerrarModal = function () {
    if (overlay) overlay.classList.remove("open");
  };

  if (badge) {
    badge.addEventListener("click", function () {
      if (badge.classList.contains("is-blocked")) abrir();
      if (badge.classList.contains("is-conflict")) openConflicts();
      // Desconectado: el selector de tableros tiene el botón para volver a entrar.
      if (badge.classList.contains("is-detached")) openBoardSelector();
    });
  }
  if (cerrar) cerrar.addEventListener("click", cerrarModal);
  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) cerrarModal();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) cerrarModal();
  });

  const descartar = document.getElementById("blockedDiscard");
  if (descartar) {
    descartar.addEventListener("click", async function () {
      descartar.disabled = true;
      try {
        await discardLocalAndPull();
        showToast("Tablero recargado desde el servidor", "success");
        cerrarModal();
        if (typeof onResolved === "function") onResolved();
      } catch (e) {
        showToast("No se pudo recargar: " + (e && e.message ? e.message : e), "error", 6000);
      } finally {
        descartar.disabled = false;
      }
    });
  }

  const forzar = document.getElementById("blockedForce");
  if (forzar) {
    let armado = false;
    forzar.addEventListener("click", async function () {
      if (!armado) {
        armado = true;
        forzar.textContent = "Pulsa otra vez para confirmar el borrado";
        setTimeout(function () {
          armado = false;
          forzar.textContent = "Subir de todos modos y borrar esos elementos";
        }, 4000);
        return;
      }
      forzar.disabled = true;
      try {
        await forceDestructiveSync();
        cerrarModal();
        if (typeof onResolved === "function") onResolved();
      } finally {
        forzar.disabled = false;
        armado = false;
        forzar.textContent = "Subir de todos modos y borrar esos elementos";
      }
    });
  }
}

export function initApp() {
  initTabSession();
  initTheme();

  function refreshAll() {
    renderHeader();
    buildFilters(render, openCfg);
    render();
    // El botón de bitácora sólo existe en tableros compartidos, y el tablero
    // activo cambia por debajo (selector, sincronización, otra pestaña).
    updateBitacoraButton();
    updateTrashButton();
  }

  // Callback cuando el usuario selecciona o crea un tablero.
  // Tableros nuevos comienzan en blanco y muestran plantillas al crear.
  function onBoardSelected(slug, isNew, isFirstEver) {
    resetStore();
    if (isNew) {
      setState(blankState(getBoardName(slug)), true);
    } else {
      initStore();
    }
    resetFilters();
    refreshAll();
    closeBoardSelector();
    activateSync();
    if (isNew) {
      openTemplatesModal();
    }
  }

  // Un tablero compartido llega con su estado ya descargado y su instantánea
  // escrita, así que sólo hay que adoptarlo y arrancar la sincronización.
  function onRemoteBoardOpened() {
    resetStore();
    initStore();
    resetFilters();
    refreshAll();
    closeBoardSelector();
    activateSync();
  }

  function activateSync() {
    refreshSyncStatus();
    syncNow();
  }

  initBoardSelector(onBoardSelected);
  initServers(onRemoteBoardOpened, renderBoardList);
  onSyncStatus(renderSyncBadge);
  initBlockedModal(refreshAll);

  // Otra pestaña del mismo navegador puede estar en este mismo tablero. Si lo
  // modifica, releemos en vez de seguir sobre una copia vieja (que al
  // sincronizar mandaría borrados de lo que la otra acaba de crear).
  window.addEventListener("storage", function (ev) {
    const slug = getStateSlug();
    if (!slug || !ev.key || ev.key !== getBoardKey(slug)) return;
    if (reloadFromStorage()) {
      refreshAll();
      refreshSyncStatus();
    }
  });
  setSaveHook(scheduleSync);
  initSync(refreshAll);
  // Sesiones caducadas por reloj mientras la app estaba cerrada: sus tableros
  // pasan a locales ya, sin esperar a que falle una petición.
  expireStaleSessions();
  initColumnsModal(refreshAll);
  initConflictsModal();
  initHeader(refreshAll);
  initFrentesModal(refreshAll);
  initDataModals(refreshAll);
  initTemplatesModal(refreshAll);
  initHotkeys(refreshAll);
  initPaste(refreshAll);
  initBitacora();
  initMetrics();
  initTrash(refreshAll);
  initCardDetail();
  initHeadMenu();
  initSearch(render);

  // Botón "⊞ Tableros" (id=resetBtn) — abre el selector
  const boardsBtn = document.getElementById("resetBtn");
  if (boardsBtn) {
    boardsBtn.addEventListener("click", openBoardSelector);
  }

  if (getActiveSlug()) {
    initStore();
    renderHeader();
    buildFilters(render, openCfg);
    render();
    updateBitacoraButton();
    updateTrashButton();
    // El arranque nunca espera a la red: se pinta primero y se sincroniza después.
    refreshSyncStatus();
    syncNow();
  } else {
    // Sin tablero activo: mostrar tablero vacío + modal selector
    openBoardSelector();
  }
}

// Auto-arranque
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
