import seedData from "../data/seed.js";
import { SEED_REV, normalizeStamps } from "./config.js";
import { setState, pushHistory } from "./store.js";
import { resetFilters } from "./filters.js";
import { showToast } from "./toast.js";
import { clone } from "./utils.js";
import { denyReadOnly } from "./sync.js";

export const TEMPLATES = {
  welcome: {
    name: "Tutorial de Bienvenida",
    desc: "Aprende a usar el tablero con tarjetas interactivas que explican cada función.",
    meta: {
      eyebrow: "Guía Interactiva · Primeros Pasos",
      title: "Kanban Lite",
      titleThin: "· Tablero de Bienvenida",
      subtitle: "Gestión ágil, offline-first y en un solo archivo",
      branch: "v0.2.0"
    },
    ws: [
      { key: "GUIA", label: "Primeros Pasos", color: "#0a8fa6" },
      { key: "FEAT", label: "Funciones",      color: "#6172f3" },
      { key: "TIPS", label: "Atajos & Tips",  color: "#3aa03a" }
    ],
    cards: [
      { id: "GUIA-1", ws: "GUIA", pri: "alta",    col: "todo",       t: "Arrastra esta tarjeta", d: "Muévela a 'En progreso' arrastrándola, o abre su ficha con un clic y cambia la columna ahí." },
      { id: "GUIA-2", ws: "GUIA", pri: "media",   col: "todo",       t: "Abre la ficha de una tarjeta", d: "Haz clic en cualquier tarjeta para abrir su ficha: título, frente, prioridad, etiquetas, fecha de cierre, descripción y comentarios." },
      { id: "FEAT-3", ws: "FEAT", pri: "alta",    col: "todo",       t: "Descripciones con formato", d: "Usa **negrita**, *cursiva* y ~~tachado~~, y parte el texto en varias líneas.\n\nTambién listas de subtareas, que se marcan desde la propia tarjeta:\n- [x] Escribir la descripción\n- [ ] Marcar esta casilla\n- [ ] Ver el contador del pie" },
      { id: "FEAT-1", ws: "FEAT", pri: "critica", col: "inprogress", t: "Buscador instantáneo", d: "Presiona la tecla / para enfocar el buscador y filtrar tarjetas en tiempo real." },
      { id: "FEAT-2", ws: "FEAT", pri: "alta",    col: "inprogress", t: "Límites WIP visibles", d: "Esta columna tiene un límite sugerido de 6 tareas; el contador avisará si lo superas." },
      { id: "TIPS-1", ws: "TIPS", pri: "media",   col: "backlog",    t: "Presiona ? para ver atajos", d: "Descubre atajos como N para nueva tarea, Esc para cerrar y Ctrl+Z para deshacer." },
      { id: "TIPS-2", ws: "TIPS", pri: "baja",    col: "backlog",    t: "Exporta tu trabajo con ⇅ Datos", d: "Tus datos viven en tu navegador; descárgalos como .json cuando quieras respaldarlos." },
      { id: "GUIA-0", ws: "GUIA", pri: "baja",    col: "done",       t: "Modo Pill en 'Hecho'", d: "Las tarjetas completadas se compactan en una línea para no saturar la vista. ¡Haz clic para expandirme!" }
    ]
  },

  software: {
    name: "Desarrollo de Software",
    desc: "Estructura estándar para equipos de ingeniería (Frontend, Backend, DevOps, QA).",
    meta: {
      eyebrow: "Sprint 14 · Roadmap Q3",
      title: "Plataforma Core",
      titleThin: "/ Web & APIs",
      subtitle: "Entrega continua de funcionalidades y arquitectura",
      branch: "develop"
    },
    ws: [
      { key: "FE",  label: "Frontend",      color: "#6172f3" },
      { key: "BE",  label: "Backend",       color: "#0c9a8a" },
      { key: "OPS", label: "DevOps/Infra",  color: "#e0484d" },
      { key: "QA",  label: "QA & Pruebas",  color: "#e0b21c" }
    ],
    cards: [
      { id: "FE-1",  ws: "FE",  pri: "critica", col: "todo",       t: "Optimizar carga de vistas", d: "Implementar lazy loading de componentes pesados y reducir bundle size." },
      { id: "BE-1",  ws: "BE",  pri: "alta",    col: "inprogress", t: "API de autenticación OAuth2", d: "Renovación de tokens JWT y middleware de autorización por roles." },
      { id: "OPS-1", ws: "OPS", pri: "alta",    col: "todo",       t: "Configurar pipeline CI/CD", d: "Automatizar ejecución de linters y tests en cada Pull Request." },
      { id: "QA-1",  ws: "QA",  pri: "media",   col: "backlog",    t: "Suite de pruebas E2E", d: "Cubrir flujos principales de checkout y registro de usuarios." },
      { id: "BE-0",  ws: "BE",  pri: "baja",    col: "done",       t: "Diseño de esquema de base de datos", d: "Modelado relacional y migraciones iniciales completadas." }
    ]
  },

  personal: {
    name: "Productividad Personal",
    desc: "Organización de metas personales, tareas del hogar, finanzas y bienestar.",
    meta: {
      eyebrow: "Planificación Personal",
      title: "Mis Proyectos & Metas",
      titleThin: "· 2026",
      subtitle: "Seguimiento de objetivos y tareas cotidianas",
      branch: "personal"
    },
    ws: [
      { key: "META", label: "Proyectos", color: "#3c74e0" },
      { key: "CASA", label: "Hogar",     color: "#3aa03a" },
      { key: "FIN",  label: "Finanzas",  color: "#e0721c" },
      { key: "VIDA", label: "Salud",     color: "#d6449b" }
    ],
    cards: [
      { id: "META-1", ws: "META", pri: "alta",  col: "inprogress", t: "Renovar portafolio web", d: "Actualizar proyectos recientes y casos de estudio." },
      { id: "FIN-1",  ws: "FIN",  pri: "alta",  col: "todo",       t: "Revisar presupuesto mensual", d: "Cuadrar gastos fijos y definir meta de ahorro para fin de año." },
      { id: "CASA-1", ws: "CASA", pri: "media", col: "todo",       t: "Mantenimiento del computador", d: "Limpieza de disco, copias de seguridad y actualización del SO." },
      { id: "VIDA-1", ws: "VIDA", pri: "media", col: "backlog",    t: "Plan de entrenamiento físico", d: "Establecer rutina de 3 sesiones semanales de cardio y fuerza." },
      { id: "FIN-0",  ws: "FIN",  pri: "baja",  col: "done",       t: "Declaración anual de impuestos", d: "Documentación enviada y aprobada." }
    ]
  },

  blank: {
    name: "Tablero en Blanco",
    desc: "Un lienzo limpio sin tareas para empezar desde cero.",
    meta: {
      eyebrow: "Nuevo Proyecto",
      title: "Mi Tablero",
      titleThin: "",
      subtitle: "Personaliza tus columnas, frentes y tarjetas",
      branch: "v1.0"
    },
    ws: [
      { key: "GEN", label: "General", color: "#0a8fa6" }
    ],
    cards: []
  }
};

