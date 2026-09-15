import { COLS } from "./config.js";
import { getState } from "./store.js";
import { isVisible } from "./filters.js";
import { flowMetrics } from "./metrics.js";

// Un KPI sin historia detrás se escribe "—", nunca "0": un cero dice "el
// equipo no entrega nada" donde la verdad es "aún no hay datos".
function num(v, dec) {
  if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "—";
  return typeof v === "number" ? v.toFixed(dec || 0) : String(v);
}

export function updateStats() {
  const state = getState();
  const byCol = {};
  COLS.forEach(function (c) { byCol[c.key] = 0; });
  state.cards.forEach(function (c) {
    if (isVisible(c)) byCol[c.col]++;
  });

  const total = Object.keys(byCol).reduce(function (s, k) { return s + byCol[k]; }, 0);
  const pend = byCol.backlog + byCol.todo;
  const grand = state.cards.length;

  // Los KPI de flujo se calculan sobre TODAS las tarjetas, no sobre las
  // visibles: un WIP que baja al filtrar por frente miente sobre la carga real
  // del equipo. Los contadores de siempre sí respetan el filtro, y su etiqueta
  // lo dice ("Total visibles").
  const m = flowMetrics(state.cards);
  const anejas = m.aging.late;

  const tiles = [
    { l: "Total visibles", n: total, sc: "var(--accent)" },
    { l: "Pendientes",     n: pend,  sc: "var(--muted)" },
    { l: "Por hacer",      n: byCol.todo, sc: "var(--pr-media)" },
    {
      l: "WIP", n: m.wip, sc: "var(--accent)",
      small: m.wipLimit ? "/ " + m.wipLimit : "",
      bar: m.wipLimit ? Math.min(100, (m.wip / m.wipLimit) * 100) : null,
      // El total puede ir holgado y una columna concreta estar desbordada: el
      // aviso mira cada límite por separado.
      alert: m.over.length > 0,
      title: m.over.length
        ? "Por encima del límite: " + m.over.join(", ")
        : "Trabajo en curso (En progreso + Bloqueado) sobre la suma de límites"
    },
    {
      l: "Throughput", n: m.throughput7, sc: "var(--ws-rad)", small: "/ 7 d",
      title: "Tarjetas terminadas en los últimos 7 días · 30 días: " + m.throughput30
    },
    {
      l: "Ciclo p50", n: num(m.cycle.p50, 1), sc: "var(--pr-alta)",
      small: m.cycle.n ? "d" : "",
      title: m.cycle.n
        ? "Mediana del Tiempo de Ciclo sobre " + m.cycle.n + " tarjeta" + (m.cycle.n === 1 ? "" : "s") + " cerrada" + (m.cycle.n === 1 ? "" : "s") + " · p85 " + num(m.cycle.p85, 1) + " d"
        : "Aún no hay tarjetas cerradas con historia de flujo"
    },
    {
      l: "⚑ Añejas", n: anejas, sc: "var(--pr-critica)", alert: anejas > 0,
      title: isNaN(m.aging.max)
        ? "Tarjetas en curso por encima de " + num(m.aging.umbral.late, 1) + " días en su columna"
        : "Más añeja: " + m.aging.maxId + " con " + num(m.aging.max, 1) + " días · umbral " + num(m.aging.umbral.late, 1) + " d"
    },
    { l: "Bloqueado",      n: byCol.blocked, sc: "var(--ws-sec)" },
    { l: "Hecho",          n: byCol.done, sc: "var(--ws-rad)", grand: grand }
  ];

  const el = document.getElementById("stats");
  if (!el) return;
  el.innerHTML = "";
  tiles.forEach(function (t) {
    const d = document.createElement("div");
    d.className = "stat" + (t.alert ? " stat-alert" : "");
    d.style.setProperty("--sc", t.alert ? "var(--pr-critica)" : t.sc);
    if (t.title) d.title = t.title;
    const extra = t.grand !== undefined
      ? ' <small>/ ' + t.grand + '</small>'
      : (t.small ? ' <small>' + t.small + '</small>' : '');
    d.innerHTML = '<span class="n">' + t.n + extra + '</span><span class="l">' + t.l + '</span>';
    if (t.bar !== null && t.bar !== undefined) {
      const bar = document.createElement("span");
      bar.className = "stat-bar";
      bar.style.setProperty("--w", t.bar.toFixed(1) + "%");
      d.appendChild(bar);
    }
    el.appendChild(d);
  });
}
