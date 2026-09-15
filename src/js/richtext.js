// Texto enriquecido mínimo para las descripciones de las tarjetas.
//
// La descripción se sigue guardando como **texto plano** en `card.d`: los
// marcadores son los de Markdown (`**negrita**`, `*cursiva*`, `~~tachado~~`,
// `- viñeta`, `- [ ] subtarea`) y el render los traduce a HTML al pintar. Esto
// no toca el modelo de datos, así que no hace falta migración: un tablero
// exportado sigue siendo legible en cualquier editor de texto y el servidor,
// que sanea cadenas y descarta campos que no conoce, no tiene nada que hacer.
//
// Nunca se inyecta HTML del usuario: primero se escapa todo con esc() y luego
// se aplican los marcadores sobre el texto ya escapado.

import { esc } from "./utils.js";

// `- [ ] texto` / `* [x] texto`. Se acepta con y sin espacio tras el corchete.
const RT_TASK_RE = /^(\s*)[-*]\s*\[([ xX])\]\s?([\s\S]*)$/;
const RT_BULLET_RE = /^(\s*)[-*]\s+([\s\S]*)$/;

export const RT_TASK_PREFIX = "- [ ] ";
export const RT_BULLET_PREFIX = "- ";

// Marcadores inline sobre texto YA escapado.
function rtInline(escaped) {
  return escaped
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1<em>$2</em>");
}

function rtLines(text) {
  return String(text == null ? "" : text).split(/\r?\n/);
}

/**
 * Convierte la descripción en HTML seguro.
 * Cada subtarea lleva `data-line` con su índice de línea en el texto original:
 * es lo que permite marcar la casilla desde la tarjeta sin volver a parsear.
 */
export function renderRich(text) {
  let html = "";
  let openList = null; // "task" | "bullet" | null

  function closeList() {
    if (openList) html += "</ul>";
    openList = null;
  }

  function openAs(kind, cls) {
    if (openList === kind) return;
    closeList();
    html += '<ul class="' + cls + '">';
    openList = kind;
  }

  rtLines(text).forEach(function (line, i) {
    const task = line.match(RT_TASK_RE);
    if (task) {
      openAs("task", "rt-tasks");
      const done = task[2].toLowerCase() === "x";
      html +=
        '<li class="rt-task' + (done ? " rt-done" : "") + '">' +
          '<input type="checkbox" class="rt-check" data-line="' + i + '"' +
            (done ? " checked" : "") + ' aria-label="Subtarea">' +
          '<span class="rt-task-text">' + rtInline(esc(task[3])) + "</span>" +
        "</li>";
      return;
    }

    const bullet = line.match(RT_BULLET_RE);
    if (bullet) {
      openAs("bullet", "rt-list");
      html += '<li class="rt-item">' + rtInline(esc(bullet[2])) + "</li>";
      return;
    }

    closeList();
    if (!line.trim()) {
      html += '<div class="rt-gap"></div>';
      return;
    }
    html += '<p class="rt-p">' + rtInline(esc(line)) + "</p>";
  });

  closeList();
  return html;
}

/**
 * Recorta el texto ORIGEN (no el HTML) para la vista previa de la tarjeta:
 * corta por líneas y por palabras y cierra los marcadores que quedaran a
 * medias, para que un `**` partido no se vea como asteriscos sueltos ni
 * arrastre el formato al resto. Se recorta desde el principio, así que los
 * índices de línea de las subtareas siguen valiendo para marcarlas.
 *
 * @returns {{ text: string, truncated: boolean }}
 */
export function shortRich(text, maxChars, maxLines) {
  const all = rtLines(text);
  const kept = [];
  let used = 0;
  let truncated = false;

  for (let i = 0; i < all.length; i++) {
    if (kept.length >= maxLines) { truncated = true; break; }
    const line = all[i];
    const restante = maxChars - used;
    if (line.length <= restante) {
      kept.push(line);
      used += line.length + 1;
      continue;
    }
    const corte = rtCutWords(line, Math.max(0, restante));
    // Si el corte cae dentro del marcador de una lista ("- [x] " partido en
    // "- [x"), lo que queda ya no es esa subtarea: se ve como una viñeta con
    // un "[x" suelto. En ese caso la línea entera se descarta.
    const prefijo = rtListPrefixOf(line);
    const mantiene = prefijo === null
      ? Boolean(corte.trim())
      : rtListPrefixOf(corte) === prefijo && Boolean(corte.slice(prefijo.length).trim());
    if (mantiene) kept.push(corte);
    truncated = true;
    break;
  }
  if (kept.length < all.length) truncated = true;

  // Una lista que se corta a medias no debe arrastrar su prefijo vacío.
  while (kept.length && rtListPrefixOf(kept[kept.length - 1]) !== null &&
         !kept[kept.length - 1].slice(rtListPrefixOf(kept[kept.length - 1]).length).trim()) {
    kept.pop();
    truncated = true;
  }

  let out = kept.map(rtBalance).join("\n");
  if (truncated && out) out += " …";
  return { text: out, truncated: truncated };
}

