// Pegar tarjetas desde el portapapeles.
//
// Dos formas de escribir una línea, y el analizador decide solo cuál es:
//
//   1. Texto suelto — "Comprar materiales". La fuente habitual no es un JSON
//      limpio sino una lista de WhatsApp, Notepad o un correo, así que se
//      quitan viñetas, numeración y las marcas de hora y autor del chat.
//   2. Formato completo — "ID | WS | prioridad | col | Título | Descripción".
//      Sirve para volcar un tablero entero (o el histórico de un proyecto)
//      conservando identificadores, frentes, prioridades y columnas.
//
// Nada se importa sin que el usuario vea antes qué va a entrar y pueda
// desmarcar lo que no quiera: pegar es fácil de hacer sin querer.

import { PRI, COLS, PALETTE, MAX_DESC } from "./config.js";
import { getState, saveState, nextId, pushHistory, getStateSlug } from "./store.js";
import { getActiveSlug } from "./boardselector.js";
import { showToast } from "./toast.js";
import { esc } from "./utils.js";
import { denyReadOnly } from "./sync.js";
import { stampNew } from "./metrics.js";

const DEFAULT_COL = "backlog";
const MAX_PASTE_LINES = 400;

let onPasteImported = null;

// "[12/03/2025, 10:22] Víctor: revisar informe" -> "revisar informe"
const WHATSAPP_PREFIX = /^\[?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\s*\]?\s*(?:[^:]{1,40}:\s*)?/i;
// Viñetas y numeración: "- ", "• ", "* ", "1. ", "1) ", "[ ] ", "[x] "
const BULLET_PREFIX = /^\s*(?:[-*•·–—]|\d{1,3}[.)]|\[[ xX]?\])\s+/;
// Líneas de comentario del propio formato: "# Formato por línea: ..."
const COMMENT_LINE = /^\s*(?:#|\/\/)/;

// El nombre de la columna también se acepta escrito ("Por hacer", "Hecho"),
// que es como sale de un tablero leído por una persona.
const COL_ALIASES = {};
COLS.forEach(function (c) {
  COL_ALIASES[c.key.toLowerCase()] = c.key;
  COL_ALIASES[c.name.toLowerCase()] = c.key;
});
COL_ALIASES["doing"] = "inprogress";
COL_ALIASES["in progress"] = "inprogress";
COL_ALIASES["todo"] = "todo";

const PRI_ALIASES = {};
Object.keys(PRI).forEach(function (k) {
  PRI_ALIASES[k] = k;
  PRI_ALIASES[PRI[k].label.toLowerCase()] = k;
});

// Sin tildes y en minúsculas: "Crítica" y "critica" son la misma prioridad.
function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function asPriority(value) {
  return PRI_ALIASES[normalizeText(value)] || null;
}

function asColumn(value) {
  return COL_ALIASES[normalizeText(value)] || null;
}

// Formato completo: ID | WS | prioridad | col | Título | Descripción
//
// Se reconoce por la forma, no por una cabecera: los campos 3 y 4 tienen que
// ser una prioridad y una columna válidas. Así una línea suelta que casualmente
// lleve barras verticales ("Llamar al proveedor | antes del viernes") sigue
// tratándose como título y descripción.
function parseFullFormat(line) {
  const parts = line.split("|").map(function (p) { return p.trim(); });
  if (parts.length < 5) return null;

  const pri = asPriority(parts[2]);
  const col = asColumn(parts[3]);
  if (!pri || !col) return null;

  const id = parts[0].slice(0, 80);
  const title = parts[4];
  if (!id || !title) return null;

  return {
    id: id,
    ws: parts[1].slice(0, 40),
    pri: pri,
    col: col,
    t: title.slice(0, 90),
    // La descripción puede llevar barras verticales; se recompone tal cual.
    d: parts.slice(5).join(" | ").slice(0, MAX_DESC)
  };
}

export function parsePastedText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const items = [];

  for (const raw of lines) {
    if (COMMENT_LINE.test(raw)) continue;

    const full = parseFullFormat(raw.trim());
    if (full) {
      items.push(full);
      if (items.length >= MAX_PASTE_LINES) break;
      continue;
    }

    let line = raw.replace(WHATSAPP_PREFIX, "").replace(BULLET_PREFIX, "").trim();
    if (!line) continue;

    // Separadores opcionales de título y descripción: tabulador o " | ".
    let title = line;
    let desc = "";
    const split = line.split(/\t| \| /);
    if (split.length > 1) {
      title = split[0].trim();
      desc = split.slice(1).join(" ").trim();
    }
    if (!title) continue;

    items.push({ id: "", ws: "", pri: "", col: "", t: title.slice(0, 90), d: desc.slice(0, MAX_DESC) });
    if (items.length >= MAX_PASTE_LINES) break;
  }
  return items;
}