let onTemplateAppliedCallback = null;

export function initTemplatesModal(onApplied) {
  onTemplateAppliedCallback = onApplied;

  const overlay = document.getElementById("templatesOverlay");
  const openBtn = document.getElementById("templatesBtn");
  const closeBtn = document.getElementById("templatesClose");
  const grid = document.getElementById("templatesGrid");

  if (openBtn) {
    openBtn.addEventListener("click", openTemplatesModal);
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeTemplatesModal);
  }

  if (overlay) {
    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closeTemplatesModal();
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeTemplatesModal();
    }
  });

  if (grid) {
    grid.innerHTML = "";
    Object.keys(TEMPLATES).forEach(function (key) {
      const t = TEMPLATES[key];
      const card = document.createElement("div");
      card.className = "template-card";
      card.innerHTML = `
        <div class="template-card-title">${t.name}</div>
        <div class="template-card-desc">${t.desc}</div>
        <div class="template-card-meta">${t.ws.length} frentes · ${t.cards.length} tareas</div>
      `;
      card.addEventListener("click", function () {
        applyTemplate(key);
        closeTemplatesModal();
      });
      grid.appendChild(card);
    });
  }
}

export function openTemplatesModal() {
  const overlay = document.getElementById("templatesOverlay");
  if (overlay) overlay.classList.add("open");
}

export function closeTemplatesModal() {
  const overlay = document.getElementById("templatesOverlay");
  if (overlay) overlay.classList.remove("open");
}

export function applyTemplate(key) {
  const t = TEMPLATES[key];
  if (!t) return;
  if (denyReadOnly("No se aplicó la plantilla")) return;

  pushHistory();
  // La plantilla nace con la revisión al día, así que el parche de migración
  // no correría: los sellos de flujo hay que ponerlos aquí o el tablero nuevo
  // arrancaría sin fecha de creación en ninguna tarjeta.
  setState(normalizeStamps({
    meta: clone(t.meta),
    ws: clone(t.ws),
    cards: clone(t.cards),
    rev: SEED_REV
  }), true);

  resetFilters();
  if (typeof onTemplateAppliedCallback === "function") {
    onTemplateAppliedCallback();
  }

  showToast(`Plantilla "${t.name}" cargada con éxito`, "success");
}
