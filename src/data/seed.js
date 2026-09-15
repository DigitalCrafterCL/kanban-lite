export default {
  "rev": 3,
  "meta": {
      "eyebrow": "Guía Interactiva · Primeros Pasos",
      "title": "Kanban Lite",
      "titleThin": "· Tablero de Bienvenida",
      "subtitle": "Gestión ágil, offline-first y en un solo archivo",
      "branch": "v0.2.0"
  },
  "ws": [
      { "key": "GUIA", "label": "Primeros Pasos", "color": "#0a8fa6" },
      { "key": "FEAT", "label": "Funciones",      "color": "#6172f3" },
      { "key": "TIPS", "label": "Atajos & Tips",  "color": "#3aa03a" }
    ],
    cards: [
      { "id": "GUIA-1", "ws": "GUIA", "pri": "alta",    "col": "todo",       "t": "Arrastra esta tarjeta", "d": "Muévela a 'En progreso' arrastrándola, o abre su ficha con un clic y cambia la columna ahí." },
      { "id": "GUIA-2", "ws": "GUIA", "pri": "media",   "col": "todo",       "t": "Abre la ficha de una tarjeta", "d": "Haz clic en cualquier tarjeta para abrir su ficha: título, frente, prioridad, etiquetas, fecha de cierre, descripción y comentarios." },
      { "id": "FEAT-3", "ws": "FEAT", "pri": "alta",    "col": "todo",       "t": "Descripciones con formato", "d": "Usa **negrita**, *cursiva* y ~~tachado~~, y parte el texto en varias líneas.\n\nTambién listas de subtareas, que se marcan desde la propia tarjeta:\n- [x] Escribir la descripción\n- [ ] Marcar esta casilla\n- [ ] Ver el contador del pie" },
      { "id": "FEAT-1", "ws": "FEAT", "pri": "critica", "col": "inprogress", "t": "Buscador instantáneo", "d": "Presiona la tecla / para enfocar el buscador y filtrar tarjetas en tiempo real." },
      { "id": "FEAT-2", "ws": "FEAT", "pri": "alta",    "col": "inprogress", "t": "Límites WIP visibles", "d": "Esta columna tiene un límite sugerido de 6 tareas; el contador avisará si lo superas." },
      { "id": "TIPS-1", "ws": "TIPS", "pri": "media",   "col": "backlog",    "t": "Presiona ? para ver atajos", "d": "Descubre atajos como N para nueva tarea, Esc para cerrar y Ctrl+Z para deshacer." },
      { "id": "TIPS-2", "ws": "TIPS", "pri": "baja",    "col": "backlog",    "t": "Exporta tu trabajo con ⇅ Datos", "d": "Tus datos viven en tu navegador; descárgalos como .json cuando quieras respaldarlos." },
      { "id": "GUIA-0", "ws": "GUIA", "pri": "baja",    "col": "done",       "t": "Modo Pill en 'Hecho'", "d": "Las tarjetas completadas se compactan en una línea para no saturar la vista. ¡Haz clic para expandirme!" }
    ]
};
