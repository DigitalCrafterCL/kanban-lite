# Changelog

Formato: una entrada por día de trabajo, de lo más reciente a lo más antiguo.
Se anotan los cambios visibles y las decisiones que condicionan el código
futuro.

## 2026-09-08 · métricas de flujo

### Añadido
- **KPI de flujo en la cabecera**: `WIP` activo sobre la suma de límites (con
  barra de ocupación, y aviso en rojo si alguna columna pasa el suyo),
  `Throughput` de los últimos 7 días, `Ciclo p50` y `⚑ Añejas`.
- **Panel «📈 Métricas»** en el menú de la barra superior: Throughput a 7 y 30
  días, Tiempo de Ciclo y de Entrega (p50 y p85), entregas por semana, la
  distribución del ciclo por tramos y una tabla por columna con la edad media,
  la máxima y la tarjeta más añeja. Las barras son CSS puro: no hay librería de
  gráficos y no la va a haber.
- **Píldora de edad en la tarjeta** en curso: los días que lleva parada en su
  columna, en ámbar al pasar el umbral del tablero y en rojo al doblarlo. El
  umbral es el p85 del Tiempo de Ciclo propio cuando hay al menos cinco
  tarjetas cerradas con historia; si no, 5 y 10 días.
- **Cuatro fechas nuevas en la tarjeta** (`rev 4`): `cr` creada, `st` entró a
  trabajo, `dn` terminada y `ca` entró a la columna actual. Sin ellas no había
  con qué medir nada: la tarjeta sólo guardaba `due`, que es una intención, no
  un hecho observado.

### Notas para quien siga
- Los sellos son **cadenas escalares** y no un
  registro de eventos a propósito: una lista exigiría unión por id y lápidas
  como los comentarios, crecería sin techo y `sync.js` tendría que
  compararla por valor en cada sondeo.
- **No metas los sellos en `DIFF_CARD_FIELDS`.** El movimiento se reconoce en
  `server/merge.js` por `fields` igual a `["col"]` a secas; con `ca` dentro,
  todo movimiento pasaría a ser una edición y la bitácora dejaría de decir
  «movió X de A a B». Hay una prueba que lo vigila.
- Un tablero que ya existía se selló con la fecha de la migración, así que sus
  tarjetas cerradas tienen `cr === dn`: cuentan para el Throughput pero quedan
  fuera de los percentiles, o la mediana se hundiría a cero. El panel lo dice.
- El primer envío tras actualizar sube el tablero entero (una versión). No
  dispara el freno de sincronización destructiva, que mira borrados.
- Al añadir un contenedor que se pinte desde el estado, acuérdate de la lista
  de `snapshotDocument()` en `io.js`: `metricsBody` está ahí para que la copia
  offline que se comparte no lleve dentro las métricas de quien la descarga.

## 2026-09-04 · clonar tableros

### Añadido
- **Clonar un tablero** desde ⊞ Tableros (botón <b>⧉</b> en cada fila, con
  confirmación en dos clics). El tablero nuevo conserva los frentes y las
  tarjetas —título, descripción, etiquetas, prioridad y frente— y **todas las
  tarjetas caen en Backlog**: clonar es empezar otra vuelta del mismo trabajo.
  Al terminar se abre el clon.
  - **No viajan los comentarios ni las fechas de cierre**: son del ciclo
    anterior; una fecha pasada marcaría el tablero nuevo entero como vencido
    el primer día.
  - **El clon es siempre local**, aunque el original sea compartido: copia lo
    que hay en el navegador, no crea nada en el servidor. Así clonar funciona
    sin red y con permiso de sólo lectura.
  - El nombre se desambigua solo: «X (copia)», «X (copia 2)»…

### Notas para quien siga
- Si el `localStorage` no acepta el estado del
  clon, se deshace el alta con `purgeBoard()`: una entrada en el índice sin
  contenido abriría vacía y parecería que el clonado perdió el trabajo.
- `test/shared.mjs` comprueba que clonar un tablero compartido **no** añade
  tableros en el servidor y que el clon no hereda la entrada `remote`.

## 2026-09-04 · sólo lectura

