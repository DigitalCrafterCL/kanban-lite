// Métricas de flujo: sellado de las fechas de la tarjeta y cálculo de los KPI
// del tablero. Sin DOM — todo lo que se pinta vive en metricsui.js y stats.js.
//
// POR QUÉ CUATRO CADENAS Y NO UN REGISTRO DE EVENTOS
// Un `card.hist = [{at, col}]` daría métricas exactas, pero es una lista: la
// fusión del servidor es por entidad y gana quien llega último, así que dos
// personas moviendo la misma tarjeta perderían media historia; haría falta
// unión por id y lápidas como en los comentarios. Además
// crece sin techo contra la cuota de localStorage y sync.js tendría que
// compararla por valor en cada sondeo. Cuatro cadenas se fusionan solas con la
// regla que ya existe y el servidor las sanea con `str()`, sin código nuevo.
//
// Los identificadores del módulo van prefijados (`mt…`, `MT_…`) por §4.1: el
// bundle es un IIFE y todo comparte espacio de nombres.

import {
  COLS, colStage,
  WIP_AGE_WARN_DAYS, WIP_AGE_LATE_DAYS, MIN_CLOSED_FOR_P85
} from "./config.js";

const MT_DAY_MS = 86400000;

// -- Sellado ----------------------------------------------------------------
// Se llama desde los puntos donde el usuario crea o mueve una tarjeta, nunca
// desde saveState() ni setState(): ésos también corren al aplicar un estado
// que llega del servidor, y pondrían el reloj de este navegador encima del
// movimiento de otra persona. Un deshacer tampoco necesita
// nada: los sellos viajan dentro del clon que guarda pushHistory().

export function stampNew(card) {
  const now = new Date().toISOString();
  card.cr = now;
  card.ca = now;
  card.st = "";
  card.dn = "";
  const stage = colStage(card.col);
  if (stage === "flow" || stage === "blocked") card.st = now;
  else if (stage === "done") { card.st = now; card.dn = now; }
  return card;
}

export function stampMove(card, prevCol) {
  if (!card || card.col === prevCol) return card;
  const now = new Date().toISOString();
  const stage = colStage(card.col);
  card.ca = now;
  if (typeof card.cr !== "string" || !card.cr) card.cr = now;
  if (stage === "flow" || stage === "blocked") {
    if (!card.st) card.st = now;
    card.dn = "";
  } else if (stage === "done") {
    if (!card.st) card.st = now;
    if (!card.dn) card.dn = now;
  } else {
    // Vuelve a una cola de espera: deja de estar terminada. `st` se conserva
    // — el trabajo empezó de verdad y el Cycle Time de la vuelta siguiente
    // debe incluir lo que ya se invirtió.
    card.dn = "";
  }
  return card;
}

// Clonar es empezar otra vuelta del mismo trabajo (§4.6): la tarjeta nace hoy
// y sin ciclo anterior. Heredar `st`/`dn` daría Cycle Times de meses el primer
// día del tablero nuevo.
export function stampClone(card) {
  return stampNew(card);
}

// -- Utilidades de cálculo --------------------------------------------------

export function mtTime(iso) {
  if (typeof iso !== "string" || !iso) return NaN;
  const t = Date.parse(iso);
  return isNaN(t) ? NaN : t;
}

export function mtDays(desde, hasta) {
  const a = mtTime(desde);
  const b = typeof hasta === "number" ? hasta : mtTime(hasta);
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.max(0, (b - a) / MT_DAY_MS);
}

// Percentil por rango más cercano: sin interpolación no hay que decidir qué
// hacer con muestras de dos o tres tarjetas, que es el caso normal aquí.
export function mtPercentile(valores, p) {
  const v = valores.filter(function (x) { return typeof x === "number" && !isNaN(x); }).sort(function (a, b) { return a - b; });
  if (!v.length) return NaN;
  const i = Math.max(0, Math.ceil((p / 100) * v.length) - 1);
  return v[i];
}

function mtAvg(valores) {
  if (!valores.length) return NaN;
  let s = 0;
  for (let i = 0; i < valores.length; i++) s += valores[i];
  return s / valores.length;
}

// Una tarjeta sellada por la migración tiene `cr === dn`: se cerró antes de
// que existieran las métricas y su duración real se desconoce. Cuenta para el
// Throughput (se cerró de verdad) pero queda fuera de los percentiles, o la
// mediana del tablero se hundiría a cero durante semanas.
export function mtTieneFlujo(card) {
  return !!card.dn && !!card.cr && card.cr !== card.dn;
}

// -- Edad del WIP -----------------------------------------------------------
// El umbral se guarda en el módulo porque la tarjeta se pinta una a una y
// recalcularlo por tarjeta sería recorrer el tablero entero N veces. render()
// lo refresca una vez antes de pintar.

let mtUmbral = { warn: WIP_AGE_WARN_DAYS, late: WIP_AGE_LATE_DAYS, propio: false };

export function refreshAgingThreshold(cards) {
  const ciclos = [];
  (cards || []).forEach(function (c) {
    if (mtTieneFlujo(c) && c.st) {
      const d = mtDays(c.st, c.dn);
      if (!isNaN(d)) ciclos.push(d);
    }
  });
  if (ciclos.length >= MIN_CLOSED_FOR_P85) {
    const p85 = mtPercentile(ciclos, 85);
    mtUmbral = { warn: p85, late: p85 * 2, propio: true };
  } else {
    mtUmbral = { warn: WIP_AGE_WARN_DAYS, late: WIP_AGE_LATE_DAYS, propio: false };
  }
  return mtUmbral;
}

export function agingThreshold() {
  return mtUmbral;
}

