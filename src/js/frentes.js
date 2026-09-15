import { PALETTE } from "./config.js";
import { getState, saveState, pushHistory } from "./store.js";
import { filterWS, syncFilters } from "./filters.js";
import { esc } from "./utils.js";
import { pushTrash } from "./trash.js";
import { showToast } from "./toast.js";
import { denyReadOnly } from "./sync.js";

let onFrentesChangedCallback = null;
let newWsColor = PALETTE[6];

export function initFrentesModal(onChanged) {
  onFrentesChangedCallback = onChanged;

  const overlay = document.getElementById("cfgOverlay");
  const cfgBtn = document.getElementById("cfgBtn");
  const cfgClose = document.getElementById("cfgClose");

  if (cfgBtn) cfgBtn.addEventListener("click", openCfg);
  if (cfgClose) cfgClose.addEventListener("click", closeCfg);

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeCfg();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeCfg();
    }
  });

  // Swatches para nuevo frente
  const box = document.getElementById("newWsSwatches");
  const colorInput = document.getElementById("newWsColor");
  if (box && colorInput) {
    box.innerHTML = "";
    PALETTE.forEach(function (hex, i) {
      const b = document.createElement("button");
      b.style.background = hex;
      b.setAttribute("aria-pressed", i === 6 ? "true" : "false");
      b.addEventListener("click", function () {
        newWsColor = hex;
        colorInput.value = hex;
        box.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      });
      box.appendChild(b);
    });
    newWsColor = PALETTE[6];
    colorInput.value = PALETTE[6];
    colorInput.addEventListener("input", function () {
      newWsColor = colorInput.value;
      box.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
    });
  }

  const addBtn = document.getElementById("newWsAdd");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      const input = document.getElementById("newWsName");
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      pushHistory();
      const key = makeKey(name);
      getState().ws.push({ key: key, label: name, color: newWsColor });
      filterWS[key] = true;
      input.value = "";
      saveState();
      renderWsList();
    });
  }
}

export function openCfg() {
  // El modal de frentes es todo escritura: crear, renombrar, recolorear y
  // eliminar. Sin permiso de edición no se abre.
  if (denyReadOnly("No se pueden administrar los frentes")) return;
  const overlay = document.getElementById("cfgOverlay");
  if (overlay) {
    renderWsList();
    overlay.classList.add("open");
  }
}

export function closeCfg() {
  const overlay = document.getElementById("cfgOverlay");
  if (overlay) {
    overlay.classList.remove("open");
    if (typeof onFrentesChangedCallback === "function") {
      onFrentesChangedCallback();
    }
  }
}

export function renderWsList() {
  const state = getState();
  const list = document.getElementById("wsList");
  if (!list) return;
  list.innerHTML = "";

  state.ws.forEach(function (w) {
    const used = state.cards.filter(function (c) { return c.ws === w.key; }).length;
    const row = document.createElement("div");
    row.className = "ws-row";
    row.style.setProperty("--wc", w.color);
    row.innerHTML =
      '<span class="sw"><input type="color" value="' + esc(w.color) + '" aria-label="Color de ' + esc(w.label) + '"></span>' +
      '<span class="key">' + esc(w.key) + '</span>' +
      '<span class="nm"><input type="text" value="' + esc(w.label) + '" maxlength="26" aria-label="Nombre del frente"></span>' +
      '<span class="cnt">' + used + ' tarea' + (used === 1 ? "" : "s") + '</span>' +
      '<button class="del" title="Eliminar frente" aria-label="Eliminar frente"' + (state.ws.length <= 1 ? ' disabled' : '') + '>🗑</button>';

    // Igual que en las tarjetas: se localiza el frente vivo por clave en vez de
    // mutar el objeto capturado al renderizar la fila.
    const liveWs = function () {
      return getState().ws.find(function (x) { return x.key === w.key; });
    };

    row.querySelector('input[type="color"]').addEventListener("input", function (ev) {
      const live = liveWs();
      if (!live) return;
      live.color = ev.target.value;
      row.style.setProperty("--wc", live.color);
      saveState();
    });

    row.querySelector('input[type="text"]').addEventListener("input", function (ev) {
      const live = liveWs();
      if (!live) return;
      live.label = ev.target.value;
      saveState();
    });

    row.querySelector(".del").addEventListener("click", function () {
      if (used > 0) {
        promptReassign(w, list);
      } else {
        removeWs(w.key, null);
        renderWsList();
      }
    });

    list.appendChild(row);
  });
}

function promptReassign(w, list) {
  const state = getState();
  const others = state.ws.filter(function (x) { return x.key !== w.key; });
  const bar = document.createElement("div");
  bar.className = "ws-reassign";
  bar.innerHTML =
    '<span>Mover sus tareas a:</span>' +
    '<select class="ff-in">' + others.map(function (o) { return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>'; }).join("") + '</select>' +
    '<button class="btn danger" style="justify-content:center;">Eliminar frente</button>' +
    '<button class="btn" style="justify-content:center;">Cancelar</button>';

  const btns = bar.querySelectorAll("button");
  btns[0].addEventListener("click", function () {
    removeWs(w.key, bar.querySelector("select").value);
    renderWsList();
  });
  btns[1].addEventListener("click", renderWsList);
  list.appendChild(bar);
  bar.scrollIntoView({ block: "nearest" });
}

function removeWs(key, reassignTo) {
  pushHistory();
  const state = getState();
  const ws = state.ws.find(function (w) { return w.key === key; });

  // Qué tarjetas se reasignan se apunta ANTES de moverlas: es lo único que
  // permite devolverlas a su frente si se restaura desde la papelera.
  const afectadas = state.cards
    .filter(function (c) { return c.ws === key; })
    .map(function (c) { return c.id; });

  if (reassignTo) {
    state.cards.forEach(function (c) {
      if (c.ws === key) c.ws = reassignTo;
    });
  }
  if (ws) {
    pushTrash("ws", ws, { cards: afectadas, reassignedTo: reassignTo || null });
  }
  state.ws = state.ws.filter(function (w) { return w.key !== key; });
  delete filterWS[key];
  syncFilters();
  saveState();
  showToast("Frente eliminado · recupéralo en 🗑 Papelera", "info", 5000);
}

function makeKey(name) {
  const state = getState();
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "FR";
  let key = base;
  let i = 2;
  const exists = function (k) { return state.ws.some(function (w) { return w.key === k; }); };
  while (exists(key)) {
    key = base + i;
    i++;
  }
  return key;
}