export function initPaste(onImported) {
  onPasteImported = onImported;

  const overlay = document.getElementById("pasteOverlay");
  const closeBtn = document.getElementById("pasteClose");
  const cancelBtn = document.getElementById("pasteCancel");
  const importBtn = document.getElementById("pasteImport");
  const allBtn = document.getElementById("pasteSelectAll");
  const noneBtn = document.getElementById("pasteSelectNone");
  const pasteBtn = document.getElementById("pasteBtn");

  if (closeBtn) closeBtn.addEventListener("click", closePaste);
  if (cancelBtn) cancelBtn.addEventListener("click", closePaste);
  if (importBtn) importBtn.addEventListener("click", importSelected);
  if (allBtn) allBtn.addEventListener("click", function () { setAllChecked(true); });
  if (noneBtn) noneBtn.addEventListener("click", function () { setAllChecked(false); });
  if (pasteBtn) pasteBtn.addEventListener("click", function () { pasteFromClipboard(); });

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closePaste();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) closePaste();
  });

  // Ctrl/Cmd+V sobre el tablero: el navegador nos entrega el texto sin pedir
  // permisos, que es la vía más fiable. El modal se abre con la vista previa.
  document.addEventListener("paste", function (ev) {
    if (isTypingSomewhere()) return;
    const text = ev.clipboardData ? ev.clipboardData.getData("text/plain") : "";
    if (!text || !text.trim()) return;
    ev.preventDefault();
    openPaste(text);
  });
}

function isTypingSomewhere() {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ||
                        el.tagName === "SELECT" || el.isContentEditable));
}

// Vía del atajo «V» y del botón: aquí sí hay que pedir el portapapeles. Si el
// navegador lo deniega (o estamos en file://), se abre el modal vacío para
// pegar a mano en el área de texto.
export async function pasteFromClipboard() {
  if (denyReadOnly("No se pegaron tarjetas")) return;
  let text = "";
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (e) {
    text = "";
  }
  openPaste(text);
  if (!text) {
    const box = document.getElementById("pasteRaw");
    if (box) box.focus();
  }
}

export function openPaste(text) {
  if (denyReadOnly("No se pegaron tarjetas")) return;
  const overlay = document.getElementById("pasteOverlay");
  if (!overlay) return;

  // Sin tablero abierto no hay dónde guardar: saveState() no escribiría nada y
  // las tarjetas se perderían en silencio.
  if (!getStateSlug() && !getActiveSlug()) {
    showToast("Abre o crea un tablero antes de pegar tarjetas", "warn");
    return;
  }

  const raw = document.getElementById("pasteRaw");
  if (raw) {
    raw.value = text || "";
    raw.oninput = function () { renderPreview(parsePastedText(raw.value)); };
  }
  fillDefaultSelects();
  setPasteMsg("");
  renderPreview(parsePastedText(text));
  overlay.classList.add("open");
}

export function closePaste() {
  const overlay = document.getElementById("pasteOverlay");
  if (overlay) overlay.classList.remove("open");
}

// -- Selectores -------------------------------------------------------------

// Los frentes que trae el texto pegado y no existen en el tablero se ofrecen
// igualmente: al importar se crean. Sin esto, volcar un tablero ajeno perdería
// su organización por frentes y todo caería en el primero de la lista.
function wsOptionsHtml(extraKeys) {
  const existing = getState().ws.map(function (w) {
    return '<option value="' + esc(w.key) + '">' + esc(w.label) + '</option>';
  });
  const nuevos = (extraKeys || []).map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(k) + ' (nuevo)</option>';
  });
  return existing.concat(nuevos).join("");
}

function priOptionsHtml() {
  return Object.keys(PRI).map(function (k) {
    return '<option value="' + k + '">' + esc(PRI[k].label) + '</option>';
  }).join("");
}

function colOptionsHtml() {
  return COLS.map(function (c) {
    return '<option value="' + esc(c.key) + '">' + esc(c.name) + '</option>';
  }).join("");
}

