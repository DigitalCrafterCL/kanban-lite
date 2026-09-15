#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const DIST_DIR = path.join(ROOT_DIR, "dist");

console.log("Iniciando empaquetado de Kanban Lite...");

// 1. Bundle CSS
const ASSET_MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

let inlinedAssets = 0;

// Convierte url(./ruta) locales en data URIs para mantener el archivo único
function inlineAssets(css, baseDir) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (match, ref) => {
    if (/^(data:|https?:|\/\/)/i.test(ref)) return match;
    const fullPath = path.resolve(baseDir, ref);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Recurso CSS no encontrado: ${fullPath} (referenciado como ${ref})`);
    }
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ASSET_MIME[ext];
    if (!mime) throw new Error(`Tipo de recurso no soportado para inline: ${ext}`);
    inlinedAssets++;
    return `url(data:${mime};base64,${fs.readFileSync(fullPath).toString("base64")})`;
  });
}

function bundleCSS(entryPath) {
  const content = fs.readFileSync(entryPath, "utf-8");
  const baseDir = path.dirname(entryPath);

  // Resolver directivas @import
  const resolved = content.replace(/@import\s+["']([^"']+)["'];?/g, (match, importPath) => {
    const fullPath = path.resolve(baseDir, importPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo CSS no encontrado: ${fullPath}`);
    }
    return bundleCSS(fullPath);
  });

  // Inlinear recursos relativos a ESTE archivo antes de subir de nivel
  return inlineAssets(resolved, baseDir);
}

// 2. Bundle JS (Topological ESM to IIFE bundler)
function bundleJS() {
  const filesOrder = [
    path.join(SRC_DIR, "data", "seed.js"),
    path.join(SRC_DIR, "js", "config.js"),
    path.join(SRC_DIR, "js", "metrics.js"),
    path.join(SRC_DIR, "js", "utils.js"),
    path.join(SRC_DIR, "js", "richtext.js"),
    path.join(SRC_DIR, "js", "toast.js"),
    path.join(SRC_DIR, "js", "remote.js"),
    path.join(SRC_DIR, "js", "boardselector.js"),
    path.join(SRC_DIR, "js", "store.js"),
    path.join(SRC_DIR, "js", "sync.js"),
    path.join(SRC_DIR, "js", "theme.js"),
    path.join(SRC_DIR, "js", "filters.js"),
    path.join(SRC_DIR, "js", "stats.js"),
    path.join(SRC_DIR, "js", "dnd.js"),
    path.join(SRC_DIR, "js", "trash.js"),
    path.join(SRC_DIR, "js", "carddetail.js"),
    path.join(SRC_DIR, "js", "cards.js"),
    path.join(SRC_DIR, "js", "header.js"),
    path.join(SRC_DIR, "js", "frentes.js"),
    path.join(SRC_DIR, "js", "io.js"),
    path.join(SRC_DIR, "js", "headmenu.js"),
    path.join(SRC_DIR, "js", "templates.js"),
    path.join(SRC_DIR, "js", "hotkeys.js"),
    path.join(SRC_DIR, "js", "servers.js"),
    path.join(SRC_DIR, "js", "paste.js"),
    path.join(SRC_DIR, "js", "bitacora.js"),
    path.join(SRC_DIR, "js", "metricsui.js"),
    path.join(SRC_DIR, "js", "render.js"),
    path.join(SRC_DIR, "js", "app.js")
  ];

  let bundledBody = [];

  for (const filePath of filesOrder) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Archivo JS no encontrado: ${filePath}`);
    }
    let code = fs.readFileSync(filePath, "utf-8");

    // Eliminar sentencias import
    code = code.replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'](?:\s+with\s*\{[^}]*\})?;?/g, "");

    // Transformar export default <expr>
    if (filePath.endsWith("seed.js")) {
      code = code.replace(/export\s+default\s+/, "const seedData = ");
    } else {
      code = code.replace(/export\s+default\s+/, "");
    }

    // Transformar export const / let / var / function / class, incluido "export async function"
    code = code.replace(/export\s+(async\s+)?(const|let|var|function|class)\s+/g,
      (_, asyncKw, keyword) => (asyncKw || "") + keyword + " ");

    // Eliminar export { ... }
    code = code.replace(/export\s*\{[^}]*\};?/g, "");

    const relName = path.relative(SRC_DIR, filePath);
    bundledBody.push(`  // -- Módulo: ${relName} --\n` + code.trim());
  }

  return `(function () {\n  "use strict";\n\n` + bundledBody.join("\n\n") + `\n})();\n`;
}

// 3. Ensamblar HTML único
function buildSingleFile() {
  const srcHtmlPath = path.join(SRC_DIR, "index.html");
  let html = fs.readFileSync(srcHtmlPath, "utf-8");

  // Empaquetar CSS y reemplazar tag <link rel="stylesheet" href="./css/main.css">
  const css = bundleCSS(path.join(SRC_DIR, "css", "main.css"));
  const cssTag = `<style>\n${css.trim()}\n</style>`;
  // Reemplazo con funcion, no con cadena: en una cadena de reemplazo "$&", "$\'" y
  // "$`" son secuencias especiales y corromperian el CSS o el JS que las contenga.
  html = html.replace(/<link\s+rel="stylesheet"\s+href="\.\/css\/main\.css"\s*\/?>/i, () => cssTag);

  // Empaquetar JS y reemplazar tag <script type="module" src="./js/app.js"></script>
  const js = bundleJS();

  // El bundler transforma los modulos con expresiones regulares, asi que
  // validamos el resultado antes de escribirlo: un "export" que se escape
  // rompe la app entera y en el HTML no se nota hasta abrirlo.
  try {
    new Function(js);
  } catch (err) {
    throw new Error(`El bundle generado no es JavaScript valido: ${err.message}`);
  }

  const jsTag = `<script>\n${js.trim()}\n</script>`;
  html = html.replace(/<script\s+type="module"\s+src="\.\/js\/app\.js">\s*<\/script>/i, () => jsTag);
  html = html.trimEnd() + "\n";

  // Asegurar directorio dist/
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Ultima red de seguridad: el JS que realmente quedo dentro del HTML debe
  // seguir siendo valido despues de ensamblarlo, no solo antes.
  const emitted = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!emitted) throw new Error("El HTML final no contiene el bloque <script> empaquetado");
  try {
    new Function(emitted[1]);
  } catch (err) {
    throw new Error(`El JavaScript embebido en el HTML final no es valido: ${err.message}`);
  }

  const distHtmlPath = path.join(DIST_DIR, "index.html");
  fs.writeFileSync(distHtmlPath, html, "utf-8");

  const sizeKb = (Buffer.byteLength(html, "utf-8") / 1024).toFixed(2);
  console.log(`[ok] Build completado exitosamente:`);
  console.log(`   - ${path.relative(ROOT_DIR, distHtmlPath)} (${sizeKb} KB)`);
  console.log(`   - ${inlinedAssets} recurso(s) embebido(s) como data URI`);
}

try {
  buildSingleFile();
} catch (err) {
  console.error("[error] Error durante el build:", err);
  process.exit(1);
}