### Corregido
- **Los tableros compartidos de sólo lectura eran de sólo lectura sólo en el
  servidor.** La interfaz dejaba editar: el cambio se guardaba en local, el
  envío se rechazaba con `403` y —como el cliente sólo descarga cuando no
  tiene nada pendiente— **dejaba de recibir también el trabajo de los demás**.
  Un solo clic congelaba el tablero en «error de sincronización» para siempre.
  Ahora:
  - Sin permiso de escritura no hay altas, ni arrastre, ni marcar subtareas, y
    la ficha se abre **para leer**: campos inertes, sin ✎ Editar, sin
    Eliminar, sin caja de comentarios y con un aviso <b>👁 Sólo lectura</b>.
    Buscar y filtrar siguen funcionando.
  - Los demás caminos de escritura también están cerrados: papelera (restaurar),
    frentes, encabezado, plantillas, importación, pegado y deshacer/rehacer.
  - La sincronización **nunca sube y siempre descarga**. Lo que haya quedado
    divergente se descarta contra la última instantánea *antes* de hablar con
    el servidor, con aviso al usuario.
  - Un `403` en un envío hace que el cliente apunte el rol `read` en su índice:
    si el dueño te quita el permiso con el tablero abierto, la interfaz se
    bloquea al instante en vez de reintentar en bucle.
- El indicador gana el estado **👁 sólo lectura**, que no es un error: es el
  modo del tablero.

### Notas para quien siga
- `isReadOnlyBoard()` y
  `denyReadOnly()` viven en `sync.js` y son la fuente de la verdad; todo punto
  de escritura nuevo tiene que pasar por ellos.
- Descartar la divergencia hay que hacerlo **antes** de la petición: si el
  tablero no cambió, el servidor contesta `304` y la copia local divergente
  sobreviviría a la respuesta.
- `test/shared.mjs` cubre el caso real —el dueño degrada a un compañero con el
  tablero abierto— y comprueba las dos mitades: que la interfaz se bloquea y
  que las descargas siguen llegando.

## 2026-09-03 · barra superior, filtros plegados y copia offline

### Añadido
- **Menú en la barra superior.** Las nueve herramientas pasan a un desplegable
  <b>☰ Menú</b> (tecla <kbd>M</kbd>): con todas sueltas, la cabecera se partía
  en dos filas y competía con el título del tablero. El **indicador de
  sincronización se queda fuera y siempre visible**: avisa de que hay cambios
  sin subir o de que el servidor no responde, y eso no puede depender de que
  alguien abra un menú.
- **Descargar la app para usarla sin conexión.** Guarda `kanban.html`: la
  aplicación completa en un archivo, que funciona con doble clic y sin red.
- **Filtros de frente plegados por defecto**, con la preferencia recordada. Un
  tablero con nueve o diez frentes llenaba la barra de píldoras y dejaba el
  buscador y las prioridades donde no se veían. Plegado, el contador (`3/9`) y
  un botón de limpiar avisan de que hay un filtro puesto.

### Cambiado
- **La tarjeta de la columna deja de tener controles de edición**: fuera las
  flechas ‹ › y el lápiz ✎, y con ellos el editor en línea. Se edita en la
  ficha y sólo ahí; para mover una tarjeta, arrastrarla o cambiar su columna en
  la ficha. Dos editores del mismo dato eran dos sitios donde arreglar cada
  error.
- Los textos de la plantilla de bienvenida y de la ayuda del pie ya no
  describen botones que no existen.

### Notas para quien siga
- Los avisos van fuera del menú y las
  acciones dentro; la copia offline se obtiene **releyendo el propio archivo**
  (`fetch(location.href)`), nunca serializando el DOM vivo —eso metería el
  tablero de quien la descarga en un archivo que se comparte—, y se comprueba
  que lo recibido sea la app antes de entregarlo.
- Los botones conservan sus identificadores dentro del menú, así que ningún
  módulo tuvo que enterarse del cambio.

## 2026-09-03 · ficha de la tarjeta

### Añadido
- **Ficha de la tarjeta.** La tarjeta de la columna pasa a ser un resumen y al
  hacer clic se abre centrada en pantalla, con espacio para trabajar: arriba
  id, título y frente; abajo dos columnas —etiquetas, fecha de cierre,
  prioridad, columna y la descripción con su texto enriquecido a la izquierda;
  los comentarios a la derecha. El lápiz ✎ sigue abriendo la edición rápida en
  línea y el ▼ de la columna «Hecho» sigue desplegando la pill.
- **Etiquetas (`#hashtags`)** por tarjeta, hasta 8. Se normalizan (sin `#`, en
  minúsculas, espacios a guiones), se ven como píldoras en la tarjeta —tres y
  el resto contado— y el **buscador las encuentra** escribiendo `api` o `#api`.
