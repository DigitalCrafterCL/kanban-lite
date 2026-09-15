// El incidente real: dos pestañas del MISMO navegador, cada una con un tablero
// compartido distinto. Comparten localStorage, así que si el estado en memoria
// no está atado a su tablero, una pestaña acaba guardando sobre el de la otra.
// Ejecutar con: npm run test:browser
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser, serveDist, killBrowsers, makeReporter, sleep, Page } from "./harness.mjs";
import { main } from "../server/index.js";

const STATIC = 8341, API_PORT = 8342;
const APP = `http://127.0.0.1:${STATIC}/`;
const API = `http://127.0.0.1:${API_PORT}`;
const DEBUG_PORT = 9364;

const staticSrv = serveDist(STATIC);
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-tabs-"));
const dbPath = path.join(dbDir, "t.db");
await main(["--db", dbPath, "--init", "--create-user", "victor", "--password", "contrasena-larga"]);
const api = await main(["--db", dbPath, "--port", String(API_PORT), "--host", "127.0.0.1"]);

const { check, report } = makeReporter("Dos pestañas, dos tableros compartidos");
const tab1 = await launchBrowser("pestaña1", DEBUG_PORT);

// Segunda pestaña en el MISMO navegador: comparte perfil y localStorage.
async function nuevaPestana(etiqueta) {
  const r = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP)}`,
    { method: "PUT" })).json();
  return await new Page(etiqueta, r.webSocketDebuggerUrl).open();
}

const tok = async () => (await (await fetch(`${API}/api/login`, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "victor", password: "contrasena-larga" }) })).json()).token;
const enServidor = async () => {
  const t = await tok();
  const { boards } = await (await fetch(`${API}/api/boards`, { headers: { Authorization: "Bearer " + t } })).json();
  const out = {};
  for (const b of boards) {
    const st = await (await fetch(`${API}/api/boards/${b.id}`, { headers: { Authorization: "Bearer " + t } })).json();
    out[b.name] = st.state.cards.map(c => c.t).sort();
  }
  return out;
};
const conectar = async (p) => {
  await p.ev("document.getElementById('resetBtn').click()");
  await sleep(250);
  await p.ev(`document.querySelector('.bs-connect').open=true;
    document.getElementById('srvUrl').value='${API}';
    document.getElementById('srvUser').value='victor';
    document.getElementById('srvPass').value='contrasena-larga';
    document.getElementById('srvConnect').click();`);
  await p.waitFor(() => p.ev("return !!document.querySelector('.srv-block')"), "servidor conectado");
};
const abrir = async (p, nombre) => {
  await p.ev("document.getElementById('resetBtn').click()");
  await p.waitFor(() => p.ev(`return [...document.querySelectorAll('.srv-board .bs-name')].some(b=>b.textContent.startsWith(${JSON.stringify(nombre)}))`), `${nombre} listado`);
  await p.ev(`[...document.querySelectorAll('.srv-board .bs-name')].find(b=>b.textContent.startsWith(${JSON.stringify(nombre)})).click()`);
  await p.waitFor(async () => await p.ev("return document.getElementById('headerTitle').textContent") === nombre, `${nombre} activo`);
};
const anadir = (p, t) => p.ev(
  `const b=document.querySelector('[data-col="todo"] .add-btn'); b.click();
   const f=b.parentNode.querySelector('.add-form'); f.querySelector('.f-title').value=${JSON.stringify(t)};
   f.querySelector('.f-save').click();`);

let tab2 = null;
try {
  await tab1.goto(APP); await tab1.ev("localStorage.clear()"); await tab1.goto(APP);
  await tab1.ev("document.getElementById('newBoardName').value='Local'; document.getElementById('newBoardCreate').click();");
  await sleep(400);
  await conectar(tab1);

  // Dos tableros compartidos con contenido claramente distinto
  for (const [nombre, tarjetas] of [["Alfa", ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]],
                                    ["Beta", ["N1", "N2", "N3"]]]) {
    await tab1.ev("[...document.querySelectorAll('.srv-btn')].find(b=>b.textContent==='+ Tablero').click()");
    await sleep(200);
    await tab1.ev(`const bar=document.querySelector('.srv-new'); bar.querySelector('input').value=${JSON.stringify(nombre)};
      bar.querySelector('button').click();`);
    await tab1.waitFor(async () => await tab1.ev("return document.getElementById('headerTitle').textContent") === nombre, `${nombre} activo`);
    for (const t of tarjetas) await anadir(tab1, t);
    await tab1.waitFor(async () => await tab1.status() === "is-synced", `${nombre} sincronizado`);
  }

  const inicial = await enServidor();
  check(inicial.Alfa.length === 8 && inicial.Beta.length === 3,
    "punto de partida: Alfa 8 tarjetas, Beta 3", JSON.stringify(inicial));

  // Pestaña 1 → Alfa
  await abrir(tab1, "Alfa");
  check((await tab1.cards()).length === 8, "pestaña 1 muestra Alfa");

  // Pestaña 2 (mismo navegador) → Beta
  tab2 = await nuevaPestana("pestaña2");
  await tab2.goto(APP);
  await abrir(tab2, "Beta");
  check((await tab2.cards()).length === 3, "pestaña 2 muestra Beta", JSON.stringify(await tab2.cards()));

  // Cada pestaña sigue en lo suyo: la 1 no debe haber saltado a Beta
  check((await tab1.ev("return document.getElementById('headerTitle').textContent")) === "Alfa",
    "la pestaña 1 sigue en Alfa después de que la 2 abriera Beta",
    await tab1.ev("return document.getElementById('headerTitle').textContent"));

  // Trabajo simultáneo en ambas, con tiempo para varios ciclos de sondeo
  await anadir(tab1, "nueva en Alfa");
  await anadir(tab2, "nueva en Beta");
  await sleep(14000);

  const final = await enServidor();
  check(JSON.stringify(final.Alfa) === JSON.stringify([...inicial.Alfa, "nueva en Alfa"].sort()),
    "Alfa conserva lo suyo y recibe su tarjeta nueva", JSON.stringify(final.Alfa));
  check(JSON.stringify(final.Beta) === JSON.stringify([...inicial.Beta, "nueva en Beta"].sort()),
    "Beta conserva lo suyo y recibe la suya: no fue arrasado", JSON.stringify(final.Beta));
  check(!final.Beta.some(t => t.startsWith("S")), "Beta NO contiene tarjetas de Alfa",
    JSON.stringify(final.Beta));

  // Y el almacenamiento local tampoco quedó cruzado
  const claves = await tab1.ev(`
    const out = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith('kanban_board_'))
      out[k.replace('kanban_board_','')] = JSON.parse(localStorage.getItem(k)).cards.map(c=>c.t).sort();
    return out;`);
  check(!(claves.beta || []).some(t => t.startsWith("S")),
    "la copia local de Beta no tiene tarjetas de Alfa", JSON.stringify(claves.beta));

  process.exitCode = report([tab1, tab2].filter(Boolean)) ? 1 : 0;
} finally {
  killBrowsers(); staticSrv.close();
  api.closeAllConnections?.(); await new Promise(r => api.close(r));
  fs.rmSync(dbDir, { recursive: true, force: true });
}
