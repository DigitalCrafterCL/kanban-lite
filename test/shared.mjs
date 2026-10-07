// Pruebas de tableros compartidos con dos navegadores reales contra el
// servidor real, incluido el contrato offline-first bajo un servidor caído.
// Ejecutar con: npm run test:browser
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser, serveDist, killBrowsers, makeReporter, sleep, ROOT_DIR } from "./harness.mjs";
import { main } from "../server/index.js";

const STATIC_PORT = 8312, API_PORT = 8313;
const APP = `http://127.0.0.1:${STATIC_PORT}/`;
const API = `http://127.0.0.1:${API_PORT}`;

const staticSrv = serveDist(STATIC_PORT);
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-e2e-"));
const dbPath = path.join(dbDir, "e2e.db");

for (const user of ["carlos", "jose"]) {
  await main(["--db", dbPath, "--init", "--create-user", user, "--password", "contrasena-larga"]);
}

let api = null;
const startApi = async () => { api = await main(["--db", dbPath, "--port", String(API_PORT), "--host", "127.0.0.1"]); };
const stopApi = async () => {
  if (!api) return;
  api.closeAllConnections?.();
  await new Promise(r => api.close(r));
  api = null;
};

const { check, report } = makeReporter("Tableros compartidos");
const carlos = await launchBrowser("carlos", 9352);
let jose = null;

const connect = async (page, user) => {
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(250);
  await page.ev(`document.querySelector('.bs-connect').open = true;
    document.getElementById('srvUrl').value='${API}';
    document.getElementById('srvUser').value='${user}';
    document.getElementById('srvPass').value='contrasena-larga';
    document.getElementById('srvConnect').click();`);
  await page.waitFor(() => page.ev("return !!document.querySelector('.srv-block')"), "bloque del servidor");
};

const addCard = (page, col, title) => page.ev(
  `const b=document.querySelector('[data-col="${col}"] .add-btn'); b.click();
   const f=b.parentNode.querySelector('.add-form');
   f.querySelector('.f-title').value=${JSON.stringify(title)};
   f.querySelector('.f-save').click();`);

