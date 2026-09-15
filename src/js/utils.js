export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
  });
}

export function clone(a) {
  return JSON.parse(JSON.stringify(a));
}

export function tstamp() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? "0" : "") + n; };
  return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}
