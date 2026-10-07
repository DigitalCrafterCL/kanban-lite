// Sesión que caduca, desconexión automática, reenganche al volver a entrar con
// reconciliación (y conflictos decididos por el usuario), columnas del
// tablero y plantillas con columnas propias.
// Ejecutar con: npm run test:browser
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser, serveDist, killBrowsers, makeReporter, sleep } from "./harness.mjs";
import { main } from "../server/index.js";

const STATIC_PORT = 8372, API_PORT = 8373;
const APP = `http://127.0.0.1:${STATIC_PORT}/`;
const API = `http://127.0.0.1:${API_PORT}`;

const staticSrv = serveDist(STATIC_PORT);
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-reconexion-"));
const dbPath = path.join(dbDir, "e2e.db");
await main(["--db", dbPath, "--init", "--create-user", "ana", "--password", "contrasena-larga"]);
const api = await main(["--db", dbPath, "--port", String(API_PORT), "--host", "127.0.0.1"]);

const { check, report } = makeReporter("Reconexión, conflictos y columnas");
const page = await launchBrowser("ana", 9372);

const tok = async () => (await (await fetch(`${API}/api/login`, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "ana", password: "contrasena-larga" }) })).json()).token;
const serverBoard = async () => {
  const t = await tok();
  const { boards } = await (await fetch(`${API}/api/boards`, { headers: { Authorization: "Bearer " + t } })).json();
  const b = boards.find(x => x.name === "Equipo");
  const st = await (await fetch(`${API}/api/boards/${b.id}`, { headers: { Authorization: "Bearer " + t } })).json();
  return { id: b.id, version: st.version, state: st.state, token: t };
};
const entry = () => page.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
  .find(b=>b.name==='Equipo')`);
const addCard = (col, title) => page.ev(
  `const b=document.querySelector('[data-col="${col}"] .add-btn'); b.click();
   const f=b.parentNode.querySelector('.add-form');
   f.querySelector('.f-title').value=${JSON.stringify(title)};
   f.querySelector('.f-save').click();`);
const renameCard = async (from, to) => {
  await page.ev(`[...document.querySelectorAll('#board .card')]
    .find(c=>c.textContent.includes(${JSON.stringify(from)})).click()`);
  await sleep(250);
  await page.ev(`const t=document.getElementById('cdTitle'); t.value=${JSON.stringify(to)};
    t.dispatchEvent(new Event('blur'));`);
  await sleep(200);
  await page.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await sleep(200);
};

try {
  await page.goto(APP); await page.ev("localStorage.clear()"); await page.goto(APP);

  // == Plantillas con columnas propias ==
  await page.ev("document.getElementById('newBoardName').value='Mesa'; document.getElementById('newBoardCreate').click();");
  await sleep(400);
  const plantillas = await page.ev("return [...document.querySelectorAll('#templatesGrid .template-card-title')].map(t=>t.textContent)");
  check(["Soporte Técnico", "Comerciales", "Mantenimiento de Equipos"].every(n => plantillas.includes(n)),
    "el catálogo ofrece Soporte Técnico, Comerciales y Mantenimiento de Equipos", plantillas.join(", "));
  await page.ev(`[...document.querySelectorAll('#templatesGrid .template-card')]
    .find(c=>c.textContent.includes('Soporte Técnico')).click()`);
  await sleep(400);
  const cabeceras = await page.ev("return [...document.querySelectorAll('#board .col .name')].map(n=>n.textContent)");
  check(cabeceras[0] === "Recibidos" && cabeceras[4] === "Resueltos",
    "la plantilla de soporte trae sus propias columnas", cabeceras.join(", "));
  check(await page.ev("return document.querySelectorAll('#board .card').length") > 0, "y sus tarjetas de ejemplo");

  // == Conectar y crear el tablero compartido ==
  await page.ev("document.getElementById('resetBtn').click()"); await sleep(200);
  await page.ev(`document.querySelector('.bs-connect').open=true;
    document.getElementById('srvUrl').value='${API}';
    document.getElementById('srvUser').value='ana';
    document.getElementById('srvPass').value='contrasena-larga';
    document.getElementById('srvConnect').click();`);
  await page.waitFor(() => page.ev("return !!document.querySelector('.srv-block')"), "servidor conectado");
  await page.ev("[...document.querySelectorAll('.srv-btn')].find(b=>b.textContent==='+ Tablero').click()");
  await sleep(200);
  await page.ev(`const bar=document.querySelector('.srv-new');
    bar.querySelector('input').value='Equipo'; bar.querySelector('button').click();`);
  await page.waitFor(async () => (await page.status()) === "is-synced", "tablero compartido sincronizado");
  await addCard("todo", "Tarea A");
  await addCard("todo", "Tarea B");
  await page.waitFor(async () => (await serverBoard()).state.cards.length === 2, "tarjetas en el servidor");

  // == Columnas: nombre, posición y color ==
  await page.ev("document.getElementById('colsBtn').click()");
  await sleep(200);
  check(await page.ev("return document.getElementById('colsOverlay').classList.contains('open')"),
    "el menú abre el modal de columnas");
  await page.ev(`const i=document.querySelector('#colsList .col-row[data-col="backlog"] input[type=text]');
    i.focus(); i.value='Ideas'; i.dispatchEvent(new Event('input'));`);
  await page.ev(`document.querySelector('#colsList .col-row[data-col="backlog"] .col-move[data-dir="1"]').click()`);
  await page.ev(`const c=document.querySelector('#colsList .col-row[data-col="done"] input[type=color]');
    c.focus(); c.value='#e5484d'; c.dispatchEvent(new Event('input'));`);
  await sleep(200);
  const orden = await page.ev("return [...document.querySelectorAll('#board .col')].map(c=>c.dataset.col)");
  check(orden[0] === "todo" && orden[1] === "backlog", "mover una columna cambia su posición en el tablero", orden.join(","));
  check(await page.ev(`return document.querySelector('#board .col[data-col="backlog"] .name').textContent`) === "Ideas",
    "renombrar una columna cambia su cabecera");
  check(await page.ev(`return document.querySelector('#board .col[data-col="done"]').style.getPropertyValue('--kc')`) === "#e5484d",
    "recolorear una columna cambia su color");
  await page.ev("document.getElementById('colsClose').click()");
  await page.waitFor(async () => {
    const s = (await serverBoard()).state;
    return s.cols && s.cols[1].key === "backlog" && s.cols[1].name === "Ideas" && s.cols[4].color === "#e5484d";
  }, "columnas en el servidor");
  check(true, "las columnas se sincronizan con el servidor");

  // == La sesión caduca: el servidor responde 401 ==
  await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_servers'));
    s[0].token='token-caducado'; localStorage.setItem('kanban_servers', JSON.stringify(s));`);
  await page.ev("document.dispatchEvent(new Event('visibilitychange'))");
  await page.waitFor(async () => (await page.status()) === "is-detached", "desconexión automática");
  check(true, "al caducar la sesión el tablero se desconecta solo");
  const e1 = await entry();
  check(e1.kind === "local" && e1.detached && e1.detached.boardId, "pasa a local recordando su enlace");
  check(await page.ev(`return !!localStorage.getItem('kanban_synced_' + ${JSON.stringify(e1.slug)})`),
    "conserva la instantánea de la última sincronización");

  // Se sigue trabajando sin sesión…
  await addCard("todo", "Hecha sin sesion");
  await renameCard("Tarea A", "A desde el navegador");
  await renameCard("Tarea B", "B desde el navegador");
  check((await page.cards()).includes("Hecha sin sesion"), "se sigue trabajando en el tablero desconectado");

  // …y mientras tanto el equipo también.
  const sb = await serverBoard();
  const byT = Object.fromEntries(sb.state.cards.map(c => [c.t, c]));
  const r = await fetch(`${API}/api/boards/${sb.id}/sync`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sb.token },
    body: JSON.stringify({ baseVersion: sb.version, cards: [
      { ...byT["Tarea A"], t: "A desde el servidor" },
      { ...byT["Tarea B"], pri: "critica" },
      { id: "GEN-zz01", ws: "GEN", pri: "baja", col: "backlog", t: "Creada en el servidor", d: "" }
    ] })
  });
  check(r.ok, "el equipo edita el tablero en el servidor");

  // == Reconectar: reenganche y conflicto decidido por el usuario ==
  await page.ev("document.getElementById('syncStatus').click()");
  await page.waitFor(() => page.ev("return !!document.querySelector('.srv-reconnect input')"),
    "formulario de reconexión");
  check(true, "el indicador lleva a reconectar con usuario y servidor ya puestos");
  await page.ev(`document.querySelector('.srv-reconnect input').value='contrasena-larga';
    document.querySelector('.srv-reconnect button').click();`);
  await page.waitFor(() => page.ev("return document.getElementById('conflictOverlay').classList.contains('open')"),
    "modal de conflictos");
  const items = await page.ev("return [...document.querySelectorAll('#conflictList .conflict-item')].map(i=>i.textContent)");
  check(items.length === 1 && items[0].includes("A desde el navegador") && items[0].includes("A desde el servidor"),
    "sólo lo cambiado en los dos lados es conflicto", items.join(" | "));
  check((await entry()).kind === "remote", "el tablero se reengancha al volver a entrar");

  await page.ev("document.getElementById('conflictApply').click()");
  await sleep(200);
  check(await page.ev("return document.getElementById('conflictOverlay').classList.contains('open')"),
    "no se aplica nada sin decidir");
  await page.ev("document.querySelector('#conflictList input[value=theirs]').click()");
  await page.ev("document.getElementById('conflictApply').click()");
  await page.waitFor(async () => (await page.status()) === "is-synced", "sincronizado tras resolver");

  const fin = (await serverBoard()).state.cards;
  const t = Object.fromEntries(fin.map(c => [c.t, c]));
  check(t["A desde el servidor"] && !t["A desde el navegador"], "la decisión del usuario se respeta (servidor)");
  check(t["B desde el navegador"] && t["B desde el navegador"].pri === "critica",
    "cambios de campos distintos en la misma tarjeta se combinan");
  check(t["Hecha sin sesion"] && t["Creada en el servidor"], "lo creado en cada lado se conserva");
  check(JSON.stringify((await page.cards())) === JSON.stringify(fin.map(c => c.t).sort()),
    "el navegador queda igual que el servidor");

  // == Caducidad por reloj al abrir la app ==
  await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_servers'));
    s[0].expiresAt=Date.now()-1000; localStorage.setItem('kanban_servers', JSON.stringify(s));`);
  await page.goto(APP);
  await page.waitFor(async () => (await page.status()) === "is-detached", "desconectado al abrir");
  check(true, "una sesión vencida mientras la app estaba cerrada desconecta al abrir, sin red");
  await addCard("todo", "Sin conflictos");
  await page.ev("document.getElementById('resetBtn').click()"); await sleep(300);
  await page.waitFor(() => page.ev("return !!document.querySelector('.srv-reconnect input')"), "reconexión");
  await page.ev(`document.querySelector('.srv-reconnect input').value='contrasena-larga';
    document.querySelector('.srv-reconnect button').click();`);
  await page.waitFor(async () => (await serverBoard()).state.cards.some(c => c.t === "Sin conflictos"),
    "subida tras reconectar");
  check(true, "sin conflictos, lo hecho desconectado se sube solo al reconectar");

  // == Desconectar a mano también deja el tablero listo para volver ==
  await page.ev("[...document.querySelectorAll('.srv-btn')].find(b=>b.textContent==='Desconectar').click()");
  await page.waitFor(async () => (await entry()).detached, "desconexión manual");
  check((await entry()).kind === "local", "desconectar a mano deja el tablero como local enlazado");
  await page.ev(`document.querySelector('.bs-connect').open=true;
    document.getElementById('srvUrl').value='${API}';
    document.getElementById('srvUser').value='ana';
    document.getElementById('srvPass').value='contrasena-larga';
    document.getElementById('srvConnect').click();`);
  await page.waitFor(async () => (await entry()).kind === "remote", "reenganche tras conectar");
  check(true, "volver a conectar desde el formulario lo reengancha");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_boards')).filter(b=>b.name==='Equipo').length`) === 1,
    "sin entradas duplicadas del tablero");

  process.exitCode = report([page]) ? 1 : 0;
} finally {
  killBrowsers();
  staticSrv.close();
  api.closeAllConnections?.();
  await new Promise(r => api.close(r));
  fs.rmSync(dbDir, { recursive: true, force: true });
}