// Los selectores de arriba son el valor común de la tanda: al cambiarlos se
// propagan a las filas, y luego cada tarjeta puede desviarse.
function fillDefaultSelects() {
  const ws = document.getElementById("pasteWs");
  const pri = document.getElementById("pastePri");
  const col = document.getElementById("pasteCol");
  const state = getState();

  if (ws) {
    const previous = ws.value;
    ws.innerHTML = wsOptionsHtml();
    if (previous && state.ws.some(function (w) { return w.key === previous; })) ws.value = previous;
    ws.onchange = function () { applyDefaultToRows(".paste-row-ws", ws.value); };
  }
  if (pri) {
    if (!pri.options.length) {
      pri.innerHTML = priOptionsHtml();
      pri.value = "media";
    }
    pri.onchange = function () { applyDefaultToRows(".paste-row-pri", pri.value); };
  }
  if (col) {
    if (!col.options.length) {
      col.innerHTML = colOptionsHtml();
      col.value = DEFAULT_COL;
    }
    col.onchange = function () { applyDefaultToRows(".paste-row-col", col.value); };
  }
}

function defaultWs() {
  const select = document.getElementById("pasteWs");
  const state = getState();
  if (select && select.value) return select.value;
  return state.ws[0] ? state.ws[0].key : "GEN";
}

function defaultPri() {
  const select = document.getElementById("pastePri");
  return select && select.value ? select.value : "media";
}

function defaultCol() {
  const select = document.getElementById("pasteCol");
  return select && select.value ? select.value : DEFAULT_COL;
}

// Sólo pisa las filas que no traían el dato en el texto pegado: cambiar el
// valor común no debe deshacer lo que el formato completo ya declaraba.
function applyDefaultToRows(selector, value) {
  document.querySelectorAll("#pasteList .paste-row").forEach(function (row) {
    const select = row.querySelector(selector);
    if (!select || select.dataset.explicit === "1") return;
    select.value = value;
  });
}

// -- Vista previa -----------------------------------------------------------

function renderPreview(items) {
  const list = document.getElementById("pasteList");
  if (!list) return;
  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = '<p class="bs-empty">Nada que importar todavía. Pega el texto arriba: ' +
      'una línea por tarjeta.</p>';
    setPasteMsg("");
    updateImportButton();
    return;
  }

  const state = getState();
  const knownWs = new Set(state.ws.map(function (w) { return w.key; }));
  const takenIds = new Set(state.cards.map(function (c) { return c.id; }));
  const nuevosWs = [...new Set(items
    .map(function (i) { return i.ws; })
    .filter(function (k) { return k && !knownWs.has(k); }))];

  const wsHtml = wsOptionsHtml(nuevosWs);
  const priHtml = priOptionsHtml();
  const colHtml = colOptionsHtml();
  const fallbackWs = defaultWs();
  const fallbackPri = defaultPri();
  const fallbackCol = defaultCol();

  items.forEach(function (item) {
    // Un <div>, no un <label>: dentro de una etiqueta, escribir en el título
    // arrastraría la activación al checkbox y desmarcaría la fila al editarla.
    const row = document.createElement("div");
    row.className = "paste-row";
    row.dataset.desc = item.d || "";

    const duplicado = Boolean(item.id && takenIds.has(item.id));
    if (duplicado) row.classList.add("paste-dup");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "paste-check";
    // Un ID que ya está en el tablero casi siempre significa que se está
    // pegando otra vez la misma lista. Se ofrece, pero desmarcado: duplicar un
    // histórico entero en silencio es caro de deshacer.
    check.checked = !duplicado;
    check.addEventListener("change", updateImportButton);
    row.appendChild(check);

    if (item.id) {
      const idTag = document.createElement("code");
      idTag.className = "paste-id";
      idTag.textContent = item.id;
      idTag.title = duplicado
        ? "Ese ID ya existe en este tablero; si lo importas se le asignará uno nuevo"
        : "ID que traía la línea pegada";
      // Un ID ocupado no se reutiliza: al importar se genera uno libre.
      row.dataset.id = duplicado ? "" : item.id;
      row.appendChild(idTag);
    }

    const title = document.createElement("input");
    title.type = "text";
    title.className = "ff-in paste-title";
    title.maxLength = 90;
    title.value = item.t;
    row.appendChild(title);

    if (item.d) {
      const desc = document.createElement("span");
      desc.className = "paste-desc";
      desc.textContent = item.d;
      desc.title = item.d;
      row.appendChild(desc);
    }

    // Cada tarjeta lleva su frente, su prioridad y su columna: una lista pegada
    // rara vez es homogénea, y corregirlo después es una edición por tarjeta.
    row.appendChild(buildRowSelect("paste-row-ws", "Frente de esta tarjeta",
      wsHtml, item.ws || fallbackWs, Boolean(item.ws)));
    row.appendChild(buildRowSelect("paste-row-pri", "Prioridad de esta tarjeta",
      priHtml, item.pri || fallbackPri, Boolean(item.pri)));
    row.appendChild(buildRowSelect("paste-row-col", "Columna de destino",
      colHtml, item.col || fallbackCol, Boolean(item.col)));

    // Pulsar en cualquier hueco de la fila marca o desmarca; sobre el título o
    // los selectores, no: ahí el usuario está afinando la tarjeta.
    row.addEventListener("click", function (ev) {
      if (ev.target.closest("input, select")) return;
      check.checked = !check.checked;
      updateImportButton();
    });

    list.appendChild(row);
  });

  const dup = list.querySelectorAll(".paste-dup").length;
  setPasteMsg(dup
    ? dup + (dup === 1
        ? " línea trae un ID que ya existe en el tablero y llega desmarcada."
        : " líneas traen IDs que ya existen en el tablero y llegan desmarcadas.")
    : "");
  updateImportButton();
}

