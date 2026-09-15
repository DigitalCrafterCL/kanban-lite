import { getState, saveState, pushHistory } from "./store.js";
import { isReadOnlyBoard, denyReadOnly } from "./sync.js";
import { stampMove } from "./metrics.js";

export function attachCardDrag(el, cardId) {
  if (isReadOnlyBoard()) {
    el.setAttribute("draggable", "false");
    el.classList.add("card-ro");
    return;
  }
  el.addEventListener("dragstart", function (ev) {
    ev.dataTransfer.setData("text/plain", cardId);
    ev.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", function () {
    el.classList.remove("dragging");
  });
}

export function attachColumnDrop(colEl, colKey, onMove) {
  if (isReadOnlyBoard()) return;
  colEl.addEventListener("dragover", function (ev) {
    ev.preventDefault();
    colEl.classList.add("drop");
  });
  colEl.addEventListener("dragleave", function (ev) {
    if (!colEl.contains(ev.relatedTarget)) {
      colEl.classList.remove("drop");
    }
  });
  colEl.addEventListener("drop", function (ev) {
    ev.preventDefault();
    colEl.classList.remove("drop");
    const id = ev.dataTransfer.getData("text/plain");
    moveCard(id, colKey, onMove);
  });
}

export function moveCard(id, colKey, onMove) {
  if (denyReadOnly("No se movió la tarjeta")) return;
  const state = getState();
  const c = state.cards.find(function (x) { return x.id === id; });
  if (c && c.col !== colKey) {
    pushHistory();
    const anterior = c.col;
    c.col = colKey;
    stampMove(c, anterior);
    saveState();
    if (typeof onMove === "function") {
      onMove();
    }
  }
}
