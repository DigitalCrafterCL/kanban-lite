# Kanban Lite

> Tablero Kanban ligero, **offline-first** y de **un solo archivo**, para gestionar proyectos sin depender de servicios externos.
>
Kanban Lite es un tablero que se abre con doble clic, funciona sin conexión,
guarda los datos en el navegador y se comparte como un simple archivo `.html`
o `.json`.

---

## Qué hace hoy

El producto distribuible compilado vive en `dist/index.html` — un único archivo HTML autocontenido, sin dependencias de runtime ni de red: las tipografías van embebidas como `data:` URI, así que funciona igual con o sin conexión. Incluye:

- **Buscador rápido en tiempo real**: filtra tarjetas al instante por título, ID o descripción presionando <kbd>/</kbd>.
- **Atajos de teclado globales**: <kbd>/</kbd> buscar, <kbd>N</kbd> nueva tarea en Backlog, <kbd>V</kbd> pegar tarjetas, <kbd>M</kbd> menú, <kbd>Esc</kbd> cerrar/limpiar, <kbd>?</kbd> ayuda.
- **Historial Undo / Redo**: deshaz o rehaz movimientos y ediciones con <kbd>Ctrl+Z</kbd> y <kbd>Ctrl+Y</kbd>.
- **Pegar tarjetas desde el portapapeles**: <kbd>Ctrl/Cmd+V</kbd> sobre el tablero (o <kbd>V</kbd>) abre una vista previa —una línea, una tarjeta— donde eliges cuáles importar y fijas el **frente, la prioridad y la columna de cada tarjeta** (los selectores de cabecera aplican a toda la tanda). Limpia viñetas, numeración y las marcas de hora y autor que arrastra WhatsApp. Admite además el **formato completo** `ID | WS | prioridad | col | Título | Descripción`, que conserva identificadores y organización para volcar un tablero entero: los frentes que falten se crean y un ID ya usado llega desmarcado (si lo importas, recibe uno nuevo).
- **Borrado suave en todo**: las tarjetas y los frentes eliminados van a la **🗑 Papelera** del tablero (con restauración; un frente vuelve con las tareas que se le reasignaron) y los tableros eliminados quedan en **Tableros eliminados**, dentro de ⊞ Tableros, con todo su contenido hasta que los purgas a mano. En los tableros compartidos el borrado también es reversible en el servidor: su dueño los recupera desde la app o con `--undelete`.
- **Descripciones con texto enriquecido mínimo**: `**negrita**`, `*cursiva*`, `~~tachado~~`, saltos de línea, viñetas y **listas de subtareas** `- [ ]` que se marcan desde la propia tarjeta, con contador de progreso en el pie. El editor trae barra de formato y atajos (<kbd>Ctrl+B</kbd>, <kbd>Ctrl+I</kbd>, <kbd>Ctrl+Shift+X</kbd>) y <kbd>Enter</kbd> continúa la lista. Se guarda como texto plano con marcadores tipo Markdown, así que un tablero exportado sigue siendo legible en cualquier editor.
- **Barra superior en un menú**: todas las herramientas —tableros, plantillas, frentes, pegar, datos, papelera, atajos y tema— viven en <b>☰ Menú</b> (tecla <kbd>M</kbd>). El indicador de sincronización se queda fuera, siempre visible, porque avisa de que hay algo sin subir o de que el servidor no responde.
- **Descarga de la app para uso offline**: <b>⤓ Descargar app offline</b> guarda `kanban.html`, la aplicación completa en un archivo que funciona con doble clic y sin conexión. Es una copia limpia del propio archivo, sin el tablero de quien la descarga dentro.
- **Filtros de frente plegados**: se despliegan pulsando <b>Frente</b> (con muchos frentes, la fila de píldoras tapaba el resto de la barra). Plegado, el contador `3/9` avisa de que hay un filtro puesto y un botón lo limpia. La preferencia se recuerda.
- **Ficha de la tarjeta**: la tarjeta de la columna muestra un resumen (el extracto respeta el formato: nunca deja un `**` partido ni media casilla a la vista) y al hacer clic se abre centrada, con sitio para trabajar: id, título y frente arriba; a la izquierda **etiquetas** (`#hashtags`), **fecha de cierre** (avisa si vence pronto o ya venció), prioridad, columna y la descripción con su texto enriquecido; a la derecha los **comentarios** de la tarjeta. El buscador encuentra por etiqueta, con `#` o sin él.
- **Clonar un tablero**: con <b>⧉</b> en ⊞ Tableros arrancas otro con los mismos frentes y tarjetas, todas en <b>Backlog</b> —listo para una vuelta nueva del mismo trabajo—. No arrastra comentarios ni fechas de cierre, que son del ciclo anterior, y el clon es siempre local aunque el original sea compartido.
- **Multi-tablero**: varios tableros independientes en el mismo navegador, cada uno con su propio almacenamiento. El título de la ventana lleva el nombre del tablero activo.
- **Tableros compartidos (opcional)**: conéctate a un servidor propio para trabajar en equipo sobre los mismos tableros, con roles de edición y sólo lectura. Sigue funcionando sin conexión: los cambios se suben solos al reconectar.
- **Sólo lectura de verdad**: con permiso de lectura el tablero se ve, se busca y se filtra, pero la interfaz no deja editar —ni altas, ni arrastre, ni ficha editable— y el indicador muestra <b>👁 sólo lectura</b>. La sincronización sigue descargando el trabajo del equipo en todo momento.
- **Bitácora de cambios** en tableros compartidos: quién creó, movió, editó o borró qué, y cuándo. Se reconstruye en el servidor comparando las versiones archivadas, así que nunca se desincroniza del tablero real.
- **Catálogo de plantillas**: arranca con plantillas prediseñadas (Tutorial, Desarrollo de Software, Productividad Personal o Lienzo en blanco).
- **Límites WIP (*Work in Progress*)**: alertas visuales automáticas cuando una columna excede el límite sugerido.
- **Micro-notificaciones Toast**: retroalimentación visual no intrusiva al realizar acciones.
- **Columnas Kanban** (Backlog · Por hacer · En progreso · Bloqueado · Hecho) con contadores en vivo.
- **Tarjetas** con frente de trabajo, prioridad, título, descripción con formato, etiquetas, fecha de cierre y comentarios.
- **Vista compacta inteligente en 'Hecho'**: tarjetas estilo *pill* por defecto que se expanden al hacer clic.
- **Encabezado personalizable**: editar epígrafe, título, subtítulo y rama con persistencia local y en exportaciones.
- **Drag & drop** entre columnas; también se cambia la columna desde la ficha de la tarjeta.
- **Alta de tarjetas en línea**; la edición y el borrado, en la ficha.
- **Frentes de trabajo configurables**: crear, renombrar, recolorear y eliminar (con reasignación de tareas).
- **Filtros** por frente y por prioridad combinables con el buscador.
- **Tira de métricas** (total, pendientes, por columna) con los KPI de flujo:
  WIP contra el límite, Throughput semanal, mediana del Tiempo de Ciclo y
  tarjetas añejas.
