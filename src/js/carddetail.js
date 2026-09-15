// Ficha de la tarjeta: el modal central con sitio para trabajar.
//
// La tarjeta de la columna es un resumen (id, título, vista previa corta de la
// descripción); al hacer clic se abre esto, que es donde vive todo lo demás:
// etiquetas, fecha de cierre, la descripción con su texto enriquecido y los
// comentarios.
//
// Reglas que conviene no romper:
//
//  1. Nunca se muta el objeto capturado al abrir. Cada guardado busca la
//     tarjeta viva por id: entre abrir la ficha y pulsar
//     algo, el estado puede haber sido reemplazado por un deshacer, una
//     importación o una sincronización.
//  2. Los comentarios son **de sólo añadir**. Es lo que permite fusionarlos
//     por unión de ids en el servidor sin lápidas ni resurrecciones: dos
//     personas comentando la misma tarjeta a la vez conservan los dos
//     comentarios. Si algún día hacen falta borrados, hace falta antes un
//     mecanismo de lápidas como el de las tarjetas.

import { COLS, PRI, MAX_DESC, MAX_LABELS, MAX_LABEL_LEN, MAX_COMMENTS, MAX_COMMENT_LEN } from "./config.js";
import { getState, saveState, wsById, pushHistory, subscribe } from "./store.js";
import { getActiveSlug, getBoardEntry, isRemote } from "./boardselector.js";
import { getServer } from "./remote.js";
import { esc } from "./utils.js";
import { showToast } from "./toast.js";
import { renderRich, createRichToolbar, toggleTask, taskProgress } from "./richtext.js";
import { pushTrash } from "./trash.js";
import { isReadOnlyBoard, denyReadOnly } from "./sync.js";
import { stampMove } from "./metrics.js";

let cdCardId = null;
let cdOnChanged = null;
let cdEditingDesc = false;
let cdSubscribed = false;

export function initCardDetail() {
  const overlay = document.getElementById("cardOverlay");
  if (!overlay) return;

  const close = document.getElementById("cardClose");
  const done = document.getElementById("cdDone");
  if (close) close.addEventListener("click", closeCardDetail);
  if (done) done.addEventListener("click", closeCardDetail);

  overlay.addEventListener("mousedown", function (ev) {
    if (ev.target === overlay) closeCardDetail();
  });

  // En fase de captura a propósito: hotkeys.js también escucha Escape en
  // document y lo primero que hace es quitar el foco del campo. Si llegáramos
  // después, el campo ya estaría sin foco y cerraríamos la ficha mientras el
  // usuario sólo quería salir del cuadro de texto.
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || !isCardDetailOpen()) return;
    // Escape dentro de un campo sólo lo abandona: cerrar la ficha entera
    // mientras se escribe se siente como perder el trabajo.
    const el = document.activeElement;
    if (el && overlay.contains(el) &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) {
      el.blur();
      return;
    }
    closeCardDetail();
  }, true);

  wireCardDetailFields();

  // Un deshacer o una sincronización reemplazan el estado: la ficha abierta
  // tiene que repintarse o mostraría datos que ya no existen.
  if (!cdSubscribed) {
    cdSubscribed = true;
    subscribe(function () {
      if (isCardDetailOpen()) fillCardDetail();
    });
  }
}

export function isCardDetailOpen() {
  const overlay = document.getElementById("cardOverlay");
  return Boolean(overlay && overlay.classList.contains("open"));
}

export function closeCardDetail() {
  const overlay = document.getElementById("cardOverlay");
  if (overlay) overlay.classList.remove("open");
  cdCardId = null;
  cdEditingDesc = false;
}

export function openCardDetail(cardId, onChanged) {
  const overlay = document.getElementById("cardOverlay");
  if (!overlay) return;
  const card = liveCard(cardId);
  if (!card) {
    showToast("Esa tarjeta ya no existe: alguien la eliminó", "warn");
    return;
  }
  cdCardId = cardId;
  cdOnChanged = onChanged;
  cdEditingDesc = false;
  overlay.classList.add("open");
  fillCardDetail();
  const title = document.getElementById("cdTitle");
  if (title) title.focus();
}

