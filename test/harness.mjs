// Utilidades compartidas por las pruebas de navegador.
//
// Habla el protocolo DevTools directamente por WebSocket: sin Puppeteer ni
// Playwright, para no romper la regla de cero dependencias del proyecto.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIST_HTML = path.join(ROOT_DIR, "dist", "index.html");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "No se encontró Chrome. Instálalo o define CHROME_PATH=/ruta/al/binario."
    );
  }
  return found;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sirve dist/index.html. Se usa un puerto distinto al del API a propósito, para
// que las pruebas ejerciten la ruta CORS entre orígenes distintos.
export function serveDist(port) {
  if (!fs.existsSync(DIST_HTML)) {
    throw new Error("Falta dist/index.html. Ejecuta primero: npm run build");
  }
  return http.createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(DIST_HTML));
  }).listen(port);
}

const processes = [];
const profiles = [];

export function killBrowsers() {
  for (const p of processes) { try { p.kill(); } catch {} }
  for (const d of profiles) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  processes.length = 0;
  profiles.length = 0;
}

/**
 * Lanza un Chrome headless independiente y devuelve su página.
 *
 * Un proceso por "persona", no varias pestañas: Chrome estrangula los
 * temporizadores de las pestañas en segundo plano, así que dos pestañas no
 * simulan a dos personas trabajando a la vez.
 */
export async function launchBrowser(label, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-${label}-`));
  profiles.push(profile);
  const proc = spawn(findChrome(), [
    "--headless=new", `--remote-debugging-port=${port}`, "--no-first-run",
    "--disable-gpu", "--window-size=1400,900", `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });
  processes.push(proc);

  let targets = [];
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some(t => t.type === "page")) break;
    } catch { /* todavía arrancando */ }
    await sleep(250);
  }
  const target = targets.find(t => t.type === "page");
  if (!target) throw new Error(`[${label}] Chrome no expuso ninguna página`);
  return await new Page(label, target.webSocketDebuggerUrl).open();
}

export class Page {
  constructor(label, wsUrl) {
    this.label = label;
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise(r => this.ws.addEventListener("open", r));
    this.ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        this.errors.push(`[${this.label}] EXCEPTION ${d.exception?.description || d.text}`);
      }
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
        this.errors.push(`[${this.label}] console.${m.params.type} ` +
          m.params.args.map(a => a.value ?? a.description).join(" "));
      }
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // El cuerpo se envuelve en una función async: usa `return` para devolver valor.
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async()=>{${expression}})()`,
      awaitPromise: true,
      returnByValue: true
    });
    const details = r.result.exceptionDetails;
    if (details) throw new Error(`[${this.label}] ${details.exception?.description || details.text}`);
    return r.result.result.value;
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await this.ev("return document.readyState==='complete' && !!document.getElementById('board')")) {
        await sleep(300);
        return;
      }
    }
    throw new Error(`[${this.label}] timeout cargando ${url}`);
  }

  cards() {
    return this.ev("return [...document.querySelectorAll('#board .card')]" +
      ".map(c=>c.querySelector('.ctitle,.done-title')?.textContent||'').sort()");
  }

  status() {
    return this.ev("const e=document.getElementById('syncStatus');" +
      "return e.hidden?'(oculto)':e.className.replace('sync-status ','')");
  }

  async waitFor(predicate, label, timeoutMs = 25000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await sleep(400);
    }
    const errs = [...new Set(this.errors)].slice(0, 8);
    throw new Error(`[${this.label}] timeout esperando: ${label}` +
      (errs.length ? `\n  errores de consola:\n    ${errs.join("\n    ")}` : ""));
  }
}

export function makeReporter(title) {
  const results = [];
  return {
    check(ok, name, extra = "") { results.push([Boolean(ok), name, extra]); },
    report(pages = []) {
      console.log(`\n-- ${title} --`);
      for (const [ok, name, extra] of results) {
        console.log(`${ok ? "[ok]" : "[error]"} ${name}${!ok && extra ? `\n    -> ${extra}` : ""}`);
      }
      const failed = results.filter(r => !r[0]).length;
      console.log(`\n${results.length - failed}/${results.length} comprobaciones OK`);
      const errors = [...new Set(pages.flatMap(p => p.errors))];
      console.log(errors.length
        ? `\nErrores de consola:\n  ${errors.join("\n  ")}`
        : "Consola del navegador limpia.");
      return failed;
    }
  };
}
