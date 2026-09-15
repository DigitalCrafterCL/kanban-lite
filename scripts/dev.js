import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

const PORT = process.env.PORT || 8080;

// src/ actúa como raíz web (css/, js/, data/); assets/ y dist/ se sirven desde la raíz
// del repo. Sin esto, las rutas relativas de src/index.html darían 404 en "/".
function resolveRequest(reqPath) {
  if (reqPath === "/" || reqPath === "/index.html") reqPath = "/index.html";
  const rel = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  // Desde la raíz del repo sólo se exponen assets/ y dist/; el resto vive bajo src/
  const bases = /^[/\\](assets|dist)[/\\]/.test(rel) ? [ROOT_DIR] : [SRC_DIR];
  for (const base of bases) {
    const candidate = path.join(base, rel);
    if (!candidate.startsWith(base)) continue; // fuera de la raíz permitida
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURI(req.url.split("?")[0]);
  const filePath = resolveRequest(reqPath);

  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache"
  });

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Servidor de desarrollo corriendo en: http://localhost:${PORT}`);
  console.log(`   Sirviendo directamente los módulos en src/ (assets/ desde la raíz)`);
});