function liveCard(id) {
  return getState().cards.find(function (x) { return x.id === id; }) || null;
}

// Todo guardado pasa por aquí: localiza la tarjeta viva, apila el historial y
// persiste. Si la tarjeta desapareció, cierra la ficha en vez de escribir en
// un objeto huérfano.
function editCard(fn) {
  if (denyReadOnly("No se guardó el cambio")) return false;
  const card = liveCard(cdCardId);
  if (!card) {
    showToast("Esa tarjeta ya no existe: alguien la eliminó", "warn");
    closeCardDetail();
    if (typeof cdOnChanged === "function") cdOnChanged();
    return false;
  }
  pushHistory();
  // La columna se lee antes de mutar: el <select> de columna pasa por aquí,
  // así que éste es el único sitio donde hay que sellar el movimiento de la
  // ficha. stampMove no hace nada si la columna no cambió.
  const colAnterior = card.col;
  fn(card);
  stampMove(card, colAnterior);
  saveState();
  if (typeof cdOnChanged === "function") cdOnChanged();
  fillCardDetail();
  return true;
}

// -- Pintado ----------------------------------------------------------------

function fillCardDetail() {
  const card = liveCard(cdCardId);
  if (!card) {
    closeCardDetail();
    return;
  }

  const w = wsById(card.ws);
  const modal = document.querySelector("#cardOverlay .card-modal");
  if (modal) {
    modal.style.setProperty("--wc", w.color);
    modal.style.setProperty("--pc", PRI[card.pri] ? PRI[card.pri].color : "var(--muted)");
  }

  setText("cdId", card.id);
  setValue("cdTitle", card.t);
  fillSelect("cdWs", getState().ws.map(function (x) {
    return { value: x.key, label: x.label };
  }), card.ws);
  fillSelect("cdPri", Object.keys(PRI).map(function (k) {
    return { value: k, label: PRI[k].label };
  }), card.pri);
  fillSelect("cdCol", COLS.map(function (c) {
    return { value: c.key, label: c.name };
  }), card.col);

  setValue("cdDue", card.due || "");
  setText("cdDueHint", dueHint(card.due));
  const dueBox = document.getElementById("cdDueHint");
  if (dueBox) dueBox.className = "cd-due-hint " + dueClass(card.due);

  renderLabels(card);
  renderDesc(card);
  renderComments(card);
  applyReadOnly();
}

// En un tablero de sólo lectura la ficha sigue siendo útil —es donde se lee la
// descripción entera, las etiquetas y los comentarios—, así que no se esconde:
// se bloquea. Los campos quedan inertes y desaparece todo lo que escribiría.
function applyReadOnly() {
  const ro = isReadOnlyBoard();

  // Inertes: se leen, no se cambian.
  ["cdTitle", "cdWs", "cdPri", "cdCol", "cdDue"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.disabled = ro;
  });

  // Fuera de la vista: no hay nada que hacer con ellos sin permiso.
  ["cdDescEdit", "cdDelete", "cdLabelInput"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.hidden = ro;
  });
  document.querySelectorAll("#cdLabels .cd-label-del").forEach(function (b) { b.hidden = ro; });
  document.querySelectorAll("#cdDesc .rt-check").forEach(function (b) { b.disabled = ro; });

  const nuevo = document.querySelector("#cardOverlay .cd-comment-new");
  if (nuevo) nuevo.hidden = ro;

  const aviso = document.getElementById("cdReadOnly");
  if (aviso) aviso.hidden = !ro;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  // No se pisa lo que el usuario está escribiendo ahora mismo.
  if (el && document.activeElement !== el) el.value = value || "";
}

