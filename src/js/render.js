import { COLS, PRI } from "./config.js";
import { getState } from "./store.js";
import { isVisible, updateChipCounts, searchQuery } from "./filters.js";
import { updateStats } from "./stats.js";
import { createCardElement, createAddBlock } from "./cards.js";
import { attachColumnDrop } from "./dnd.js";
import { refreshAgingThreshold } from "./metrics.js";
import { esc } from "./utils.js";

export function render() {
  const state = getState();
  const board = document.getElementById("board");
  if (!board) return;

  // El umbral de la Edad del WIP se calcula una vez por pintado: la píldora se
  // decide tarjeta a tarjeta y recalcularlo dentro del bucle recorrería el
  // tablero entero una vez por tarjeta.
  refreshAgingThreshold(state.cards);

  board.innerHTML = "";

  COLS.forEach(function (col) {
    const cards = state.cards.filter(function (c) { return c.col === col.key; });
    const vis = cards.filter(isVisible);

    const colEl = document.createElement("section");
    colEl.className = "col";
    colEl.dataset.col = col.key;
    colEl.style.setProperty("--kc", col.kc);

    const hasWip = Boolean(col.wipLimit && col.wipLimit > 0);
    const isWipExceeded = hasWip && (vis.length > col.wipLimit);
    const countText = hasWip ? `${vis.length}/${col.wipLimit}` : `${vis.length}`;
    const countClass = "count" + (isWipExceeded ? " wip-exceeded" : "");
    const countTitle = isWipExceeded ? `Límite WIP superado (${vis.length}/${col.wipLimit})` : (hasWip ? `Límite WIP: ${col.wipLimit}` : "");

    const head = document.createElement("div");
    head.className = "col-head";
    head.innerHTML = `<span class="name">${esc(col.name)}</span><span class="${countClass}" ${countTitle ? `title="${countTitle}"` : ""}>${countText}</span>`;
    colEl.appendChild(head);

    const body = document.createElement("div");
    body.className = "col-body";

    if (vis.length === 0) {
      const e = document.createElement("div");
      e.className = "col-empty";
      if (searchQuery) {
        e.textContent = "— sin coincidencias —";
      } else {
        e.textContent = cards.length ? "— filtrado —" : "— vacío —";
      }
      body.appendChild(e);
    }

    vis.sort(function (a, b) {
      const rankA = PRI[a.pri] ? PRI[a.pri].rank : 99;
      const rankB = PRI[b.pri] ? PRI[b.pri].rank : 99;
      return rankA - rankB;
    });

    vis.forEach(function (c) {
      body.appendChild(createCardElement(c, render));
    });

    body.appendChild(createAddBlock(col.key, render));
    colEl.appendChild(body);

    attachColumnDrop(colEl, col.key, render);

    board.appendChild(colEl);
  });

  updateStats();
  updateChipCounts();
}
