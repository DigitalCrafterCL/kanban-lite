// `stage` es la semántica de flujo de la columna, lo que las métricas
// necesitan saber sin conocer los nombres: "queue" es espera (el reloj del
// Cycle Time aún no corre), "flow" y "blocked" son trabajo en curso —bloqueado
// cuenta como WIP: el trabajo empezó y el reloj sigue corriendo— y "done" es
// el final. Una columna nueva sin `stage` se trata como "queue".
export const COLS = [
  { key: "backlog",    name: "Backlog",     kc: "var(--muted)",    wipLimit: 0, stage: "queue" },
  { key: "todo",       name: "Por hacer",   kc: "var(--pr-media)", wipLimit: 0, stage: "queue" },
  { key: "inprogress", name: "En progreso", kc: "var(--accent)",   wipLimit: 6, stage: "flow" },
  { key: "blocked",    name: "Bloqueado",   kc: "var(--ws-sec)",   wipLimit: 4, stage: "blocked" },
  { key: "done",       name: "Hecho",       kc: "var(--ws-rad)",   wipLimit: 0, stage: "done" }
];

// Etapa de una columna por su clave. Vive aquí y no en metrics.js porque
// normalizeStamps() la necesita y config.js no importa nada: si el rellenado
// de sellos viviera en metrics.js habría ciclo de módulos (metrics.js importa
// COLS).
export function colStage(key) {
  for (let i = 0; i < COLS.length; i++) {
    if (COLS[i].key === key) return COLS[i].stage || "queue";
  }
  return "queue";
}

export const PRI = {
  critica: { label: "Crítica", color: "var(--pr-critica)", rank: 0 },
  alta:    { label: "Alta",    color: "var(--pr-alta)",    rank: 1 },
  media:   { label: "Media",   color: "var(--pr-media)",   rank: 2 },
  baja:    { label: "Baja",    color: "var(--pr-baja)",    rank: 3 }
};

export const PALETTE = [
  "#e5484d", "#e0721c", "#e0b21c", "#3aa03a", "#12a594", "#0a8fa6",
  "#3c74e0", "#6172f3", "#9a72f0", "#d6449b", "#8a5a2b", "#6b7a90"
];

export const DEFAULT_META = {
  eyebrow: "Guía Interactiva · Primeros Pasos",
  title: "Kanban Lite",
  titleThin: "· Tablero de Bienvenida",
  subtitle: "Gestión ágil, offline-first y en un solo archivo",
  branch: "v1.0"
};

// -- Multi-board localStorage keys ------------------------------------------
export const LS_BOARDS_INDEX  = "kanban_boards";        // índice de todos los tableros
export const LS_ACTIVE        = "kanban_active_board";  // slug del tablero activo
export const LS_BOARD_PREFIX  = "kanban_board_";        // prefijo por tablero
export const LS_THEME         = "kanban_theme";         // preferencia de tema (global)
export const LS_WS_FILTERS    = "kanban_ws_filters";    // frentes desplegados o plegados (global)
export const LS_TRASH_PREFIX  = "kanban_trash_";        // papelera por tablero (tarjetas y frentes)

// Nada se borra de golpe: toda eliminación pasa por la papelera y se puede
// devolver a su sitio. Un tablero eliminado conserva su contenido hasta que
// se vacía a mano, así que el límite existe para no comerse la cuota del
// navegador con lo que ya nadie va a recuperar.
export const MAX_TRASH_ENTRIES = 120;

// Longitud máxima de la descripción de una tarjeta. Con texto enriquecido la
// descripción sostiene listas de subtareas, así que necesita más margen que un
// párrafo suelto. No puede pasarse del tope del servidor (MAX_STR_DESC en
// server/merge.js) o una sincronización truncaría lo que se escribió.
export const MAX_DESC = 2000;

