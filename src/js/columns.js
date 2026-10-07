// Modal de columnas del tablero: nombre, posición y color.
//
// Las claves y la etapa de flujo de cada columna son fijas (de ellas dependen
// las tarjetas y las métricas); lo que cada tablero decide es cómo se llaman,
// en qué orden aparecen de izquierda a derecha y de qué color se pintan. Se
// guarda la lista entera en `state.cols`, que viaja al servidor como una sola
// pieza (ver sync.js y server/merge.js).

import { COLS, DEFAULT_COLS, MAX_COL_NAME } from "./config.js";
import { getState, setCols, pushHistory } from "./store.js";
import { denyReadOnly } from "./sync.js";
import { esc } from "./utils.js";

let onChangedCallback = null;

export function initColumnsModal(onChanged) {
  onChangedCallback = onChanged;

  const overlay = document.getElementById("colsOverlay");
  const openBtn = document.getElementById("colsBtn");
  const closeBtn = document.getElementById("colsClose");
  const resetBtn = document.getElementById("colsReset");

  if (openBtn) openBtn.addEventListener("click", openColumns);
  if (closeBtn) closeBtn.addEventListener("click", closeColumns);
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      pushHistory();
      commit(DEFAULT_COLS.map(function (c) { return { key: c.key, name: c.name, color: "" }; }));
      renderColumnsList();
    });
  }
  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeColumns();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) closeColumns();
  });
}

export function openColumns() {
  if (denyReadOnly("No se pueden cambiar las columnas")) return;
  const overlay = document.getElementById("colsOverlay");
  if (!overlay) return;
  renderColumnsList();
  overlay.classList.add("open");
}

export function closeColumns() {
  const overlay = document.getElementById("colsOverlay");
  if (overlay) overlay.classList.remove("open");
}

// Lista actual en el formato que se guarda.
function currentCols() {
  return COLS.map(function (c) { return { key: c.key, name: c.name, color: c.color || "" }; });
}

function commit(cols) {
  setCols(cols);
  if (typeof onChangedCallback === "function") onChangedCallback();
}

// El selector de color sólo admite #rrggbb, y los colores de fábrica son
// variables CSS que cambian con el tema: se resuelven al color pintado.
function resolveHex(cssColor) {
  const probe = document.createElement("span");
  probe.style.color = cssColor;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#8494a8";
  return "#" + m.slice(0, 3).map(function (n) {
    return Number(n).toString(16).padStart(2, "0");
  }).join("");
}

export function renderColumnsList() {
  const list = document.getElementById("colsList");
  if (!list) return;
  const state = getState();
  list.innerHTML = "";

  COLS.forEach(function (col, i) {
    const used = state.cards.filter(function (c) { return c.col === col.key; }).length;
    const def = DEFAULT_COLS.find(function (d) { return d.key === col.key; });
    const row = document.createElement("div");
    row.className = "ws-row col-row";
    row.dataset.col = col.key;
    row.style.setProperty("--wc", col.kc);
    row.innerHTML =
      '<span class="col-pos">' + (i + 1) + '</span>' +
      '<span class="sw"><input type="color" value="' + resolveHex(col.kc) + '" aria-label="Color de ' + esc(col.name) + '"></span>' +
      '<span class="nm"><input type="text" value="' + esc(col.name) + '" maxlength="' + MAX_COL_NAME + '" aria-label="Nombre de la columna" placeholder="' + esc(def ? def.name : col.key) + '"></span>' +
      '<span class="cnt">' + used + ' tarea' + (used === 1 ? "" : "s") + '</span>' +
      '<button class="del col-reset-color" title="Volver al color de fábrica" aria-label="Volver al color de fábrica"' + (col.color ? "" : " disabled") + '>↺</button>' +
      '<button class="del col-move" data-dir="-1" title="Mover a la izquierda" aria-label="Mover a la izquierda"' + (i === 0 ? " disabled" : "") + '>◀</button>' +
      '<button class="del col-move" data-dir="1" title="Mover a la derecha" aria-label="Mover a la derecha"' + (i === COLS.length - 1 ? " disabled" : "") + '>▶</button>';

    const colorInput = row.querySelector('input[type="color"]');
    // Un historial por gesto, no por cada paso del arrastre en el selector.
    colorInput.addEventListener("focus", function () { pushHistory(); });
    colorInput.addEventListener("input", function (ev) {
      const cols = currentCols();
      cols[i].color = ev.target.value;
      row.style.setProperty("--wc", ev.target.value);
      commit(cols);
      row.querySelector(".col-reset-color").disabled = false;
    });

    const nameInput = row.querySelector('input[type="text"]');
    nameInput.addEventListener("focus", function () { pushHistory(); });
    nameInput.addEventListener("input", function (ev) {
      // Vacío no se guarda: una columna sin nombre no se puede leer. Al salir
      // del campo se repone el que tenga.
      if (!ev.target.value.trim()) return;
      const cols = currentCols();
      cols[i].name = ev.target.value;
      commit(cols);
    });
    nameInput.addEventListener("blur", function () {
      if (!nameInput.value.trim()) nameInput.value = COLS[i].name;
    });

    row.querySelector(".col-reset-color").addEventListener("click", function () {
      pushHistory();
      const cols = currentCols();
      cols[i].color = "";
      commit(cols);
      renderColumnsList();
    });

    row.querySelectorAll(".col-move").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const j = i + Number(btn.dataset.dir);
        if (j < 0 || j >= COLS.length) return;
        pushHistory();
        const cols = currentCols();
        const moved = cols.splice(i, 1)[0];
        cols.splice(j, 0, moved);
        commit(cols);
        renderColumnsList();
        const again = list.querySelector('.col-row[data-col="' + moved.key + '"] .col-move[data-dir="' + btn.dataset.dir + '"]');
        if (again && !again.disabled) again.focus();
      });
    });

    list.appendChild(row);
  });
}