function fillSelect(id, options, selected) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = options.map(function (o) {
    return '<option value="' + esc(o.value) + '"' +
      (o.value === selected ? " selected" : "") + ">" + esc(o.label) + "</option>";
  }).join("");
  el.value = selected || "";
}

// -- Etiquetas --------------------------------------------------------------

export function normalizeLabel(raw) {
  return String(raw || "")
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\u00C0-\u00FF.\-/]/g, "")
    .slice(0, MAX_LABEL_LEN)
    .toLowerCase();
}

function renderLabels(card) {
  const box = document.getElementById("cdLabels");
  if (!box) return;
  const labels = Array.isArray(card.labels) ? card.labels : [];
  box.innerHTML = "";

  if (!labels.length) {
    const empty = document.createElement("span");
    empty.className = "cd-empty";
    empty.textContent = "Sin etiquetas";
    box.appendChild(empty);
  }

  labels.forEach(function (label) {
    const chip = document.createElement("span");
    chip.className = "cd-label";
    chip.innerHTML = '<span class="cd-label-txt">#' + esc(label) + "</span>";
    const del = document.createElement("button");
    del.className = "cd-label-del";
    del.type = "button";
    del.title = "Quitar la etiqueta";
    del.setAttribute("aria-label", "Quitar la etiqueta " + label);
    del.textContent = "✕";
    del.addEventListener("click", function () {
      editCard(function (live) {
        live.labels = (live.labels || []).filter(function (l) { return l !== label; });
      });
    });
    chip.appendChild(del);
    box.appendChild(chip);
  });

  const input = document.getElementById("cdLabelInput");
  if (input && !input.dataset.wired) {
    input.dataset.wired = "1";
    input.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== ",") return;
      ev.preventDefault();
      addLabel(input);
    });
    input.addEventListener("blur", function () { addLabel(input); });
  }
}

function addLabel(input) {
  if (isReadOnlyBoard()) { input.value = ""; return; }
  const label = normalizeLabel(input.value);
  input.value = "";
  if (!label) return;
  const card = liveCard(cdCardId);
  if (!card) return;
  const labels = Array.isArray(card.labels) ? card.labels : [];
  if (labels.indexOf(label) >= 0) return;
  if (labels.length >= MAX_LABELS) {
    showToast("Máximo " + MAX_LABELS + " etiquetas por tarjeta", "warn");
    return;
  }
  editCard(function (live) {
    live.labels = (Array.isArray(live.labels) ? live.labels : []).concat([label]);
  });
}

// -- Fecha de cierre --------------------------------------------------------

// Días entre hoy y la fecha, contando por día natural: comparar marcas de
// tiempo daría "vencida" a una tarjeta que cierra hoy más tarde.
export function daysUntil(due, today) {
  if (!due) return null;
  const parts = String(due).split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const now = today || new Date();
  const base = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - base) / 86400000);
}

export function dueHint(due) {
  const d = daysUntil(due);
  if (d === null) return "";
  if (d === 0) return "Cierra hoy";
  if (d === 1) return "Cierra mañana";
  if (d < 0) return "Vencida hace " + Math.abs(d) + (Math.abs(d) === 1 ? " día" : " días");
  return "Faltan " + d + (d === 1 ? " día" : " días");
}

// Fecha corta para las píldoras de la tarjeta: "12 sep".
export function formatDueShort(due) {
  if (!due) return "";
  const parts = String(due).split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return String(due);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return parts[2] + " " + (meses[parts[1] - 1] || "");
}

export function dueClass(due) {
  const d = daysUntil(due);
  if (d === null) return "";
  if (d < 0) return "cd-due-late";
  if (d <= 2) return "cd-due-soon";
  return "";
}

// -- Descripción ------------------------------------------------------------