// -- Ficha de la tarjeta: etiquetas, fecha de cierre y comentarios ----------
// Los topes existen por la cuota de localStorage y porque el servidor recorta
// igual (ver server/merge.js): mejor avisar aquí que perderlo al sincronizar.
export const MAX_LABELS = 8;
export const MAX_LABEL_LEN = 24;
export const MAX_COMMENTS = 60;
export const MAX_COMMENT_LEN = 600;

// Vista previa de la descripción en la tarjeta de la columna. La ficha
// completa se abre al hacer clic, así que en el tablero basta un resumen.
export const SHORT_DESC_CHARS = 150;
export const SHORT_DESC_LINES = 4;

// -- Tableros compartidos (backend opcional) --------------------------------
// Nada de esto es necesario para usar la app: si no hay servidores dados de
// alta, el cliente jamás toca la red.
export const LS_SERVERS         = "kanban_servers";       // servidores dados de alta
export const LS_SNAPSHOT_PREFIX = "kanban_synced_";       // último estado sincronizado, por tablero
export const SYNC_POLL_MS       = 8000;                   // sondeo mientras la pestaña está visible
export const SYNC_DEBOUNCE_MS   = 1200;                   // espera tras un cambio local antes de subir
export const SYNC_TIMEOUT_MS    = 10000;                  // corte de cada petición

// -- Métricas de flujo ------------------------------------------------------
// Umbrales de la Edad del WIP cuando el tablero aún no tiene suficientes
// tarjetas cerradas para calcular su propio p85 (ver metrics.js).
export const WIP_AGE_WARN_DAYS = 5;
export const WIP_AGE_LATE_DAYS = 10;
// Tarjetas cerradas con dato real que hacen falta para fiarse del p85 propio
// del tablero en vez de las constantes de arriba.
export const MIN_CLOSED_FOR_P85 = 5;

// Rellena los sellos de flujo que falten. Se llama desde el parche de rev 4 y
// desde todo camino que reemplaza el estado entero con tarjetas sin sellar y
// con la revisión ya al día, donde el parche no correría: aplicar una
// plantilla, importar un JSON, pegar tarjetas y clonar un tablero.
//
// Sólo rellena lo vacío, nunca pisa una fecha existente: un tablero compartido
// vuelve del servidor con la revisión que el servidor tenga guardada, así que
// esto puede ejecutarse muchas veces sobre las mismas tarjetas.
export function normalizeStamps(s) {
  const now = new Date().toISOString();
  (s.cards || []).forEach(function (c) {
    if (typeof c.st !== "string") c.st = "";
    if (typeof c.dn !== "string") c.dn = "";
    if (typeof c.cr !== "string" || !c.cr) c.cr = now;
    if (typeof c.ca !== "string" || !c.ca) c.ca = now;
    const stage = colStage(c.col);
    if (stage === "done") {
      if (!c.dn) c.dn = now;
      if (!c.st) c.st = c.cr;
    } else if (stage === "flow" || stage === "blocked") {
      if (!c.st) c.st = now;
    }
  });
  return s;
}

export const SEED_REV = 4;

// Parches de migración de revisiones. Cada uno debe ser idempotente: un
// tablero compartido vuelve del servidor con la revisión que el servidor
// tenga guardada, así que el mismo parche puede aplicarse más de una vez.
export const REV_PATCHES = {
  // rev 3 — la tarjeta gana etiquetas, fecha de cierre y comentarios.
  3: function (s) {
    (s.cards || []).forEach(function (c) {
      if (!Array.isArray(c.labels)) c.labels = [];
      if (!Array.isArray(c.comments)) c.comments = [];
      if (typeof c.due !== "string") c.due = "";
    });
  },
  // rev 4 — la tarjeta gana los sellos de flujo (cr, st, dn, ca). Un tablero
  // que ya existía no tiene historia que recuperar: se sella con la fecha de
  // hoy. Las tarjetas así selladas quedan con `cr === dn` y por eso el cálculo
  // de percentiles las descarta (ver metrics.js): darían un Cycle Time de
  // cero y hundirían la mediana del tablero.
  4: function (s) {
    normalizeStamps(s);
  }
};
