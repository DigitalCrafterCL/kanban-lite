// Panel de métricas: el desglose de los KPI que la tira de la cabecera sólo
// resume. Es de sólo lectura y no guarda nada, así que se recalcula al abrir
// en vez de suscribirse al estado.
//
// Los gráficos son barras de CSS puro. Para comparar ocho semanas y cinco
// tramos, un div con ancho porcentual evita sumar una dependencia de runtime.

import { getState } from "./store.js";
import { flowMetrics } from "./metrics.js";
import { esc } from "./utils.js";

function mu(v, dec) {
  if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "—";
  return typeof v === "number" ? v.toFixed(dec === undefined ? 1 : dec) : String(v);
}

function muFecha(d) {
  if (!d) return "—";
  return d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

export function initMetrics() {
  const overlay = document.getElementById("metricsOverlay");
  const openBtn = document.getElementById("metricsBtn");
  const closeBtn = document.getElementById("metricsClose");
  const reloadBtn = document.getElementById("metricsReload");

  if (openBtn) openBtn.addEventListener("click", openMetrics);
  if (closeBtn) closeBtn.addEventListener("click", closeMetrics);
  if (reloadBtn) reloadBtn.addEventListener("click", renderMetrics);

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeMetrics();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeMetrics();
    }
  });
}

export function openMetrics() {
  const overlay = document.getElementById("metricsOverlay");
  if (!overlay) return;
  overlay.classList.add("open");
  renderMetrics();
}

export function closeMetrics() {
  const overlay = document.getElementById("metricsOverlay");
  if (overlay) overlay.classList.remove("open");
}

function tile(label, valor, small, sc, alerta) {
  return '<div class="stat' + (alerta ? " stat-alert" : "") + '" style="--sc:' + sc + '">' +
    '<span class="n">' + esc(String(valor)) + (small ? ' <small>' + esc(small) + '</small>' : '') + '</span>' +
    '<span class="l">' + esc(label) + '</span>' +
    '</div>';
}

function barras(items, clase) {
  const max = items.reduce(function (m, i) { return Math.max(m, i.n); }, 0);
  return '<div class="mt-bars ' + clase + '">' + items.map(function (i) {
    const pct = max ? (i.n / max) * 100 : 0;
    return '<div class="mt-bar-row">' +
      '<span class="mt-bar-lbl">' + esc(i.l) + '</span>' +
      '<span class="mt-bar-track"><span class="mt-bar-fill" style="--w:' + pct.toFixed(1) + '%"></span></span>' +
      '<span class="mt-bar-n">' + i.n + '</span>' +
      '</div>';
  }).join("") + '</div>';
}

export function renderMetrics() {
  const body = document.getElementById("metricsBody");
  if (!body) return;

  const cards = getState().cards;
  const m = flowMetrics(cards);

  if (!m.total) {
    body.innerHTML = '<p class="mt-vacio">Este tablero todavía no tiene tarjetas. Las métricas aparecen en cuanto haya trabajo que medir.</p>';
    return;
  }

  const tiles = [
    tile("Throughput 7 d", m.throughput7, "cerradas", "var(--ws-rad)"),
    tile("Throughput 30 d", m.throughput30, "cerradas", "var(--ws-rad)"),
    tile("Ciclo p50", mu(m.cycle.p50), m.cycle.n ? "d" : "", "var(--pr-alta)"),
    tile("Ciclo p85", mu(m.cycle.p85), m.cycle.n ? "d" : "", "var(--pr-alta)"),
    tile("Entrega p50", mu(m.lead.p50), m.lead.n ? "d" : "", "var(--accent)"),
    tile("Entrega p85", mu(m.lead.p85), m.lead.n ? "d" : "", "var(--accent)"),
    tile("WIP", m.wip, m.wipLimit ? "/ " + m.wipLimit : "", "var(--accent)", m.over.length > 0),
    tile("Bloqueadas", m.bloqueadas, isNaN(m.bloqueadasPct) ? "" : mu(m.bloqueadasPct, 0) + " %", "var(--ws-sec)", m.bloqueadas > 0),
    tile("⚑ Añejas", m.aging.late, "> " + mu(m.aging.umbral.late) + " d", "var(--pr-critica)", m.aging.late > 0)
  ].join("");

  const semanas = m.semanas.map(function (s, i) {
    return { l: i === m.semanas.length - 1 ? "esta sem." : "-" + (m.semanas.length - 1 - i) + " sem.", n: s.n };
  });

  const filas = m.porCol.map(function (f) {
    const activa = f.stage === "flow" || f.stage === "blocked";
    return '<tr' + (f.over ? ' class="mt-over"' : '') + '>' +
      '<td>' + esc(f.name) + '</td>' +
      '<td class="mt-num">' + f.n + '</td>' +
      '<td class="mt-num">' + (f.limit ? f.limit : "—") + '</td>' +
      '<td class="mt-num">' + (activa ? mu(f.avgAge) : "—") + '</td>' +
      '<td class="mt-num">' + (activa ? mu(f.maxAge) : "—") + '</td>' +
      '<td>' + (activa && f.maxId ? esc(f.maxId) : "—") + '</td>' +
      '</tr>';
  }).join("");

  const avisos = [];
  if (m.over.length) {
    avisos.push('<p class="mt-aviso">Por encima del límite WIP: <b>' + esc(m.over.join(", ")) +
      '</b>. Terminar antes de empezar es lo que baja el Tiempo de Ciclo.</p>');
  }
  if (m.sinFlujo) {
    avisos.push('<p class="mt-nota">' + m.sinFlujo + ' tarjeta' + (m.sinFlujo === 1 ? "" : "s") +
      ' cerrada' + (m.sinFlujo === 1 ? "" : "s") + ' queda' + (m.sinFlujo === 1 ? "" : "n") +
      ' fuera de los tiempos: se sellaron al activar las métricas y su duración real se desconoce. ' +
      'Cuentan para el Throughput, no para las medianas.</p>');
  }
  avisos.push('<p class="mt-nota">Hay datos de flujo desde el <b>' + esc(muFecha(m.desde)) + '</b>. ' +
    'El umbral de tarjeta añeja es ' + mu(m.aging.umbral.late) + ' días' +
    (m.aging.umbral.propio ? ' (el p85 del Tiempo de Ciclo de este tablero).' : ' (valor por defecto: aún no hay tarjetas cerradas suficientes para calcular el p85 propio).') +
    '</p>');

  body.innerHTML =
    '<div class="stats mt-tiles">' + tiles + '</div>' +
    '<div class="mt-cols">' +
      '<div class="mt-block">' +
        '<div class="lbl-sec">Entregas por semana</div>' +
        barras(semanas, "mt-weeks") +
      '</div>' +
      '<div class="mt-block">' +
        '<div class="lbl-sec">Tiempo de Ciclo, por tramos</div>' +
        (m.cycle.n
          ? barras(m.tramos, "mt-tramos")
          : '<p class="mt-vacio">Sin tarjetas cerradas con historia de flujo todavía.</p>') +
      '</div>' +
    '</div>' +
    '<div class="lbl-sec">Por columna</div>' +
    '<table class="mt-table">' +
      '<thead><tr><th>Columna</th><th class="mt-num">Tarjetas</th><th class="mt-num">Límite</th>' +
      '<th class="mt-num">Edad media</th><th class="mt-num">Edad máx.</th><th>Más añeja</th></tr></thead>' +
      '<tbody>' + filas + '</tbody>' +
    '</table>' +
    avisos.join("");
}