- **Fecha de cierre** por tarjeta, con aviso de cuánto queda y píldora en la
  tarjeta que se pinta en ámbar si cierra en dos días o menos y en rojo si ya
  venció.
- **Comentarios** por tarjeta, con autor (el usuario del servidor en un tablero
  compartido, «yo» en uno local), fecha relativa y texto enriquecido. La
  tarjeta muestra 💬 con el número. La bitácora registra quién comentó qué.
- **Resumen automático de la descripción** en la tarjeta: se recorta el texto
  origen (150 caracteres, 4 líneas), se cierran los marcadores partidos y se
  descarta una línea cuyo corte cayera dentro del marcador de una lista.

### Cambiado
- `SEED_REV` sube a **3**: la tarjeta gana `labels`, `due` y `comments`. El
  parche de migración es idempotente y rellena los campos que falten.
- El **importador aplica las migraciones**: antes, un respaldo de una revisión
  anterior entraba en memoria sin los campos que la interfaz espera hasta la
  siguiente recarga.
- Se quita el «corte al <fecha>» del encabezado, que ya no significaba nada
  (con él, la función `initDateTag`).

### Notas para quien siga
- Reglas de consistencia para tarjetas compartidas:
  - Los **comentarios son de sólo añadir**. El servidor los une por id
    (`mergeComments`) y una sincronización que sólo añade comentarios no es
    conflicto; así dos personas que comentan la misma tarjeta a la vez no
    pierden nada. Permitir borrarlos exige antes lápidas como las de tarjetas.
  - Un **campo nuevo de la tarjeta va en tres sitios**: `CARD_FIELDS` del
    servidor, `CARD_FIELDS` de `sync.js` y `DIFF_CARD_FIELDS`. Si falta el de
    `sync.js`, el campo desaparece en cuanto llega un estado del servidor.
  - Las listas se comparan **por valor**: dos arreglos nunca son `===`, y con
    `===` el cliente subiría el tablero entero en cada sondeo y el servidor
    quemaría una versión por tarjeta.
- El recorte del resumen se hace sobre el **texto origen**, nunca sobre el
  HTML: recortar HTML parte etiquetas.
- La ficha se repinta con cada `notify()` del store (deshacer, sincronización) y
  atiende `Escape` en **fase de captura**, porque `hotkeys.js` quita el foco del
  campo antes de que llegue la burbuja.

## 2026-09-03 · texto enriquecido

### Añadido
- **Texto enriquecido mínimo en las descripciones de las tarjetas**: negrita,
  cursiva, tachado, saltos de línea, viñetas y **listas de subtareas** con
  casillas `- [ ]` que se marcan desde la propia tarjeta. El pie de la tarjeta
  muestra un contador de progreso (`☑ 2/5`) que se pone en verde al completar
  todas.
- El editor de tarjetas (alta y edición) trae **barra de formato** y atajos:
  <kbd>Ctrl+B</kbd>, <kbd>Ctrl+I</kbd>, <kbd>Ctrl+Shift+X</kbd>, y
  <kbd>Enter</kbd> continúa la lista en la que estás (en un elemento vacío, la
  cierra). Los atajos aparecen en el modal de <kbd>?</kbd>.
- La semilla y la plantilla de bienvenida incluyen una tarjeta que enseña el
  formato.

### Cambiado
- La descripción admite hasta **2000 caracteres** (antes 320): con listas de
  subtareas el párrafo suelto se quedaba corto. El servidor pasa a tener un
  tope propio para ese campo (`MAX_STR_DESC`), separado del resto.

### Notas para quien siga
- La descripción sigue siendo **texto plano con marcadores tipo Markdown**, no
  HTML: nada de modelo de datos nuevo, nada de migración de `SEED_REV`, y un
  tablero exportado se sigue leyendo en cualquier editor. El render escapa
  primero y aplica los marcadores después (`src/js/richtext.js`); si añades un
  marcador, hazlo en `rtInline()`.
- Las casillas guardan su índice de línea en `data-line`; `toggleTask()`
  devuelve `null` si esa línea ya no es una subtarea, que es lo que pasa cuando
  la descripción cambió por debajo (deshacer, importación o sincronización).
- `MAX_DESC` (cliente) y `MAX_STR_DESC`
  (servidor) van atados: subir uno sin el otro trunca en silencio.

## 2026-09-01

