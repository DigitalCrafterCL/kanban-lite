import seedData from "../data/seed.js";
import { SEED_REV, normalizeStamps, normalizeCols } from "./config.js";
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

  // Las plantillas de operación traen sus propias columnas: el flujo de un
  // ticket o de una orden de trabajo no se llama «Backlog» ni «En progreso».
  // Las claves siguen siendo las de siempre, así que las métricas funcionan.
  soporte: {
    name: "Soporte Técnico",
    desc: "Mesa de ayuda: tickets desde la recepción hasta la resolución, con espera de cliente y escalamiento.",
    meta: {
      eyebrow: "Mesa de Ayuda",
      title: "Soporte Técnico",
      titleThin: "· Tickets",
      subtitle: "Recepción, diagnóstico, atención y cierre de incidencias",
      branch: "v1.0"
    },
    cols: [
      { key: "backlog",    name: "Recibidos" },
      { key: "todo",       name: "Clasificados" },
      { key: "inprogress", name: "En atención" },
      { key: "blocked",    name: "Esperando cliente / 3.º" },
      { key: "done",       name: "Resueltos" }
    ],
    ws: [
      { key: "N1",  label: "Nivel 1 · Mesa",       color: "#0a8fa6" },
      { key: "N2",  label: "Nivel 2 · Escalado",   color: "#6172f3" },
      { key: "RED", label: "Redes y conectividad", color: "#e0721c" },
      { key: "HW",  label: "Hardware",             color: "#8a5a2b" },
      { key: "ACC", label: "Accesos y cuentas",    color: "#3aa03a" }
    ],
    cards: [
      { id: "N1-1",  ws: "N1",  pri: "media",   col: "backlog",    t: "Usuario no puede imprimir", d: "**Solicitante:** \n**Equipo / ubicación:** \n**Desde cuándo:** \n\n- [ ] Verificar cola de impresión\n- [ ] Reinstalar controlador", labels: ["impresion"] },
      { id: "ACC-1", ws: "ACC", pri: "alta",    col: "backlog",    t: "Restablecer contraseña de correo", d: "Validar identidad antes de restablecer.\n\n- [ ] Validar identidad\n- [ ] Forzar cambio en el próximo inicio", labels: ["cuentas"] },
      { id: "RED-1", ws: "RED", pri: "critica", col: "todo",       t: "Sin conexión en sala de reuniones", d: "Afecta a varios usuarios. Revisar punto de acceso y switch del piso.", labels: ["wifi"] },
      { id: "HW-1",  ws: "HW",  pri: "media",   col: "todo",       t: "Notebook con batería que no carga", d: "- [ ] Probar con otro cargador\n- [ ] Revisar garantía\n- [ ] Coordinar equipo de reemplazo", labels: ["garantia"] },
      { id: "N2-1",  ws: "N2",  pri: "alta",    col: "inprogress", t: "Error al abrir sistema contable", d: "Escalado desde Nivel 1. Reproducido en dos equipos.\n\n- [x] Recopilar captura del error\n- [ ] Revisar registro del servidor\n- [ ] Probar en ambiente de pruebas" },
      { id: "N1-2",  ws: "N1",  pri: "baja",    col: "blocked",    t: "Instalar software de diseño", d: "Esperando aprobación de licencia por parte de la jefatura.", labels: ["licencias"] },
      { id: "N1-3",  ws: "N1",  pri: "media",   col: "done",       t: "Configurar correo en celular nuevo", d: "Resuelto en remoto. Usuario confirma funcionamiento." }
    ]
  },

  comercial: {
    name: "Comerciales",
    desc: "Embudo de ventas: oportunidades desde el primer contacto hasta el cierre, por segmento de cliente.",
    meta: {
      eyebrow: "Gestión Comercial",
      title: "Embudo de Ventas",
      titleThin: "· Oportunidades",
      subtitle: "Prospección, propuesta, negociación y cierre",
      branch: "v1.0"
    },
    cols: [
      { key: "backlog",    name: "Prospectos" },
      { key: "todo",       name: "Contactados" },
      { key: "inprogress", name: "Propuesta enviada" },
      { key: "blocked",    name: "En negociación" },
      { key: "done",       name: "Cerrados" }
    ],
    ws: [
      { key: "EMP", label: "Empresas",          color: "#3c74e0" },
      { key: "PYM", label: "Pymes",             color: "#12a594" },
      { key: "PUB", label: "Sector público",    color: "#9a72f0" },
      { key: "REN", label: "Renovaciones",      color: "#e0b21c" }
    ],
    cards: [
      { id: "EMP-1", ws: "EMP", pri: "alta",    col: "backlog",    t: "Distribuidora del Norte", d: "**Contacto:** \n**Necesidad:** \n**Monto estimado:** \n\nReferido por cliente actual.", labels: ["referido"] },
      { id: "PYM-1", ws: "PYM", pri: "media",   col: "backlog",    t: "Ferretería La Esquina", d: "Llegó por formulario web. Interesado en plan básico.", labels: ["web"] },
      { id: "PUB-1", ws: "PUB", pri: "alta",    col: "todo",       t: "Municipalidad · licitación de servicios", d: "- [ ] Descargar bases\n- [ ] Revisar requisitos administrativos\n- [ ] Consultas al foro antes del plazo", labels: ["licitacion"] },
      { id: "EMP-2", ws: "EMP", pri: "critica", col: "inprogress", t: "Constructora Andes · propuesta anual", d: "Propuesta enviada. Hacer seguimiento a los 5 días.\n\n- [x] Enviar propuesta\n- [ ] Llamada de seguimiento", labels: ["seguimiento"] },
      { id: "REN-1", ws: "REN", pri: "alta",    col: "blocked",    t: "Renovación contrato Clínica Sur", d: "Piden 10 % de descuento. Evaluar con gerencia antes de responder.", labels: ["descuento"] },
      { id: "PYM-2", ws: "PYM", pri: "media",   col: "done",       t: "Panadería Central · ganado", d: "Contrato firmado. Traspasar a implementación.", labels: ["ganado"] }
    ]
  },

  mantenimiento: {
    name: "Mantenimiento de Equipos",
    desc: "Órdenes de trabajo preventivas y correctivas, con espera de repuestos y cierre verificado.",
    meta: {
      eyebrow: "Mantenimiento",
      title: "Órdenes de Trabajo",
      titleThin: "· Equipos",
      subtitle: "Preventivo, correctivo y repuestos",
      branch: "v1.0"
    },
    cols: [
      { key: "backlog",    name: "Solicitudes" },
      { key: "todo",       name: "Programadas" },
      { key: "inprogress", name: "En ejecución" },
      { key: "blocked",    name: "Esperando repuesto" },
      { key: "done",       name: "Cerradas" }
    ],
    ws: [
      { key: "PRE", label: "Preventivo",   color: "#3aa03a" },
      { key: "COR", label: "Correctivo",   color: "#e5484d" },
      { key: "CAL", label: "Calibración",  color: "#0a8fa6" },
      { key: "INS", label: "Instalaciones", color: "#6b7a90" }
    ],
    cards: [
      { id: "COR-1", ws: "COR", pri: "critica", col: "backlog",    t: "Compresor N.º 2 con ruido anormal", d: "**Equipo:** \n**Ubicación:** \n**Reportado por:** \n\nDetener si aumenta la temperatura.", labels: ["compresor"] },
      { id: "PRE-1", ws: "PRE", pri: "media",   col: "todo",       t: "Mantención trimestral grupo electrógeno", d: "- [ ] Cambio de aceite y filtros\n- [ ] Revisar baterías\n- [ ] Prueba con carga 30 min", labels: ["trimestral"] },
      { id: "CAL-1", ws: "CAL", pri: "alta",    col: "todo",       t: "Calibrar balanzas de bodega", d: "Certificado vence a fin de mes.", labels: ["certificacion"] },
      { id: "PRE-2", ws: "PRE", pri: "media",   col: "inprogress", t: "Limpieza de filtros de aire acondicionado", d: "- [x] Piso 1\n- [ ] Piso 2\n- [ ] Piso 3", labels: ["climatizacion"] },
      { id: "COR-2", ws: "COR", pri: "alta",    col: "blocked",    t: "Cinta transportadora detenida", d: "Rodamiento dañado. Repuesto pedido al proveedor; llega en 3 días.", labels: ["repuesto"] },
      { id: "INS-1", ws: "INS", pri: "baja",    col: "done",       t: "Cambio de luminarias en pasillo", d: "Cerrada y verificada por jefatura de área." }
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
  // Las columnas también: una plantilla sin columnas propias vuelve a las de
  // fábrica, para no heredar los nombres de la plantilla anterior.
  setState(normalizeStamps({
    meta: clone(t.meta),
    ws: clone(t.ws),
    cards: clone(t.cards),
    cols: normalizeCols(t.cols),
    rev: SEED_REV
  }), true);

  resetFilters();
  if (typeof onTemplateAppliedCallback === "function") {
    onTemplateAppliedCallback();
  }

  showToast(`Plantilla "${t.name}" cargada con éxito`, "success");
}