- **Panel de métricas de flujo** (menú ☰ → 📈 Métricas): Tiempo de Ciclo y de
  Entrega, entregas por semana, distribución por tramos y edad del trabajo en
  curso por columna. Las tarjetas en curso muestran los días que llevan
  paradas, en ámbar o rojo según se pasen del umbral del tablero.
- **Tema claro/oscuro** con preferencia recordada.
- **Persistencia en `localStorage`** (tablero + frentes + encabezado) con migración por revisión.
- **Exportar / importar JSON** para respaldo o para mover el tablero entre equipos.

---

## Cómo ejecutarlo

### Como usuario (distribuible empaquetado)
No requiere instalación:

```bash
# Opción 1 — abrir directo
Abre dist/index.html en el navegador (doble clic).

# Opción 2 — servir el archivo compilado
npm run preview
```

### Como desarrollador (código fuente modular)

```bash
# Iniciar servidor local de desarrollo con módulos ES nativos (src/):
npm run dev
# luego visita http://localhost:8080

# Compilar los módulos de src/ a archivo único distribuible (dist/index.html):
npm run build
```

---

## Trabajo en equipo (opcional)

Kanban Lite sigue siendo local-first: si no configuras nada, tus tableros no
salen nunca de tu navegador. Pero puedes levantar un servidor propio para
compartir tableros con tu equipo.

```bash
node server/index.js --db ./kanban.db --create-user carlos   # crear usuario
node server/index.js --db ./kanban.db --port 8090            # arrancar
```

Cada persona se conecta desde **⊞ Tableros → + Conectar a un servidor** con la
dirección, su usuario y su contraseña. Los tableros compartidos aparecen junto a
los personales, marcados con una etiqueta.

Detalles importantes:

- **Sin dependencias.** El servidor usa sólo `node:http`, `node:sqlite` y
  `node:crypto`. Necesita Node 22 o superior.
- **Fusión por tarjeta.** Si Carlos mueve una tarjeta y José edita otra al mismo
  tiempo, sobreviven los dos cambios. Sólo hay conflicto si dos tocan la misma
  tarjeta, y entonces gana quien guarda último y la app avisa.
- **Sigue funcionando sin red.** Con el servidor caído puedes seguir trabajando
  en el tablero compartido; lo que escribas se sube solo al reconectar.
- **Pensado para LAN o VPN.** No habla HTTPS por sí mismo. Si lo expones a
  internet, ponle delante un proxy con TLS.

