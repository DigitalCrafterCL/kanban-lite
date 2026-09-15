// Menú de la barra superior.
//
// Los botones de herramientas viven dentro de un desplegable: con nueve
// opciones la cabecera se partía en dos filas y competía con el título del
// tablero. Lo único que se queda fuera es el estado de sincronización, que es
// un aviso —«hay cambios sin subir», «el servidor no responde»— y no puede
// depender de que alguien abra un menú para verse.
//
// Los botones conservan sus identificadores, así que cada módulo sigue
// enganchando el suyo sin saber que ahora está en un menú.

import { downloadOfflineApp } from "./io.js";

export function initHeadMenu() {
  const btn = document.getElementById("menuBtn");
  const panel = document.getElementById("menuPanel");
  if (!btn || !panel) return;

  btn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    toggleHeadMenu();
  });

  // Cualquier opción cierra el menú: casi todas abren un modal, y dejar el
  // desplegable encima resulta en dos capas de interfaz por delante.
  panel.querySelectorAll(".menu-item").forEach(function (item) {
    item.addEventListener("click", function () { closeHeadMenu(); });
  });

  document.addEventListener("mousedown", function (ev) {
    if (!isHeadMenuOpen()) return;
    if (ev.target.closest(".menu-wrap")) return;
    closeHeadMenu();
  });

  // En captura, por lo mismo que la ficha de la tarjeta: hotkeys.js también
  // atiende Escape y no queremos depender del orden de registro.
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && isHeadMenuOpen()) closeHeadMenu();
  }, true);

  const offline = document.getElementById("offlineBtn");
  if (offline) offline.addEventListener("click", downloadOfflineApp);
}

export function isHeadMenuOpen() {
  const panel = document.getElementById("menuPanel");
  return Boolean(panel && !panel.hidden);
}

export function openHeadMenu() {
  const btn = document.getElementById("menuBtn");
  const panel = document.getElementById("menuPanel");
  if (!btn || !panel) return;
  panel.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("open");
}

export function closeHeadMenu() {
  const btn = document.getElementById("menuBtn");
  const panel = document.getElementById("menuPanel");
  if (!btn || !panel) return;
  panel.hidden = true;
  btn.setAttribute("aria-expanded", "false");
  btn.classList.remove("open");
}

export function toggleHeadMenu() {
  if (isHeadMenuOpen()) closeHeadMenu();
  else openHeadMenu();
}