try {
  // == El contrato: todo funciona con el servidor apagado ==
  await carlos.goto(APP);
  await carlos.ev("localStorage.clear()");
  await carlos.goto(APP);
  check(await carlos.ev("return document.getElementById('boardSelectorOverlay').classList.contains('open')"),
    "arranca con el servidor apagado");
  await carlos.ev("document.getElementById('newBoardName').value='Local de Carlos';" +
                  "document.getElementById('newBoardCreate').click();");
  await sleep(400);
  await addCard(carlos, "todo", "Tarea sin servidor");
  await sleep(250);
  check((await carlos.cards()).includes("Tarea sin servidor"), "se crean tarjetas sin servidor");
  check(await carlos.status() === "(oculto)", "sin sincronización el indicador no aparece");
  const external = await carlos.ev(
    `return performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('${APP}')).length`);
  check(external === 0, "sin servidores dados de alta no hay ni una petición de red", `peticiones=${external}`);

  // == Conectar y crear tablero compartido ==
  await startApi();
  await connect(carlos, "carlos");
  check(true, "conexión desde el navegador con CORS entre orígenes distintos");

  await carlos.ev("[...document.querySelectorAll('.srv-btn')].find(b=>b.textContent==='+ Tablero').click()");
  await sleep(250);
  await carlos.ev(`const bar=document.querySelector('.srv-new');
    bar.querySelector('input').value='Equipo'; bar.querySelector('button').click();`);
  await carlos.waitFor(async () => (await carlos.status()).startsWith("is-"), "indicador de sincronización");
  check(true, "al abrir un tablero compartido aparece el indicador");
  check(await carlos.ev("return document.getElementById('templatesOverlay').classList.contains('open')"),
    "un tablero compartido recién creado ofrece las plantillas, como uno local");
  await carlos.ev("document.getElementById('templatesClose').click()");

  for (const title of ["Tarea de Carlos", "Tarea compartida"]) {
    await addCard(carlos, "todo", title);
    await sleep(250);
  }
  await carlos.waitFor(async () => await carlos.status() === "is-synced", "carlos sincronizado");
  check(true, "los cambios locales suben solos");

  // == Invitar a jose ==
  await carlos.ev("document.getElementById('resetBtn').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.querySelector('.srv-members')"), "botón de miembros");
  await carlos.ev("document.querySelector('.srv-members').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.getElementById('memberAdd')"), "modal de miembros");
  await carlos.ev(`document.getElementById('memberName').value='jose';
    document.getElementById('memberRole').value='write';
    document.getElementById('memberAdd').click();`);
  await carlos.waitFor(async () =>
    (await carlos.ev("return [...document.querySelectorAll('.member-name')].map(e=>e.textContent)")).includes("jose"),
    "jose aparece como miembro");
  check(true, "el dueño invita a otro usuario con permiso de edición");
  await carlos.ev("document.getElementById('membersClose').click();" +
                  "document.getElementById('boardSelectorClose').click();");

  // == Jose entra desde otro navegador ==
  jose = await launchBrowser("jose", 9354);
  await jose.goto(APP);
  await jose.ev("localStorage.clear()");
  await jose.goto(APP);
  await jose.ev("document.getElementById('newBoardName').value='Local de Jose';" +
                "document.getElementById('newBoardCreate').click();");
  await sleep(400);
  await connect(jose, "jose");
  await jose.waitFor(() => jose.ev(
    "return [...document.querySelectorAll('.srv-board .bs-name')].some(b=>b.textContent.startsWith('Equipo'))"),
    "el tablero aparece en la lista del servidor");
  await jose.ev("[...document.querySelectorAll('.srv-board .bs-name')].find(b=>b.textContent.startsWith('Equipo')).click()");
  await jose.waitFor(async () => (await jose.cards()).includes("Tarea de Carlos"), "jose ve el trabajo de carlos");
  check(true, "el invitado abre el tablero y ve el contenido");
  check(!(await jose.cards()).includes("Tarea sin servidor"),
    "el tablero personal de carlos no se filtró al compartido");

  // == Edición simultánea ==
  await addCard(jose, "todo", "Tarea de Jose");
  await addCard(carlos, "backlog", "Otra de Carlos");
  await jose.waitFor(async () => (await jose.cards()).includes("Otra de Carlos"), "jose recibe lo de carlos");
  await carlos.waitFor(async () => (await carlos.cards()).includes("Tarea de Jose"), "carlos recibe lo de jose");
  const finalCarlos = await carlos.cards(), finalJose = await jose.cards();
  check(JSON.stringify(finalCarlos) === JSON.stringify(finalJose), "ambos convergen al mismo tablero",
    JSON.stringify({ finalCarlos, finalJose }));
  check(["Tarea de Carlos", "Tarea de Jose", "Otra de Carlos"].every(t => finalCarlos.includes(t)),
    "los cambios simultáneos sobreviven: nadie se pisa", JSON.stringify(finalCarlos));

  // == Borrado propagado ==
  await carlos.ev(`[...document.querySelectorAll('#board .card')]
      .find(c=>c.textContent.includes('Tarea compartida')).click();`);
  await sleep(300);
  await carlos.ev(`const del=document.getElementById('cdDelete'); del.click(); del.click();`);
  await jose.waitFor(async () => !(await jose.cards()).includes("Tarea compartida"), "el borrado llega a jose");
  check(true, "borrar una tarjeta se propaga al compañero");

  // == Etiquetas, fecha de cierre y comentarios entre dos clientes ==
  // Un campo nuevo de la tarjeta tiene que estar declarado en el servidor Y en
  // sync.js: si falta en el segundo, se pierde en cuanto llega un estado del
  // servidor, y eso no lo ve ninguna prueba unitaria.
  await carlos.ev(`[...document.querySelectorAll('#board .card')]
      .find(c=>c.textContent.includes('Tarea de Carlos')).click();`);
  await sleep(300);
  await carlos.ev(`const i=document.getElementById('cdLabelInput'); i.value='#api';
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    const d=document.getElementById('cdDue'); d.value='2026-12-24';
    d.dispatchEvent(new Event('change',{bubbles:true}));
    const t=document.getElementById('cdCommentText'); t.value='Comentario de Carlos';
    document.getElementById('cdCommentAdd').click();`);
  await sleep(300);
  await carlos.ev("document.getElementById('cardClose').click()");

  await jose.waitFor(async () => await jose.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Carlos'));
    return Boolean(c && c.querySelector('.clabel') && c.querySelector('.cdue'));`),
    "las etiquetas y la fecha llegan al compañero");
  check(await jose.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Carlos'));
    return c.querySelector('.clabel').textContent + '|' + c.querySelector('.ccomments').textContent.trim();`) === "#api|💬 1",
    "etiqueta, fecha y comentario cruzan la sincronización",
    await jose.ev(`const c=[...document.querySelectorAll('#board .card')].find(x=>x.textContent.includes('Tarea de Carlos')); return c.innerText;`));

  // Los dos comentan a la vez: la unión por id conserva ambos
  await jose.ev(`[...document.querySelectorAll('#board .card')]
      .find(c=>c.textContent.includes('Tarea de Carlos')).click();
    const t=document.getElementById('cdCommentText'); t.value='Comentario de Jose';
    document.getElementById('cdCommentAdd').click();`);
  await sleep(300);
  await jose.ev("document.getElementById('cardClose').click()");
  await carlos.waitFor(async () => await carlos.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Carlos'));
    const n=c && c.querySelector('.ccomments');
    return Boolean(n && n.textContent.includes('2'));`),
    "el comentario de jose llega a carlos sin borrar el suyo");
  check(true, "dos personas comentando la misma tarjeta conservan los dos comentarios");

  // == Bitácora del tablero compartido ==
  check(await carlos.ev("return document.getElementById('logBtn').hidden") === false,
    "en un tablero compartido aparece el botón de bitácora");
  check(await carlos.ev("return document.title") === "Equipo · Kanban Lite",
    "el title de la ventana lleva el nombre del tablero compartido",
    await carlos.ev("return document.title"));

  await carlos.ev("document.getElementById('logBtn').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.querySelector('#logList .log-entry')"),
    "entradas de la bitácora");
  const autores = await carlos.ev(
    "return [...document.querySelectorAll('#logList .log-author')].map(e=>e.textContent)");
  check(autores.includes("carlos") && autores.includes("jose"),
    "la bitácora atribuye los cambios a quien los hizo", JSON.stringify(autores));
  const bitacora = await carlos.ev("return document.getElementById('logList').textContent");
  check(bitacora.includes("Tarea de Jose") && bitacora.includes("creó"),
    "la bitácora describe las altas de tarjetas");
  check(bitacora.includes("eliminó") && bitacora.includes("Tarea compartida"),
    "la bitácora registra el borrado");
  await carlos.ev("document.getElementById('logClose').click()");

  // == Sólo lectura: ver y buscar, nada más ==
  // Carlos degrada a jose a permiso de lectura. Jose no se enteró todavía: su
  // índice local sigue diciendo "write". Esto reproduce el caso real —el rol
  // cambia con el tablero abierto— y comprueba las dos mitades del arreglo:
  // que la interfaz se bloquea, y que la sincronización sigue DESCARGANDO en
  // vez de quedarse atascada intentando subir lo que el servidor rechaza.
  await carlos.ev("document.getElementById('resetBtn').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.querySelector('.srv-members')"), "miembros");
  await carlos.ev("document.querySelector('.srv-members').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.getElementById('memberAdd')"), "modal de miembros");
  await carlos.ev(`document.getElementById('memberName').value='jose';
    document.getElementById('memberRole').value='read';
    document.getElementById('memberAdd').click();`);
  await sleep(600);
  await carlos.ev("document.getElementById('membersClose').click(); document.getElementById('boardSelectorClose').click();");

  const colAntes = await jose.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Jose'));
    return c.closest('.col').dataset.col;`);
  await jose.ev(`[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Jose')).click();`);
  await sleep(300);
  await jose.ev(`const c=document.getElementById('cdCol'); c.value='blocked';
    c.dispatchEvent(new Event('change',{bubbles:true}));`);

  await jose.waitFor(async () => await jose.status() === "is-readonly",
    "jose se entera de que ya sólo tiene lectura");
  check(true, "un envío rechazado por permisos deja el tablero en «sólo lectura», no en error");

  await jose.ev("document.getElementById('cardClose').click()");
  await jose.waitFor(async () => await jose.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarea de Jose'));
    return Boolean(c) && c.closest('.col').dataset.col === '${colAntes}';`),
    "lo que no se podía subir se descarta");
  check(true, "en sólo lectura la copia local no se queda divergente para siempre");

  const bloqueado = await jose.ev(`return {
      alta: document.querySelectorAll('#board .add-btn').length,
      arrastrables: [...document.querySelectorAll('#board .card')].filter(c=>c.getAttribute('draggable')==='true').length,
      buscador: !document.getElementById('searchInput').disabled
    };`);
  check(bloqueado.alta === 0 && bloqueado.arrastrables === 0 && bloqueado.buscador === true,
    "sin permiso de escritura no hay altas ni arrastre, pero sí buscador", JSON.stringify(bloqueado));

  await jose.ev("document.querySelector('#board .card').click()");
  await sleep(300);
  const ficha = await jose.ev(`return {
      aviso: !document.getElementById('cdReadOnly').hidden,
      titulo: document.getElementById('cdTitle').disabled,
      col: document.getElementById('cdCol').disabled,
      editarDesc: document.getElementById('cdDescEdit').hidden,
      borrar: document.getElementById('cdDelete').hidden,
      comentar: document.querySelector('.cd-comment-new').hidden,
      etiqueta: document.getElementById('cdLabelInput').hidden
    };`);
  check(Object.values(ficha).every(Boolean),
    "la ficha se abre para leer: campos inertes y fuera todo lo que escribiría",
    JSON.stringify(ficha));
  await jose.ev("document.getElementById('cardClose').click()");

  // Y lo que importa: sigue recibiendo el trabajo del equipo
  await addCard(carlos, "todo", "Tarea posterior de Carlos");
  await jose.waitFor(async () => (await jose.cards()).includes("Tarea posterior de Carlos"),
    "jose sigue recibiendo cambios en sólo lectura");
  check(await jose.status() === "is-readonly",
    "el indicador se queda en «sólo lectura» mientras descarga", await jose.status());

  // Los demás caminos de escritura también están cerrados
  await jose.ev("document.getElementById('cfgBtn').click()");
  await sleep(200);
  check(await jose.ev("return !document.getElementById('cfgOverlay').classList.contains('open')"),
    "el modal de frentes no se abre sin permiso de escritura");
  await jose.ev("document.getElementById('trashBtn').click()");
  await sleep(200);
  await jose.ev("const b=document.getElementById('trashClose'); if (b) b.click();");
  await sleep(150);

  // == Clonar un tablero compartido da una copia LOCAL ==
  // Vale incluso con permiso de sólo lectura: clonar no escribe en el
  // servidor, copia lo que ya tienes en el navegador.
  const tablerosAntes = (await carlos.ev("return JSON.parse(localStorage.getItem('kanban_boards')).length"));
  await jose.ev("document.getElementById('resetBtn').click()");
  await sleep(300);
  await jose.ev(`const r=[...document.querySelectorAll('.bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Equipo'));
    const b=r.querySelector('.bs-clone'); b.click(); b.click();`);
  await sleep(600);
  const clonJose = await jose.ev(`const idx=JSON.parse(localStorage.getItem('kanban_boards'));
    const e=idx.find(b=>b.name==='Equipo (copia)');
    const s=e ? JSON.parse(localStorage.getItem('kanban_board_'+e.slug)) : null;
    return { existe: !!e, kind: e && e.kind, remote: e && Boolean(e.remote),
             cards: s && s.cards.length, cols: s && [...new Set(s.cards.map(c=>c.col))].join(',') };`);
  check(clonJose.existe && clonJose.kind === "local" && clonJose.remote === false,
    "clonar un tablero compartido crea una copia local, no otro tablero del equipo",
    JSON.stringify(clonJose));
  check(clonJose.cards > 0 && clonJose.cols === "backlog",
    "el clon llega con las tarjetas del equipo, todas en Backlog", JSON.stringify(clonJose));
  check(await jose.status() === "(oculto)",
    "en el clon local no hay sincronización que valga", await jose.status());

  const enServidor = await carlos.ev(`const s=JSON.parse(localStorage.getItem('kanban_servers'))[0];
    const r=await fetch(s.url+'/api/boards',{headers:{Authorization:'Bearer '+s.token}});
    const d=await r.json();
    return d.boards.length;`);
  check(enServidor === 1, "el servidor sigue teniendo un solo tablero", String(enServidor));

  // Jose vuelve al tablero compartido
  await jose.ev("document.getElementById('resetBtn').click()");
  await sleep(300);
  await jose.ev("[...document.querySelectorAll('.bs-name')].find(b=>b.textContent.startsWith('Equipo') && !b.textContent.includes('copia')).click()");
  await sleep(600);

  // == El contrato bajo presión: se cae el servidor ==
  await stopApi();
  await addCard(carlos, "todo", "Escrita sin conexion");
  await sleep(500);
  check((await carlos.cards()).includes("Escrita sin conexion"), "con el servidor caído se sigue trabajando");
  await carlos.waitFor(async () => ["is-offline", "is-pending"].includes(await carlos.status()),
    "el indicador pasa a sin conexión");
  check(true, "el indicador avisa de la desconexión sin bloquear la interfaz");

  // == Vuelve el servidor ==
  await startApi();
  await carlos.waitFor(async () => await carlos.status() === "is-synced", "carlos vuelve a sincronizar", 30000);
  await jose.waitFor(async () => (await jose.cards()).includes("Escrita sin conexion"),
    "lo escrito sin conexión llega a jose", 30000);
  check(true, "al reconectar, lo escrito sin red sube solo y llega al compañero");

  // == Recarga en frío sin servidor ==
  await stopApi();
  await carlos.goto(APP);
  check((await carlos.cards()).includes("Escrita sin conexion"),
    "recargar sin servidor abre la copia local del tablero compartido");
  check(await carlos.ev("return document.getElementById('board').children.length > 0"),
    "el tablero renderiza completo sin red");

  // == Borrar un tablero compartido es reversible ==
  await startApi();
  await carlos.goto(APP);
  await carlos.ev("document.getElementById('resetBtn').click()");
  await carlos.waitFor(() => carlos.ev("return !!document.querySelector('.srv-board')"),
    "lista de tableros del servidor");
  await carlos.ev(`const fila=[...document.querySelectorAll('.srv-board')]
      .find(r=>r.querySelector('.bs-name').textContent.startsWith('Equipo'));
    const d=[...fila.querySelectorAll('.bs-delete')].pop(); d.click(); d.click();`);
  await carlos.waitFor(() => carlos.ev(
    "return !!document.querySelector('.srv-trash .bs-deleted')"), "papelera del servidor");
  check(await carlos.ev(`return document.querySelector('.srv-trash').textContent.includes('Equipo')`),
    "el tablero eliminado del servidor aparece como recuperable");
  check(await carlos.ev(`return [...document.querySelectorAll('.srv-boards .srv-board .bs-name')]
      .every(n=>!n.textContent.startsWith('Equipo'))`),
    "y desaparece de la lista de tableros vivos");
  check(await carlos.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
      .some(b=>b.name.startsWith('Equipo') && b.deletedAt)`),
    "la copia local también queda en la papelera, no borrada");

  await carlos.ev("document.querySelector('.srv-trash .bs-restore').click()");
  await carlos.waitFor(() => carlos.ev(
    `return [...document.querySelectorAll('.srv-boards .srv-board .bs-name')]
       .some(n=>n.textContent.startsWith('Equipo'))`), "el tablero vuelve a la lista");
  check(true, "restaurarlo en el servidor lo devuelve al equipo");

  await carlos.ev(`[...document.querySelectorAll('.srv-board .bs-name')]
      .find(b=>b.textContent.startsWith('Equipo')).click()`);
  await carlos.waitFor(async () => (await carlos.cards()).includes("Escrita sin conexion"),
    "el tablero recuperado abre con su contenido");
  check(true, "reabrirlo recupera la copia local y su contenido, sin duplicar la entrada");
  check(await carlos.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
      .filter(b=>b.name.startsWith('Equipo')).length`) === 1,
    "no queda una segunda entrada del mismo tablero compartido");

  process.exitCode = report([carlos, jose]) ? 1 : 0;
} finally {
  killBrowsers();
  staticSrv.close();
  await stopApi();
  fs.rmSync(dbDir, { recursive: true, force: true });
}