function renderDesc(card) {
  const view = document.getElementById("cdDesc");
  const editor = document.getElementById("cdDescEditor");
  const editBtn = document.getElementById("cdDescEdit");
  if (!view || !editor) return;

  editor.hidden = !cdEditingDesc;
  view.hidden = cdEditingDesc;
  if (editBtn) editBtn.hidden = cdEditingDesc;

  if (cdEditingDesc) {
    if (!editor.dataset.built) buildDescEditor(editor);
    const ta = editor.querySelector(".cd-desc-input");
    if (ta && document.activeElement !== ta) {
      ta.value = card.d || "";
      ta.focus();
    }
    return;
  }

  const prog = taskProgress(card.d);
  view.innerHTML = card.d
    ? renderRich(card.d)
    : '<span class="cd-empty">' + (isReadOnlyBoard()
        ? "Esta tarjeta no tiene descripción."
        : "Sin descripción todavía. Pulsa ✎ Editar para escribirla.") + '</span>';

  const progBox = document.getElementById("cdProgress");
  if (progBox) {
    progBox.hidden = !prog.total;
    progBox.textContent = prog.total ? "☑ " + prog.done + "/" + prog.total : "";
    progBox.classList.toggle("rt-prog-full", prog.total > 0 && prog.done === prog.total);
  }

  view.querySelectorAll(".rt-check").forEach(function (box) {
    box.addEventListener("change", function () {
      const live = liveCard(cdCardId);
      const next = live ? toggleTask(live.d, parseInt(box.dataset.line, 10)) : null;
      if (next === null) {
        box.checked = !box.checked;
        showToast("Esa subtarea ya no existe: la descripción cambió", "warn");
        return;
      }
      editCard(function (c) { c.d = next; });
    });
  });

  if (editBtn && !editBtn.dataset.wired) {
    editBtn.dataset.wired = "1";
    editBtn.addEventListener("click", function () {
      if (denyReadOnly("No se puede editar la descripción")) return;
      cdEditingDesc = true;
      fillCardDetail();
    });
  }
}

function buildDescEditor(editor) {
  editor.dataset.built = "1";
  const ta = document.createElement("textarea");
  ta.className = "ff-in cd-desc-input";
  ta.maxLength = MAX_DESC;
  ta.rows = 10;

  const actions = document.createElement("div");
  actions.className = "add-actions cd-desc-actions";
  const save = document.createElement("button");
  save.className = "btn primary wide";
  save.textContent = "Guardar descripción";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancelar";
  actions.appendChild(save);
  actions.appendChild(cancel);

  editor.appendChild(createRichToolbar(ta));
  editor.appendChild(ta);
  editor.appendChild(actions);

  save.addEventListener("click", function () {
    const value = ta.value;
    cdEditingDesc = false;
    editCard(function (live) { live.d = value; });
  });
  cancel.addEventListener("click", function () {
    cdEditingDesc = false;
    fillCardDetail();
  });
}

// -- Comentarios ------------------------------------------------------------

// Quién firma. En un tablero compartido, el usuario con el que se entró al
// servidor; en uno local no hay identidades, así que "yo".
export function commentAuthor() {
  const entry = getBoardEntry(getActiveSlug());
  if (isRemote(entry)) {
    const server = getServer(entry.remote.serverId);
    if (server && server.username) return server.username;
  }
  return "yo";
}

// Único entre clientes sin coordinación, igual que los ids de tarjeta en un
// tablero compartido.
function newCommentId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function renderComments(card) {
  const list = document.getElementById("cdComments");
  if (!list) return;
  const comments = Array.isArray(card.comments) ? card.comments : [];

  setText("cdCommentCount", comments.length ? String(comments.length) : "");

  list.innerHTML = "";
  if (!comments.length) {
    list.innerHTML = '<p class="cd-empty">Todavía nadie ha comentado esta tarjeta.</p>';
  }

  comments.forEach(function (c) {
    const box = document.createElement("div");
    box.className = "cd-comment";
    box.innerHTML =
      '<div class="cd-comment-head">' +
        '<span class="cd-comment-by">' + esc(c.by || "alguien") + "</span>" +
        '<span class="cd-comment-at">' + esc(formatCommentDate(c.at)) + "</span>" +
      "</div>" +
      '<div class="cd-comment-body rich">' + renderRich(c.text || "") + "</div>";
    list.appendChild(box);
  });
  list.scrollTop = list.scrollHeight;

  const input = document.getElementById("cdCommentText");
  const add = document.getElementById("cdCommentAdd");
  if (add && !add.dataset.wired) {
    add.dataset.wired = "1";
    add.addEventListener("click", function () { addComment(input); });
  }
  if (input && !input.dataset.wired) {
    input.dataset.wired = "1";
    input.maxLength = MAX_COMMENT_LEN;
    input.addEventListener("keydown", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        addComment(input);
      }
    });
  }
}

