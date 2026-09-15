import { PRI, MAX_DESC, SHORT_DESC_CHARS, SHORT_DESC_LINES } from "./config.js";
import { getState, saveState, wsById, nextId, pushHistory } from "./store.js";
import { esc } from "./utils.js";
import { showToast } from "./toast.js";
import { attachCardDrag } from "./dnd.js";
import { renderRich, plainRich, shortRich, taskProgress, toggleTask, createRichToolbar } from "./richtext.js";
import { openCardDetail, dueHint, dueClass, formatDueShort } from "./carddetail.js";
import { isReadOnlyBoard } from "./sync.js";
import { stampNew, agingLevel, cardAgeDays } from "./metrics.js";

// La descripción se guarda en texto plano con marcadores tipo Markdown; aquí
// se convierte en HTML seguro (ver richtext.js).
//
// En el tablero se pinta un resumen, no la descripción entera: el recorte se
// hace sobre el TEXTO ORIGEN y cierra los marcadores partidos (shortRich), de
// modo que un `**` a medias no se escapa como asteriscos sueltos ni tiñe de
// negrita lo que venga después. Al recortar por el final, los índices de línea
// de las subtareas se conservan y siguen marcándose desde la tarjeta.
function descHtml(c) {
  if (!c.d) return "";
  const corto = shortRich(c.d, SHORT_DESC_CHARS, SHORT_DESC_LINES);
  if (!corto.text) return "";
  return '<div class="cdesc rich' + (corto.truncated ? " cdesc-corta" : "") + '">' +
    renderRich(corto.text) + '</div>';
}

// Etiquetas de la tarjeta. Se muestran las tres primeras y el resto se cuenta:
// una tarjeta con ocho etiquetas dejaría de leerse de un vistazo.
function labelsHtml(c) {
  const labels = Array.isArray(c.labels) ? c.labels : [];
  if (!labels.length) return "";
  const visibles = labels.slice(0, 3).map(function (l) {
    return '<span class="clabel">#' + esc(l) + '</span>';
  }).join("");
  const resto = labels.length > 3
    ? '<span class="clabel clabel-more" title="' + esc(labels.slice(3).map(function (l) { return "#" + l; }).join(" ")) + '">+' + (labels.length - 3) + '</span>'
    : "";
  return '<div class="clabels">' + visibles + resto + '</div>';
}

// Fecha de cierre y número de comentarios, para el pie de la tarjeta.
function dueHtml(c) {
  if (!c.due) return "";
  const cls = dueClass(c.due);
  return '<span class="cdue' + (cls ? " " + cls : "") + '" title="' + esc(dueHint(c.due)) + '">' +
    esc(formatDueShort(c.due)) + '</span>';
}

// Edad del WIP: cuántos días lleva la tarjeta parada en su columna actual.
// Sólo en trabajo en curso — en Backlog sería una píldora en cada tarjeta sin
// decir nada, y en Hecho la tarjeta ya se pinta en modo pill. El umbral es el
// p85 del Tiempo de Ciclo del propio tablero cuando hay historia suficiente
// (ver metrics.js).
function ageHtml(c) {
  const dias = cardAgeDays(c);
  if (isNaN(dias)) return "";
  const nivel = agingLevel(c);
  const redondo = dias < 1 ? "<1" : String(Math.floor(dias));
  const cuenta = dias < 1 ? "menos de un día" : Math.floor(dias) + (Math.floor(dias) === 1 ? " día" : " días");
  return '<span class="cage' + (nivel ? " cage-" + nivel : "") +
    '" title="' + esc(cuenta + " en esta columna") + '">' + esc(redondo) + 'd</span>';
}

function commentsHtml(c) {
  const n = Array.isArray(c.comments) ? c.comments.length : 0;
  if (!n) return "";
  return '<span class="ccomments" title="' + n + (n === 1 ? ' comentario' : ' comentarios') + '">💬 ' + n + '</span>';
}

