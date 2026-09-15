import { LS_THEME } from "./config.js";

export function initTheme() {
  try {
    const t = localStorage.getItem(LS_THEME);
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {
    console.error("Error initializing theme:", e);
  }

  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) {
    themeBtn.addEventListener("click", toggleTheme);
  }
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(LS_THEME, next);
  } catch (e) {
    console.error("Error saving theme:", e);
  }
  return next;
}
