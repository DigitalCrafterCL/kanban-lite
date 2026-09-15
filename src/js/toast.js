import { esc } from "./utils.js";

let toastContainerElement = null;

function ensureContainer() {
  if (!toastContainerElement) {
    toastContainerElement = document.getElementById("toastContainer");
    if (!toastContainerElement) {
      toastContainerElement = document.createElement("div");
      toastContainerElement.id = "toastContainer";
      toastContainerElement.className = "toast-container";
      toastContainerElement.setAttribute("aria-live", "polite");
      document.body.appendChild(toastContainerElement);
    }
  }
  return toastContainerElement;
}

export function showToast(message, type = "info", duration = 3000) {
  const box = ensureContainer();
  const el = document.createElement("div");
  el.className = `toast ${type}`;

  const iconMap = {
    success: "✓",
    info: "ℹ",
    warn: "⚠",
    error: "✕"
  };

  const icon = iconMap[type] || "ℹ";
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${esc(message)}</span>
  `;

  box.appendChild(el);

  // Forzar reflow para disparo de animación
  requestAnimationFrame(() => {
    el.classList.add("show");
  });

  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 250);
  }, duration);
}