function progressHtml(c) {
  const p = taskProgress(c.d);
  if (!p.total) return "";
  const cls = "rt-prog" + (p.done === p.total ? " rt-prog-full" : "");
  return '<span class="' + cls + '" title="Subtareas completadas">☑ ' +
    p.done + '/' + p.total + '</span>';
}

export function wsOptions(sel) {
  const state = getState();
  return state.ws.map(function (w) {
    return '<option value="' + esc(w.key) + '"' + (w.key === sel ? " selected" : "") + '>' + esc(w.label) + '</option>';
  }).join("");
}

export function prOptions(sel) {
  return Object.keys(PRI).map(function (k) {
    return '<option value="' + k + '"' + (k === (sel || "media") ? " selected" : "") + '>' + esc(PRI[k].label) + '</option>';
  }).join("");
}

export function createCardElement(c, onRender) {
  const el = document.createElement("article");
  el.className = "card";
  el.setAttribute("draggable", "true");
  el.dataset.id = c.id;

  const w = wsById(c.ws);
  el.style.setProperty("--wc", w.color);
  el.style.setProperty("--pc", PRI[c.pri] ? PRI[c.pri].color : "var(--muted)");

  const isDoneCol = (c.col === "done");

  if (isDoneCol) {
    el.classList.add("card-done");
    el.innerHTML =
      '<div class="card-pill-row">' +
        '<span class="done-check">✓</span>' +
        '<span class="cid">' + esc(c.id) + '</span>' +
        '<span class="done-title" title="' + esc(c.t + (c.d ? " — " + plainRich(c.d) : "")) + '">' + esc(c.t) + '</span>' +
        '<button class="expand-btn" aria-label="Expandir detalles" title="Expandir/colapsar">▼</button>' +
      '</div>' +
      '<div class="card-details">' +
        descHtml(c) +
        labelsHtml(c) +
        '<div class="cfoot">' +
          '<span class="wtag">' + esc(w.label) + '</span>' +
          progressHtml(c) +
          dueHtml(c) +
          commentsHtml(c) +
          '<span class="pri">' + esc(PRI[c.pri] ? PRI[c.pri].label : c.pri) + '</span>' +
        '</div>' +
      '</div>';

    // El botón ▼ despliega la pill en su sitio; el resto de la tarjeta abre la
    // ficha, igual que en cualquier otra columna.
    el.addEventListener("click", function (ev) {
      if (ev.target.closest(".expand-btn")) {
        el.classList.toggle("expanded");
        return;
      }
      handleCardClick(ev, el, c, onRender);
    });
  } else {
    el.innerHTML =
      '<div class="card-top">' +
        '<span class="cid">' + esc(c.id) + '</span>' +
        '<span class="pri">' + esc(PRI[c.pri] ? PRI[c.pri].label : c.pri) + '</span>' +
      '</div>' +
      '<p class="ctitle">' + esc(c.t) + '</p>' +
      descHtml(c) +
      labelsHtml(c) +
      '<div class="cfoot">' +
        '<span class="wtag">' + esc(w.label) + '</span>' +
        progressHtml(c) +
        ageHtml(c) +
        dueHtml(c) +
        commentsHtml(c) +
      '</div>';
  }

  if (!isDoneCol) {
    el.addEventListener("click", function (ev) { handleCardClick(ev, el, c, onRender); });
  }

  attachCardDrag(el, c.id);

  wireTaskChecks(el, c);

  return el;
}

// Un clic en la tarjeta abre su ficha central, que es el único sitio donde se
// edita. Se ignora lo que ya tiene su propio significado: marcar una subtarea
// del resumen o teclear en el formulario de alta.
function handleCardClick(ev, el, c, onRender) {
  if (ev.target.closest(".add-form") || ev.target.closest(".rt-check")) return;
  openCardDetail(c.id, onRender);
}