function addComment(input) {
  if (!input) return;
  if (denyReadOnly("No se publicó el comentario")) return;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const card = liveCard(cdCardId);
  if (card && (card.comments || []).length >= MAX_COMMENTS) {
    showToast("Esta tarjeta ya tiene " + MAX_COMMENTS + " comentarios", "warn");
    return;
  }
  const nuevo = {
    id: newCommentId(),
    at: new Date().toISOString(),
    by: commentAuthor(),
    text: text.slice(0, MAX_COMMENT_LEN)
  };
  input.value = "";
  editCard(function (live) {
    live.comments = (Array.isArray(live.comments) ? live.comments : []).concat([nuevo]);
  });
}

export function formatCommentDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "hace un momento";
  if (diff < 3600000) return "hace " + Math.floor(diff / 60000) + " min";
  if (diff < 86400000) return "hace " + Math.floor(diff / 3600000) + " h";
  return d.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// -- Cableado de los campos de la cabecera y el pie -------------------------

export function wireCardDetailFields() {
  const title = document.getElementById("cdTitle");
  if (title && !title.dataset.wired) {
    title.dataset.wired = "1";
    const commit = function () {
      const value = title.value.trim();
      const card = liveCard(cdCardId);
      if (!card) return;
      if (!value) {
        title.value = card.t;
        return;
      }
      if (value === card.t) return;
      editCard(function (live) { live.t = value; });
    };
    title.addEventListener("blur", commit);
    title.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        title.blur();
      }
    });
  }

  wireSelect("cdWs", function (live, value) { live.ws = value; });
  wireSelect("cdPri", function (live, value) { live.pri = value; });
  wireSelect("cdCol", function (live, value) { live.col = value; });

  const due = document.getElementById("cdDue");
  if (due && !due.dataset.wired) {
    due.dataset.wired = "1";
    due.addEventListener("change", function () {
      const value = due.value || "";
      editCard(function (live) { live.due = value; });
    });
  }

  const del = document.getElementById("cdDelete");
  if (del && !del.dataset.wired) {
    del.dataset.wired = "1";
    let armed = false;
    del.addEventListener("click", function () {
      if (denyReadOnly("No se eliminó la tarjeta")) return;
      if (!armed) {
        armed = true;
        del.classList.add("armed");
        del.textContent = "¿Eliminar la tarjeta?";
        return;
      }
      armed = false;
      del.classList.remove("armed");
      del.textContent = "🗑 Eliminar";
      const card = liveCard(cdCardId);
      if (!card) {
        closeCardDetail();
        return;
      }
      pushHistory();
      pushTrash("card", card);
      const state = getState();
      state.cards = state.cards.filter(function (x) { return x.id !== card.id; });
      saveState();
      showToast("Tarjeta eliminada · recupérala en 🗑 Papelera", "info", 5000);
      closeCardDetail();
      if (typeof cdOnChanged === "function") cdOnChanged();
    });
  }
}

function wireSelect(id, apply) {
  const el = document.getElementById(id);
  if (!el || el.dataset.wired) return;
  el.dataset.wired = "1";
  el.addEventListener("change", function () {
    const value = el.value;
    editCard(function (live) { apply(live, value); });
  });
}