function buildRowSelect(className, title, optionsHtml, value, explicit) {
  const select = document.createElement("select");
  select.className = "ff-in " + className;
  select.title = title;
  select.innerHTML = optionsHtml;
  select.value = value;
  // Si el texto pegado traía el dato, el selector común ya no lo pisa.
  if (explicit && select.value === value) select.dataset.explicit = "1";
  return select;
}

function setAllChecked(value) {
  document.querySelectorAll("#pasteList .paste-check").forEach(function (c) { c.checked = value; });
  updateImportButton();
}

function selectedRows() {
  const rows = [];
  document.querySelectorAll("#pasteList .paste-row").forEach(function (row) {
    const check = row.querySelector(".paste-check");
    const title = row.querySelector(".paste-title");
    const ws = row.querySelector(".paste-row-ws");
    const pri = row.querySelector(".paste-row-pri");
    const col = row.querySelector(".paste-row-col");
    if (!check || !check.checked) return;
    const t = title ? title.value.trim() : "";
    if (!t) return;
    rows.push({
      id: row.dataset.id || "",
      t: t,
      d: row.dataset.desc || "",
      ws: ws && ws.value ? ws.value : defaultWs(),
      pri: pri && pri.value ? pri.value : defaultPri(),
      col: col && col.value ? col.value : defaultCol()
    });
  });
  return rows;
}

function updateImportButton() {
  const btn = document.getElementById("pasteImport");
  if (!btn) return;
  const n = selectedRows().length;
  btn.disabled = n === 0;
  btn.textContent = n ? "Importar " + n + " tarjeta" + (n === 1 ? "" : "s") : "Importar";
}

function setPasteMsg(text, isError) {
  const el = document.getElementById("pasteMsg");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("err", Boolean(isError));
}

// -- Importación ------------------------------------------------------------

function importSelected() {
  const rows = selectedRows();
  if (!rows.length) {
    setPasteMsg("Marca al menos una tarjeta.", true);
    return;
  }

  pushHistory();
  const creados = createMissingWs(rows);

  // El estado vigente se pide dentro del bucle: nextId() cuenta sobre lo que ya
  // hay, así que cada tarjeta debe estar puesta antes de generar la siguiente.
  for (const row of rows) {
    const state = getState();
    const libre = row.id && !state.cards.some(function (c) { return c.id === row.id; });
    state.cards.push(stampNew({
      id: libre ? row.id : nextId(row.ws),
      ws: row.ws,
      pri: row.pri,
      col: row.col,
      t: row.t,
      d: row.d
    }));
  }
  saveState();

  closePaste();
  const plural = rows.length === 1 ? "" : "s";
  const frentes = creados.length
    ? " · " + creados.length + " frente" + (creados.length === 1 ? "" : "s") +
      " nuevo" + (creados.length === 1 ? "" : "s") + ": " + creados.join(", ")
    : "";
  showToast(rows.length + " tarjeta" + plural + " añadida" + plural + frentes,
            "success", creados.length ? 6000 : 3000);
  if (typeof onPasteImported === "function") onPasteImported();
}

// Los frentes que el texto pegado traía y el tablero no tenía se crean con un
// color de la paleta, en orden, para que no salgan todos iguales.
function createMissingWs(rows) {
  const state = getState();
  const known = new Set(state.ws.map(function (w) { return w.key; }));
  const creados = [];

  for (const row of rows) {
    if (!row.ws || known.has(row.ws)) continue;
    known.add(row.ws);
    state.ws.push({
      key: row.ws,
      label: row.ws,
      color: PALETTE[(state.ws.length + creados.length) % PALETTE.length]
    });
    creados.push(row.ws);
  }
  return creados;
}