Todo esto está detallado en [`server/README.md`](server/README.md).

---

## Pruebas

```bash
npm test              # fusión y API del servidor
npm run test:browser  # navegador real: modo local y tableros compartidos
npm run test:all      # todo
```

Las pruebas de navegador hablan el protocolo DevTools directamente, sin
Puppeteer ni Playwright. Necesitan Chrome o Chromium; si no está en la ruta
habitual, define `CHROME_PATH`.

---

## Estructura del repositorio

```
kanban-lite/
+-- dist/
|   \-- index.html              <- Archivo único distribuible (generado por el build)
+-- package.json                <- Scripts de desarrollo, compilación y pruebas
+-- scripts/
|   +-- build.js                <- Bundler a archivo único (zero dependencies)
|   \-- dev.js                  <- Servidor local para desarrollo modular
+-- server/                     <- Backend OPCIONAL de tableros compartidos (ver server/README.md)
+-- test/                       <- Pruebas de navegador (protocolo DevTools, sin dependencias)
+-- src/                        <- Código fuente modular
|   +-- index.html              <- Plantilla de desarrollo HTML
|   +-- css/
|   |   +-- variables.css       <- Variables de color, tipografía y temas claro/oscuro
|   |   +-- fonts.css           <- @font-face de las tipografías locales
|   |   +-- base.css            <- Estilos globales, reset y tipografía
|   |   +-- components/         <- Estilos por componente (header, filters, board, toast, modal, etc.)
|   |   \-- main.css            <- Punto de entrada CSS
|   +-- data/
|   |   \-- seed.js             <- Semilla del tablero de bienvenida
|   \-- js/
|       +-- config.js           <- Columnas, prioridades, límites WIP y configuración
|       +-- boardselector.js    <- Índice multi-tablero y modal de selección
|       +-- remote.js           <- Cliente HTTP del backend opcional
|       +-- sync.js             <- Sincronización de tableros compartidos
|       +-- servers.js          <- UI de servidores, tableros compartidos y miembros
|       +-- toast.js            <- Sistema de micro-notificaciones Toast
|       +-- store.js            <- Estado reactivo, persistencia y Undo/Redo
|       +-- header.js           <- Personalización y render del encabezado
|       +-- theme.js            <- Tema claro / oscuro
|       +-- filters.js          <- Filtros de frentes, prioridades y buscador
|       +-- stats.js            <- Tira de contadores y KPI de la cabecera
|       +-- metrics.js          <- Sellado de fechas y cálculo del flujo
|       +-- metricsui.js        <- Panel de métricas
|       +-- dnd.js              <- Controladores de Drag & Drop
|       +-- richtext.js         <- Texto enriquecido de las descripciones (render, resumen y editor)
|       +-- carddetail.js       <- Ficha central: etiquetas, fecha de cierre y comentarios
|       +-- headmenu.js         <- Menú de la barra superior y copia offline
|       +-- cards.js            <- Tarjetas, modo pill y formularios
|       +-- frentes.js          <- Modal de frentes de trabajo
|       +-- io.js               <- Exportar, importar y reiniciar
|       +-- templates.js        <- Catálogo de plantillas predefinidas
|       +-- hotkeys.js          <- Atajos de teclado y modal de ayuda
|       +-- trash.js            <- Papelera del tablero y restauración
|       +-- paste.js            <- Pegar tarjetas del portapapeles con vista previa
|       +-- bitacora.js         <- Bitácora de cambios de un tablero compartido
|       +-- render.js           <- Coordinador de renderizado
|       +-- utils.js            <- Helpers y utilidades
|       \-- app.js              <- Punto de entrada JavaScript
+-- assets/
|   \-- fonts/                  <- Tipografías .woff2 locales (embebidas en el build)
\-- LICENSE                     <- Licencia MIT del proyecto
```

---

## Estado y roadmap

- [x] **Fase 0 — Extracción:** Repo propio y prototipo funcional.
- [x] **Fase 1 — Refactor:** Desmontar `index.html` en módulos bajo `src/` con bundler a archivo único.
- [x] **Fase 2 — Generalización:** Tablero de bienvenida neutro, plantillas, columnas y prioridades configurables.
- [x] **Fase 3 — Multi-tablero:** Selector de tableros, historial undo/redo y backend compartido opcional.
- [ ] **Fase 4 — Distribución:** PWA instalable, exportación a PDF.

---

## Licencia

MIT — ver [`LICENSE`](LICENSE). Autor: Víctor Garrido.

Las tipografías incluidas en `assets/fonts/` (IBM Plex Sans, IBM Plex Mono y Chakra Petch)
se distribuyen bajo la SIL Open Font License 1.1; ver [`assets/fonts/LICENSE-FONTS.md`](assets/fonts/LICENSE-FONTS.md).