### Añadido
- **Borrado suave en todas las eliminaciones.** Tarjetas y frentes van a la
  **papelera del tablero** (`🗑 Papelera`, con contador y restauración); al
  restaurar un frente vuelven con él las tareas que se le habían reasignado, si
  nadie las movió entretanto. Los **tableros eliminados** conservan su
  contenido y se recuperan desde «Tableros eliminados» en ⊞ Tableros; el
  borrado definitivo es una acción aparte, con confirmación en dos pasos.
- En el **servidor**, `DELETE /api/boards/:id` pasa a marcar `deleted_at`: el
  tablero desaparece para el equipo (404 en todas las rutas) pero conserva
  estado, miembros e histórico. Recuperación con `POST .../undelete`,
  `GET /api/boards?deleted=1` o `--undelete` por consola; el borrado real exige
  `?purge=1` y sólo sobre un tablero ya eliminado.
- Reabrir un tablero compartido desde el servidor **recupera su copia local** si
  estaba en la papelera, en vez de crear una segunda entrada del mismo tablero.
- **Formato completo al pegar**: además del texto suelto, el pegado acepta
  `ID | WS | prioridad | col | Título | Descripción` — pensado para volcar un
  tablero o el histórico de un proyecto conservando su organización. Se
  reconoce por la forma de la línea (los campos 3 y 4 han de ser una prioridad
  y una columna válidas), no por una cabecera, así que una línea suelta con
  barras verticales sigue leyéndose como título y descripción. Las líneas que
  empiezan por `#` se ignoran, la prioridad y la columna valen por clave o por
  nombre (con o sin tildes) y la descripción conserva sus barras.
- La vista previa añade **columna de destino por tarjeta** (antes todo entraba
  en Backlog) y muestra el **ID** que traía cada línea.
- Los **frentes que el tablero no tenía se crean al importar**, con un color de
  la paleta. Sin eso, volcar un tablero ajeno perdía su organización y todo
  caía en el primer frente.

### Notas para quien siga
- Ningún
  borrado es definitivo a la primera, y la papelera vive **fuera** del estado
  sincronizado (el servidor descartaría un campo que no conoce).
- Los borrados que llegan de un compañero no entran en la papelera local: para
  eso están el histórico del servidor y la bitácora.
- Un ID ya presente en el tablero llega **desmarcado** y, si se importa de
  todos modos, recibe un ID nuevo: repegar la misma lista es el caso común, y
  duplicar un histórico entero en silencio es caro de deshacer. Dos IDs iguales
  romperían además la fusión por entidad del servidor.
- Los selectores de cabecera sólo pisan las filas que **no** traían el dato en
  el texto pegado.

## 2026-08-31

### Añadido
- **Bitácora de cambios en tableros compartidos** (`🕘 Bitácora`): quién creó,
  movió, editó o borró qué, y cuándo. Se **deriva** del histórico que el
  servidor ya archivaba (`GET /api/boards/:id/log` compara cada versión
  guardada con la siguiente), en vez de llevar una tabla de eventos aparte que
  mentiría tras un `--restore` o una poda del histórico. El botón sólo aparece
  en tableros compartidos; sin red avisa en lugar de fallar en silencio.
- **Pegar tarjetas desde el portapapeles**: <kbd>Ctrl/Cmd+V</kbd> sobre el
  tablero, la tecla <kbd>V</kbd> o el botón `⎗ Pegar`. Una línea, una tarjeta;
  se limpian viñetas, numeración y las marcas de hora y autor de WhatsApp. La
  vista previa deja desmarcar lo que no entra, corregir títulos y elegir
  **frente y prioridad por tarjeta** (los selectores de cabecera fijan los de
  toda la tanda). Todo entra en Backlog.
- El **título de la ventana** lleva el nombre del tablero activo, que con
  varias pestañas abiertas es lo único que las distingue en la barra del
  navegador.

### Cambiado
- La tecla <kbd>N</kbd> abre el formulario en **Backlog**, no en «Por hacer»:
  una idea recién capturada todavía no está comprometida para el ciclo actual.

### Notas para quien siga
- La bitácora se deriva del histórico, nunca se registra aparte. Toda ruta que
  escriba estado debe archivar el anterior y la bitácora queda correcta sola.
- Cobertura: 41 pruebas de servidor (`npm test`) y 75 comprobaciones de
  navegador (`npm run test:browser`), incluida la bitácora con dos navegadores
  reales contra el servidor real.
