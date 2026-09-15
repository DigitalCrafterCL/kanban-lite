// Sincronizacion destructiva: una copia local desincronizada intenta propagar
// "borra todo y mete esto otro" al tablero compartido.
// Ejecutar con: npm run test:browser
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchBrowser, serveDist, killBrowsers, makeReporter, sleep } from "./harness.mjs";
import { main } from "../server/index.js";

const STATIC = 8331, API_PORT = 8332;
const APP = `http://127.0.0.1:${STATIC}/`;
const API = `http://127.0.0.1:${API_PORT}`;

const staticSrv = serveDist(STATIC);
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-destr-"));
const dbPath = path.join(dbDir, "d.db");
await main(["--db", dbPath, "--init", "--create-user", "victor", "--password", "contrasena-larga"]);
const api = await main(["--db", dbPath, "--port", String(API_PORT), "--host", "127.0.0.1"]);

const { check, report } = makeReporter("Protección ante sincronización destructiva");
const page = await launchBrowser("victor", 9362);

const tok = async () => (await (await fetch(`${API}/api/login`, { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "victor", password: "contrasena-larga" }) })).json()).token;
const serverBoard = async (nombre) => {
  const t = await tok();
  const { boards } = await (await fetch(`${API}/api/boards`, { headers: { Authorization: "Bearer " + t } })).json();
  const b = boards.find(x => x.name === nombre);
  const st = await (await fetch(`${API}/api/boards/${b.id}`, { headers: { Authorization: "Bearer " + t } })).json();
  return { id: b.id, version: st.version, cards: st.state.cards.map(c => c.t).sort() };
};

try {
  await page.goto(APP); await page.ev("localStorage.clear()"); await page.goto(APP);
  await page.ev("document.getElementById('newBoardName').value='Local'; document.getElementById('newBoardCreate').click();");
  await sleep(400);
  await page.ev("document.getElementById('resetBtn').click()"); await sleep(200);
  await page.ev(`document.querySelector('.bs-connect').open=true;
    document.getElementById('srvUrl').value='${API}';
    document.getElementById('srvUser').value='victor';
    document.getElementById('srvPass').value='contrasena-larga';
    document.getElementById('srvConnect').click();`);
  await page.waitFor(() => page.ev("return !!document.querySelector('.srv-block')"), "servidor conectado");

  // Un tablero compartido con contenido de verdad
  await page.ev("[...document.querySelectorAll('.srv-btn')].find(b=>b.textContent==='+ Tablero').click()");
  await sleep(200);
  await page.ev(`const bar=document.querySelector('.srv-new'); bar.querySelector('input').value='EQUIPO';
    bar.querySelector('button').click();`);
  await page.waitFor(async () => await page.ev("return document.getElementById('headerTitle').textContent") === "EQUIPO", "EQUIPO activo");
  for (let i = 1; i <= 12; i++) {
    await page.ev(`const b=document.querySelector('[data-col="todo"] .add-btn'); b.click();
      const f=b.parentNode.querySelector('.add-form'); f.querySelector('.f-title').value='Trabajo real ${i}';
      f.querySelector('.f-save').click();`);
  }
  await page.waitFor(async () => await page.status() === "is-synced", "EQUIPO sincronizado");
  const antes = await serverBoard("EQUIPO");
  check(antes.cards.length === 12, "el tablero compartido tiene 12 tarjetas", `${antes.cards.length}`);

  // Simulamos el incidente: la copia local queda con contenido ajeno, tal como
  // pasó cuando el estado de otro tablero acabó guardado en este.
  await page.ev(`
    const slug = localStorage.getItem('kanban_active_board');
    const s = JSON.parse(localStorage.getItem('kanban_board_' + slug));
    s.cards = [{ id: 'AJENO-1', ws: s.ws[0].key, pri: 'media', col: 'todo', t: 'contenido de otro tablero', d: '' }];
    localStorage.setItem('kanban_board_' + slug, JSON.stringify(s));`);
  await page.goto(APP);
  await page.waitFor(async () => ["is-blocked", "is-synced", "is-pending"].includes(await page.status()), "sincronización intentada");
  await sleep(2500);

  const estado = await page.status();
  check(estado === "is-blocked", "el cliente queda en estado «frenada», no en error mudo", estado);

  const despues = await serverBoard("EQUIPO");
  check(JSON.stringify(despues.cards) === JSON.stringify(antes.cards),
    "el tablero compartido NO se tocó: las 12 tarjetas siguen ahí", JSON.stringify(despues.cards));

  // La UI ofrece salida
  await page.ev("document.getElementById('syncStatus').click()");
  await sleep(300);
  check(await page.ev("return document.getElementById('blockedOverlay').classList.contains('open')"),
    "pulsar el indicador abre el modal de resolución");
  check((await page.ev("return document.getElementById('blockedMsg').textContent")).includes("borrar"),
    "el modal explica cuántos elementos se borrarían");

  // Salida segura: descartar lo local y traer el servidor
  await page.ev("document.getElementById('blockedDiscard').click()");
  await page.waitFor(async () => (await page.cards()).length === 12, "tablero recargado del servidor");
  check(!(await page.cards()).includes("contenido de otro tablero"), "la copia local corrupta desapareció");
  check(await page.status() === "is-synced", "vuelve a estado sincronizado", await page.status());

  const final = await serverBoard("EQUIPO");
  check(JSON.stringify(final.cards) === JSON.stringify(antes.cards),
    "y el compartido sigue intacto tras resolver", JSON.stringify(final.cards));

  // El histórico existe y permite deshacer un borrado ya consumado
  const t = await tok();
  const hist = await (await fetch(`${API}/api/boards/${antes.id}/history`,
    { headers: { Authorization: "Bearer " + t } })).json();
  check(hist.history.length > 0, "el servidor archiva versiones anteriores", JSON.stringify(hist));

  process.exitCode = report([page]) ? 1 : 0;
} finally {
  killBrowsers(); staticSrv.close();
  api.closeAllConnections?.(); await new Promise(r => api.close(r));
  fs.rmSync(dbDir, { recursive: true, force: true });
}