// Días en la columna actual. Sólo tiene sentido mientras el trabajo está en
// curso: en las colas de espera sería ruido en cada tarjeta del Backlog, y en
// Hecho la tarjeta ya se pinta en modo pill.
export function cardAgeDays(card) {
  const stage = colStage(card.col);
  if (stage !== "flow" && stage !== "blocked") return NaN;
  return mtDays(card.ca, Date.now());
}

export function agingLevel(card) {
  const d = cardAgeDays(card);
  if (isNaN(d)) return "";
  if (d >= mtUmbral.late) return "late";
  if (d >= mtUmbral.warn) return "warn";
  return "";
}

// -- Los KPI del tablero ----------------------------------------------------
// Se calcula sobre TODAS las tarjetas, nunca sobre las visibles: un WIP que
// baja al filtrar por frente miente sobre la carga real del equipo.

export function flowMetrics(cards, ahora) {
  const now = typeof ahora === "number" ? ahora : Date.now();
  const list = Array.isArray(cards) ? cards : [];

  const porCol = COLS.map(function (col) {
    return {
      key: col.key, name: col.name, stage: col.stage || "queue",
      limit: col.wipLimit || 0, n: 0, over: false,
      ages: [], avgAge: NaN, maxAge: NaN, maxId: ""
    };
  });
  const idx = {};
  porCol.forEach(function (c, i) { idx[c.key] = i; });

  const ciclos = [];
  const leads = [];
  const cierres = [];
  let sinFlujo = 0;
  let desde = NaN;

  list.forEach(function (c) {
    const fila = porCol[idx[c.col]];
    if (fila) {
      fila.n++;
      if (fila.stage === "flow" || fila.stage === "blocked") {
        const edad = mtDays(c.ca, now);
        if (!isNaN(edad)) {
          fila.ages.push(edad);
          if (isNaN(fila.maxAge) || edad > fila.maxAge) { fila.maxAge = edad; fila.maxId = c.id; }
        }
      }
    }
    const cr = mtTime(c.cr);
    if (!isNaN(cr) && (isNaN(desde) || cr < desde)) desde = cr;

    if (c.dn) {
      const dn = mtTime(c.dn);
      if (!isNaN(dn)) cierres.push(dn);
      if (mtTieneFlujo(c)) {
        const lead = mtDays(c.cr, c.dn);
        if (!isNaN(lead)) leads.push(lead);
        if (c.st) {
          const ciclo = mtDays(c.st, c.dn);
          if (!isNaN(ciclo)) ciclos.push(ciclo);
        }
      } else {
        sinFlujo++;
      }
    }
  });

  porCol.forEach(function (f) {
    f.over = f.limit > 0 && f.n > f.limit;
    f.avgAge = mtAvg(f.ages);
  });

  const activas = porCol.filter(function (f) { return f.stage === "flow" || f.stage === "blocked"; });
  const wip = activas.reduce(function (s, f) { return s + f.n; }, 0);
  const wipLimit = activas.reduce(function (s, f) { return s + (f.limit || 0); }, 0);
  const bloqueadas = porCol.filter(function (f) { return f.stage === "blocked"; })
    .reduce(function (s, f) { return s + f.n; }, 0);

  const umbral = refreshAgingThreshold(list);
  let warn = 0, late = 0, maxAge = NaN, maxId = "";
  activas.forEach(function (f) {
    f.ages.forEach(function (d) {
      if (d >= umbral.late) late++;
      else if (d >= umbral.warn) warn++;
    });
    if (!isNaN(f.maxAge) && (isNaN(maxAge) || f.maxAge > maxAge)) { maxAge = f.maxAge; maxId = f.maxId; }
  });

  const enVentana = function (dias) {
    const corte = now - dias * MT_DAY_MS;
    return cierres.filter(function (t) { return t >= corte; }).length;
  };

  // Ocho semanas hacia atrás, la última es la que va corriendo.
  const semanas = [];
  for (let i = 7; i >= 0; i--) {
    const fin = now - i * 7 * MT_DAY_MS;
    const ini = fin - 7 * MT_DAY_MS;
    semanas.push({
      n: cierres.filter(function (t) { return t > ini && t <= fin; }).length,
      hasta: fin
    });
  }

  // Tramos de Cycle Time, para ver la forma de la distribución y no sólo su
  // mediana: dos tableros con el mismo p50 pueden entregar muy distinto.
  const TRAMOS = [
    { l: "< 1 d", min: 0, max: 1 },
    { l: "1–3 d", min: 1, max: 3 },
    { l: "3–7 d", min: 3, max: 7 },
    { l: "7–14 d", min: 7, max: 14 },
    { l: "> 14 d", min: 14, max: Infinity }
  ];
  const tramos = TRAMOS.map(function (t) {
    return { l: t.l, n: ciclos.filter(function (d) { return d >= t.min && d < t.max; }).length };
  });

  return {
    total: list.length,
    porCol: porCol,
    wip: wip,
    wipLimit: wipLimit,
    over: porCol.filter(function (f) { return f.over; }).map(function (f) { return f.name; }),
    bloqueadas: bloqueadas,
    bloqueadasPct: wip ? (bloqueadas / wip) * 100 : NaN,
    throughput7: enVentana(7),
    throughput30: enVentana(30),
    semanas: semanas,
    cerradas: cierres.length,
    cycle: { p50: mtPercentile(ciclos, 50), p85: mtPercentile(ciclos, 85), n: ciclos.length },
    lead: { p50: mtPercentile(leads, 50), p85: mtPercentile(leads, 85), n: leads.length },
    tramos: tramos,
    aging: { warn: warn, late: late, max: maxAge, maxId: maxId, umbral: umbral },
    sinFlujo: sinFlujo,
    desde: isNaN(desde) ? null : new Date(desde)
  };
}
