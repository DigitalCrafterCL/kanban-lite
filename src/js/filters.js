import { PRI, LS_WS_FILTERS } from "./config.js";
import { getState } from "./store.js";
import { esc } from "./utils.js";

export const filterWS = {};
export const filterPR = {};
export let searchQuery = "";

// Inicializar filtros de prioridad en true
Object.keys(PRI).forEach(function (k) {
  filterPR[k] = true;
});

export function syncFilters() {
  const state = getState();
  const seen = {};
  state.ws.forEach(function (w) {
    seen[w.key] = true;
    if (!(w.key in filterWS)) filterWS[w.key] = true;
  });
  Object.keys(filterWS).forEach(function (k) {
    if (!seen[k]) delete filterWS[k];
  });
}

export function setSearchQuery(q) {
  searchQuery = (q || "").trim().toLowerCase();
  if (typeof document !== "undefined") {
    const searchInput = document.getElementById("searchInput");
    const searchClear = document.getElementById("searchClear");
    if (searchInput && searchInput.value !== q) {
      searchInput.value = q;
    }
    if (searchClear) {
      searchClear.classList.toggle("visible", !!searchQuery);
    }
  }
}

export function getSearchQuery() {
  return searchQuery;
}

export function resetFilters() {
  Object.keys(filterWS).forEach(function (k) { delete filterWS[k]; });
  syncFilters();
  Object.keys(PRI).forEach(function (k) { filterPR[k] = true; });
  setSearchQuery("");
}

export function isVisible(card) {
  if (filterWS[card.ws] === false) return false;
  if (filterPR[card.pri] === false) return false;
  if (searchQuery) {
    const titleMatch = (card.t || "").toLowerCase().includes(searchQuery);
    const descMatch = (card.d || "").toLowerCase().includes(searchQuery);
    const idMatch = (card.id || "").toLowerCase().includes(searchQuery);
    // Las etiquetas se buscan con y sin '#': quien escribe "#api" espera lo
    // mismo que quien escribe "api".
    const needle = searchQuery.replace(/^#/, "");
    const labelMatch = (Array.isArray(card.labels) ? card.labels : [])
      .some(function (l) { return String(l).toLowerCase().includes(needle); });
    if (!titleMatch && !descMatch && !idMatch && !labelMatch) return false;
  }
  return true;
}

export function initSearch(onFilterChange) {
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");

  if (searchInput) {
    searchInput.addEventListener("input", function (ev) {
      setSearchQuery(ev.target.value);
      if (typeof onFilterChange === "function") onFilterChange();
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      setSearchQuery("");
      if (searchInput) searchInput.focus();
      if (typeof onFilterChange === "function") onFilterChange();
    });
  }
}

// Los frentes se pintan plegados. Un tablero con diez o doce frentes llenaba
// la barra de píldoras, la partía en varias filas y dejaba el buscador y las
// prioridades donde no se veían. La preferencia se recuerda: quien filtra a
// menudo no tiene que desplegar en cada recarga.
export function isWsFiltersOpen() {
  try {
    return localStorage.getItem(LS_WS_FILTERS) === "open";
  } catch (e) {
    return false;
  }
}

export function setWsFiltersOpen(open) {
  try {
    localStorage.setItem(LS_WS_FILTERS, open ? "open" : "closed");
  } catch (e) {}
  applyWsFiltersOpen();
}

export function toggleWsFilters() {
  setWsFiltersOpen(!isWsFiltersOpen());
}

function applyWsFiltersOpen() {
  const open = isWsFiltersOpen();
  const box = document.getElementById("wsFilters");
  const toggle = document.getElementById("wsToggle");
  if (box) box.hidden = !open;
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("open", open);
    const grupo = toggle.closest(".grp-ws");
    if (grupo) grupo.classList.toggle("open", open);
  }
}

// Plegado, el único aviso de que hay frentes ocultos es este contador: sin él
// un filtro olvidado parece un tablero al que le faltan tarjetas.
export function updateWsSummary() {
  const state = getState();
  const total = state.ws.length;
  const activos = state.ws.filter(function (w) { return filterWS[w.key] !== false; }).length;
  const filtrando = activos !== total;

  const count = document.getElementById("wsCount");
  if (count) count.textContent = filtrando ? activos + "/" + total : String(total);

  const toggle = document.getElementById("wsToggle");
  if (toggle) toggle.classList.toggle("filtering", filtrando);

  const clear = document.getElementById("wsClear");
  if (clear) clear.hidden = !filtrando;
}

export function buildFilters(onFilterChange, onOpenCfg) {
  syncFilters();
  const state = getState();

  const toggle = document.getElementById("wsToggle");
  if (toggle && !toggle.dataset.wired) {
    toggle.dataset.wired = "1";
    toggle.addEventListener("click", toggleWsFilters);
  }

  const clear = document.getElementById("wsClear");
  if (clear && !clear.dataset.wired) {
    clear.dataset.wired = "1";
    clear.addEventListener("click", function () {
      Object.keys(filterWS).forEach(function (k) { filterWS[k] = true; });
      buildFilters(onFilterChange, onOpenCfg);
      if (typeof onFilterChange === "function") onFilterChange();
    });
  }

  const wsc = document.getElementById("wsFilters");
  if (wsc) {
    wsc.innerHTML = "";
    state.ws.forEach(function (w) {
      const b = document.createElement("button");
      b.className = "chip";
      b.setAttribute("aria-pressed", filterWS[w.key] ? "true" : "false");
      b.style.setProperty("--cc", w.color);
      b.innerHTML = '<span class="dot"></span>' + esc(w.label) + ' <span class="ct" data-ct="' + esc(w.key) + '"></span>';
      b.addEventListener("click", function () {
        filterWS[w.key] = !filterWS[w.key];
        b.setAttribute("aria-pressed", filterWS[w.key] ? "true" : "false");
        updateWsSummary();
        if (typeof onFilterChange === "function") onFilterChange();
      });
      wsc.appendChild(b);
    });

    const cfg = document.createElement("button");
    cfg.className = "chip cfg";
    cfg.innerHTML = "⚙ Administrar";
    if (typeof onOpenCfg === "function") {
      cfg.addEventListener("click", onOpenCfg);
    }
    wsc.appendChild(cfg);
  }

  applyWsFiltersOpen();
  updateWsSummary();

  const prc = document.getElementById("prFilters");
  if (prc) {
    prc.innerHTML = '<span class="flabel">Prioridad</span>';
    Object.keys(PRI).forEach(function (k) {
      const b = document.createElement("button");
      b.className = "chip pri";
      b.setAttribute("aria-pressed", filterPR[k] ? "true" : "false");
      b.style.setProperty("--cc", PRI[k].color);
      b.innerHTML = '<span class="dot"></span>' + esc(PRI[k].label);
      b.addEventListener("click", function () {
        filterPR[k] = !filterPR[k];
        b.setAttribute("aria-pressed", filterPR[k] ? "true" : "false");
        if (typeof onFilterChange === "function") onFilterChange();
      });
      prc.appendChild(b);
    });
  }
}

export function updateChipCounts() {
  updateWsSummary();
  const state = getState();
  state.ws.forEach(function (w) {
    const n = state.cards.filter(function (c) { return c.ws === w.key; }).length;
    const span = document.querySelector('[data-ct="' + w.key + '"]');
    if (span) span.textContent = n;
  });
}