// Las casillas de las subtareas escriben en la descripción de la tarjeta viva
// y actualizan el DOM en sitio: un re-render completo cerraría las pills
// expandidas y perdería el desplazamiento.
function wireTaskChecks(el, c) {
  const checks = el.querySelectorAll(".rt-check");
  if (!checks.length) return;

  // En un tablero de sólo lectura las casillas se ven, pero no se marcan.
  if (isReadOnlyBoard()) {
    checks.forEach(function (box) { box.disabled = true; });
    return;
  }

  const desc = el.querySelector(".cdesc");
  if (desc) {
    // Un clic en la casilla no debe arrancar el arrastre de la tarjeta.
    desc.addEventListener("mousedown", function () { el.setAttribute("draggable", "false"); });
    desc.addEventListener("mouseleave", function () { el.setAttribute("draggable", "true"); });
    el.addEventListener("mouseup", function () { el.setAttribute("draggable", "true"); });
  }

  checks.forEach(function (box) {
    box.addEventListener("click", function (ev) { ev.stopPropagation(); });
    box.addEventListener("change", function (ev) {
      ev.stopPropagation();
      const live = getState().cards.find(function (x) { return x.id === c.id; });
      const next = live ? toggleTask(live.d, parseInt(box.dataset.line, 10)) : null;
      if (next === null) {
        // La descripción cambió por debajo (deshacer, importación o
        // sincronización): la casilla ya no corresponde a esa línea.
        box.checked = !box.checked;
        showToast("Esa subtarea ya no existe: la descripción cambió", "warn");
        return;
      }
      pushHistory();
      live.d = next;
      c.d = next;
      saveState();

      const li = box.closest(".rt-task");
      if (li) li.classList.toggle("rt-done", box.checked);
      const prog = el.querySelector(".rt-prog");
      if (prog) {
        const p = taskProgress(next);
        prog.textContent = "☑ " + p.done + "/" + p.total;
        prog.classList.toggle("rt-prog-full", p.done === p.total);
      }
    });
  });
}

export function createAddBlock(colKey, onRender) {
  const wrap = document.createElement("div");
  // Sin permiso de escritura no se ofrece añadir: es más honesto que un botón
  // que abre un formulario cuyo «Añadir» va a ser rechazado.
  if (isReadOnlyBoard()) return wrap;
  const btn = document.createElement("button");
  btn.className = "add-btn";
  btn.textContent = "+ Añadir tarea";

  const state = getState();
  // Ojo: `state` sólo sirve para pintar las opciones del formulario. Al guardar
  // se vuelve a pedir el estado vigente, porque este puede haber sido
  // reemplazado mientras el formulario estaba abierto.
  const form = document.createElement("div");
  form.className = "add-form";
  form.innerHTML =
    '<input type="text" class="f-title" placeholder="Título de la tarea" maxlength="90">' +
    '<textarea class="f-desc" placeholder="Descripción (opcional)" maxlength="' + MAX_DESC + '" rows="3"></textarea>' +
    '<div class="row">' +
      '<select class="f-ws">' + wsOptions(state.ws[0] ? state.ws[0].key : "") + '</select>' +
      '<select class="f-pr">' + prOptions("media") + '</select>' +
    '</div>' +
    '<div class="add-actions">' +
      '<button class="btn primary f-save">Añadir</button>' +
      '<button class="btn f-cancel">Cancelar</button>' +
    '</div>';

  const descInput = form.querySelector(".f-desc");
  form.insertBefore(createRichToolbar(descInput), descInput);

  btn.addEventListener("click", function () {
    form.classList.add("open");
    btn.style.display = "none";
    form.querySelector(".f-title").focus();
  });

  form.querySelector(".f-cancel").addEventListener("click", function () {
    form.classList.remove("open");
    btn.style.display = "";
  });

  form.querySelector(".f-save").addEventListener("click", function () {
    const titleIn = form.querySelector(".f-title");
    const t = titleIn.value.trim();
    if (!t) {
      titleIn.focus();
      return;
    }
    pushHistory();
    const ws = form.querySelector(".f-ws").value;
    getState().cards.push(stampNew({
      id: nextId(ws),
      ws: ws,
      pri: form.querySelector(".f-pr").value,
      col: colKey,
      t: t,
      d: form.querySelector(".f-desc").value.trim()
    }));
    saveState();
    if (typeof onRender === "function") onRender();
  });

  wrap.appendChild(btn);
  wrap.appendChild(form);
  return wrap;
}