// Corta en el último espacio para no partir una palabra por la mitad.
function rtCutWords(line, max) {
  if (max <= 0) return "";
  const trozo = line.slice(0, max);
  const espacio = trozo.lastIndexOf(" ");
  return (espacio > max * 0.5 ? trozo.slice(0, espacio) : trozo).replace(/\s+$/, "");
}

// Cierra los marcadores impares que dejó el recorte.
function rtBalance(line) {
  let out = line;
  const dobles = [["**", /\*\*/g], ["~~", /~~/g], ["__", /__/g]];
  for (const [marca, re] of dobles) {
    const n = (out.match(re) || []).length;
    if (n % 2 === 1) out = rtDropLast(out, marca);
  }
  // Las cursivas de un solo carácter: se cuentan los asteriscos que no forman
  // parte de un `**` ya equilibrado.
  const sueltos = (out.replace(/\*\*/g, "").match(/\*/g) || []).length;
  if (sueltos % 2 === 1) out = rtDropLast(out, "*");
  const bajos = (out.replace(/__/g, "").match(/_/g) || []).length;
  if (bajos % 2 === 1) out = rtDropLast(out, "_");
  return out;
}

function rtDropLast(line, marca) {
  const i = line.lastIndexOf(marca);
  if (i < 0) return line;
  return line.slice(0, i) + line.slice(i + marca.length);
}

/** Texto sin marcadores, para tooltips, búsquedas y vistas compactas. */
export function plainRich(text) {
  return rtLines(text).map(function (line) {
    const task = line.match(RT_TASK_RE);
    if (task) return (task[2].toLowerCase() === "x" ? "✓ " : "○ ") + rtStripInline(task[3]);
    const bullet = line.match(RT_BULLET_RE);
    if (bullet) return "• " + rtStripInline(bullet[2]);
    return rtStripInline(line);
  }).join(" ").replace(/\s{2,}/g, " ").trim();
}

function rtStripInline(s) {
  return String(s)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2");
}

/** Subtareas hechas y totales de una descripción. */
export function taskProgress(text) {
  let done = 0;
  let total = 0;
  rtLines(text).forEach(function (line) {
    const task = line.match(RT_TASK_RE);
    if (!task) return;
    total++;
    if (task[2].toLowerCase() === "x") done++;
  });
  return { done: done, total: total };
}

/**
 * Invierte la casilla de la línea `index`. Devuelve el texto nuevo, o null si
 * esa línea ya no es una subtarea (el texto cambió por debajo).
 */
export function toggleTask(text, index) {
  const ls = rtLines(text);
  const line = ls[index];
  if (typeof line !== "string") return null;
  const task = line.match(RT_TASK_RE);
  if (!task) return null;
  const marca = task[2].toLowerCase() === "x" ? "[ ]" : "[x]";
  ls[index] = line.replace(/\[[ xX]\]/, marca);
  return ls.join("\n");
}

// -- Editor: barra de formato sobre un <textarea> ----------------------------

const RT_TOOLS = [
  { key: "bold",   mark: "**", label: "B", cls: "rt-b",  title: "Negrita (Ctrl+B)" },
  { key: "italic", mark: "*",  label: "I", cls: "rt-i",  title: "Cursiva (Ctrl+I)" },
  { key: "strike", mark: "~~", label: "S", cls: "rt-s",  title: "Tachado (Ctrl+Shift+X)" },
  { key: "bullet", prefix: RT_BULLET_PREFIX, label: "•",  cls: "rt-ul", title: "Lista con viñetas" },
  { key: "task",   prefix: RT_TASK_PREFIX,   label: "☑",  cls: "rt-tl", title: "Lista de subtareas" }
];

/**
 * Devuelve la barra de formato ya cableada al textarea y le engancha los
 * atajos de teclado y la continuación automática de listas al pulsar Enter.
 */
