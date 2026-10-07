// Modal de conflictos al reconectar un tablero compartido.
//
// Lo que cambió sólo aquí o sólo en el servidor se combina solo (sync.js).
// Esto es para lo que cambió en los dos lados de forma distinta: la decisión
// es del usuario, elemento por elemento, y no se aplica nada hasta que todos
// tienen una. Cerrar el modal no resuelve: el tablero queda en pausa y el
// indicador de sincronización lo vuelve a abrir.

import { COLS, PRI } from "./config.js";
import { getPendingConflict, onConflict, resolveConflicts } from "./sync.js";
import { getState } from "./store.js";
import { showToast } from "./toast.js";
import { esc } from "./utils.js";

const FIELD_LABELS = {
  t: "Título", d: "Descripción", ws: "Frente", pri: "Prioridad", col: "Columna",
  labels: "Etiquetas", due: "Cierre", cr: "Creada", st: "Inicio", dn: "Terminada", ca: "Movida",
  label: "Nombre", color: "Color",
  eyebrow: "Epígrafe", title: "Título", titleThin: "Complemento", subtitle: "Subtítulo", branch: "Rama",
  cols: "Columnas"
};
// Los sellos de fecha acompañan a la columna: mostrarlos sólo añade ruido.
const HIDDEN = { cr: true, st: true, dn: true, ca: true };
const KIND_LABELS = { card: "Tarjeta", ws: "Frente", meta: "Encabezado", cols: "Columnas" };

let choices = {};

export function initConflictsModal() {
  const overlay = document.getElementById("conflictOverlay");
  const closeBtn = document.getElementById("conflictClose");
  const applyBtn = document.getElementById("conflictApply");

  if (closeBtn) closeBtn.addEventListener("click", closeConflicts);
  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeConflicts();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) closeConflicts();
  });

  const bulk = function (value) {
    const p = getPendingConflict();
    if (!p) return;
    p.conflicts.forEach(function (c) { choices[c.key] = value; });
    renderConflicts();
  };
  const mine = document.getElementById("conflictAllMine");
  const theirs = document.getElementById("conflictAllTheirs");
  if (mine) mine.addEventListener("click", function () { bulk("mine"); });
  if (theirs) theirs.addEventListener("click", function () { bulk("theirs"); });

  if (applyBtn) {
    applyBtn.addEventListener("click", function () {
      const p = getPendingConflict();
      if (!p) { closeConflicts(); return; }
      const faltan = p.conflicts.filter(function (c) { return !choices[c.key]; }).length;
      if (faltan) {
        showToast("Falta decidir " + faltan + (faltan === 1 ? " elemento" : " elementos"), "warn", 4000);
        return;
      }
      resolveConflicts(choices);
      choices = {};
      closeConflicts();
      showToast("Conflictos resueltos · sincronizando", "success", 4000);
    });
  }

  onConflict(function () { openConflicts(); });
}

export function openConflicts() {
  const p = getPendingConflict();
  const overlay = document.getElementById("conflictOverlay");
  if (!p || !overlay) return;
  // Las decisiones de un aviso anterior no valen para otro tablero.
  const vigentes = {};
  p.conflicts.forEach(function (c) { if (choices[c.key]) vigentes[c.key] = choices[c.key]; });
  choices = vigentes;
  renderConflicts();
  overlay.classList.add("open");
}

export function closeConflicts() {
  const overlay = document.getElementById("conflictOverlay");
  if (overlay) overlay.classList.remove("open");
}

function conflictWsName(key) {
  const ws = (getState().ws || []).find(function (w) { return w.key === key; });
  return ws ? ws.label : key;
}

function conflictColName(key) {
  const col = COLS.find(function (c) { return c.key === key; });
  return col ? col.name : key;
}

function show(kind, field, value) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (kind === "card" && field === "ws") return conflictWsName(value);
  if (kind === "card" && field === "col") return conflictColName(value);
  if (kind === "card" && field === "pri") return PRI[value] ? PRI[value].label : value;
  const s = String(value);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

function describeSide(c, side) {
  const v = c[side];
  if (!v) return '<span class="co-field">Eliminado</span>';
  if (c.kind === "cols") {
    return v.map(function (col, i) {
      return '<span class="co-field">' + (i + 1) + '. <span>' + esc(col.name) + '</span>' +
        (col.color ? ' · ' + esc(col.color) : '') + '</span>';
    }).join("");
  }
  const fields = c.fields.filter(function (f) { return !HIDDEN[f]; });
  if (!fields.length) return '<span class="co-field">Fechas de flujo distintas</span>';
  return fields.map(function (f) {
    return '<span class="co-field">' + esc(FIELD_LABELS[f] || f) + ': <span>' +
      esc(show(c.kind, f, v[f])) + '</span></span>';
  }).join("");
}

function renderConflicts() {
  const p = getPendingConflict();
  const list = document.getElementById("conflictList");
  const intro = document.getElementById("conflictIntro");
  if (!p || !list) return;

  if (intro) {
    intro.textContent = "Mientras estabas desconectado, " +
      (p.conflicts.length === 1 ? "un elemento cambió" : p.conflicts.length + " elementos cambiaron") +
      " aquí y también en el servidor. Lo demás ya se combinó solo. Elige qué versión se queda en cada caso; " +
      "hasta entonces este tablero no se sincroniza.";
  }

  list.innerHTML = "";
  p.conflicts.forEach(function (c) {
    const item = document.createElement("div");
    item.className = "conflict-item";
    const name = "cf-" + c.key.replace(/[^a-z0-9_-]/gi, "_");
    item.innerHTML =
      '<div class="conflict-head">' + (c.kind === "card" ? '<code>' + esc(c.id) + '</code>' : '') +
        esc(KIND_LABELS[c.kind] || c.kind) + (c.title && c.kind !== "cols" ? ' · ' + esc(c.title) : '') + '</div>' +
      '<div class="conflict-options">' +
        '<label class="conflict-opt"><input type="radio" name="' + name + '" value="mine"' +
          (choices[c.key] === "mine" ? " checked" : "") + '><span class="co-body"><b>Mi versión (este navegador)</b>' +
          describeSide(c, "mine") + '</span></label>' +
        '<label class="conflict-opt"><input type="radio" name="' + name + '" value="theirs"' +
          (choices[c.key] === "theirs" ? " checked" : "") + '><span class="co-body"><b>Versión del servidor</b>' +
          describeSide(c, "theirs") + '</span></label>' +
      '</div>';
    item.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () { choices[c.key] = input.value; });
    });
    list.appendChild(item);
  });
}