export function createRichToolbar(textarea) {
  const bar = document.createElement("div");
  bar.className = "rt-bar";

  RT_TOOLS.forEach(function (tool) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rt-btn " + tool.cls;
    btn.title = tool.title;
    btn.setAttribute("aria-label", tool.title);
    btn.textContent = tool.label;
    // mousedown, no click: al hacer click el textarea ya perdió la selección.
    btn.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      rtApplyTool(textarea, tool);
    });
    btn.addEventListener("click", function (ev) { ev.stopPropagation(); });
    bar.appendChild(btn);
  });

  const hint = document.createElement("span");
  hint.className = "rt-hint";
  hint.textContent = "**negrita** · *cursiva* · ~~tachado~~ · - [ ] subtarea";
  bar.appendChild(hint);

  textarea.addEventListener("keydown", function (ev) {
    const meta = ev.ctrlKey || ev.metaKey;
    if (meta && !ev.shiftKey && (ev.key === "b" || ev.key === "B")) {
      ev.preventDefault();
      rtApplyTool(textarea, RT_TOOLS[0]);
      return;
    }
    if (meta && !ev.shiftKey && (ev.key === "i" || ev.key === "I")) {
      ev.preventDefault();
      rtApplyTool(textarea, RT_TOOLS[1]);
      return;
    }
    if (meta && ev.shiftKey && (ev.key === "x" || ev.key === "X")) {
      ev.preventDefault();
      rtApplyTool(textarea, RT_TOOLS[2]);
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey && !meta) {
      if (rtContinueList(textarea)) ev.preventDefault();
    }
  });

  return bar;
}

function rtApplyTool(textarea, tool) {
  if (tool.prefix) rtPrefixLines(textarea, tool.prefix);
  else rtWrapSelection(textarea, tool.mark);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function rtSetSel(ta, start, end) {
  ta.selectionStart = start;
  ta.selectionEnd = end;
}

// Envuelve la selección con el marcador; si ya lo está, lo quita.
function rtWrapSelection(ta, mark) {
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const n = mark.length;

  if (before.endsWith(mark) && after.startsWith(mark)) {
    ta.value = before.slice(0, -n) + sel + after.slice(n);
    rtSetSel(ta, start - n, end - n);
    return;
  }
  if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(n, -n);
    ta.value = before + inner + after;
    rtSetSel(ta, start, start + inner.length);
    return;
  }
  ta.value = before + mark + sel + mark + after;
  if (sel) rtSetSel(ta, start + n, end + n);
  else rtSetSel(ta, start + n, start + n);
}

// Añade (o quita) el prefijo en todas las líneas que toca la selección.
function rtPrefixLines(ta, prefix) {
  const value = ta.value;
  const from = value.lastIndexOf("\n", Math.max(0, ta.selectionStart - 1)) + 1;
  let to = value.indexOf("\n", ta.selectionEnd);
  if (to === -1) to = value.length;

  const block = value.slice(from, to).split("\n");
  const marked = block.every(function (line) { return rtListPrefixOf(line) !== null; });

  const next = block.map(function (line) {
    const current = rtListPrefixOf(line);
    if (marked) return line.slice(current.length);
    if (current !== null) return prefix + line.slice(current.length);
    return prefix + line;
  }).join("\n");

  ta.value = value.slice(0, from) + next + value.slice(to);
  rtSetSel(ta, from, from + next.length);
}

// Prefijo de lista con el que empieza la línea, o null si no es una.
function rtListPrefixOf(line) {
  const task = line.match(/^\s*[-*]\s*\[[ xX]\]\s?/);
  if (task) return task[0];
  const bullet = line.match(/^\s*[-*]\s+/);
  if (bullet) return bullet[0];
  return null;
}

// Enter dentro de una lista continúa la lista; en un elemento vacío, la cierra.
function rtContinueList(ta) {
  const value = ta.value;
  const caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) return false;

  const from = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(from, caret);
  const prefix = rtListPrefixOf(line);
  if (prefix === null) return false;

  // Elemento vacío: se borra el prefijo y se sale de la lista.
  if (!line.slice(prefix.length).trim()) {
    ta.value = value.slice(0, from) + value.slice(caret);
    rtSetSel(ta, from, from);
    return true;
  }

  // La subtarea nueva nace sin marcar aunque la anterior estuviera hecha.
  const nuevo = "\n" + prefix.replace(/\[[xX]\]/, "[ ]");
  ta.value = value.slice(0, caret) + nuevo + value.slice(caret);
  rtSetSel(ta, caret + nuevo.length, caret + nuevo.length);
  return true;
}
