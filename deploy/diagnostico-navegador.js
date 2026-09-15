/* Pegar en la consola del navegador (F12 -> Consola) con Kanban Lite abierto.
   Sólo lee: no modifica ni sube nada. Copia toda la salida y compártela. */
(() => {
  const idx = JSON.parse(localStorage.getItem("kanban_boards") || "[]");
  const activo = localStorage.getItem("kanban_active_board");
  const servidores = JSON.parse(localStorage.getItem("kanban_servers") || "[]");

  console.log("=== SERVIDORES ===");
  servidores.forEach(s => console.log(`  id=${s.id}  usuario=${s.username}  url=${s.url}`));

  console.log("=== TABLEROS ===  (activo: " + activo + ")");
  const porBoardId = {};
  for (const b of idx) {
    const est = JSON.parse(localStorage.getItem("kanban_board_" + b.slug) || "null");
    const snap = JSON.parse(localStorage.getItem("kanban_synced_" + b.slug) || "null");
    const r = b.remote || {};
    if (r.boardId) (porBoardId[r.boardId] = porBoardId[r.boardId] || []).push(b.slug);
    console.log(
      `  slug=${b.slug}  nombre=${b.name}  tipo=${b.kind || "local"}\n` +
      `      boardId=${r.boardId || "-"}  serverId=${r.serverId || "-"}  base=v${r.baseVersion ?? "-"}\n` +
      `      título=${est?.meta?.title}  tarjetas=${est?.cards?.length ?? "-"}  ` +
      `frentes=${(est?.ws || []).map(w => w.key).join(",") || "-"}\n` +
      `      snapshot: tarjetas=${snap?.cards?.length ?? "sin snapshot"}`
    );
  }

  const cruzados = Object.entries(porBoardId).filter(([, s]) => s.length > 1);
  console.log(cruzados.length
    ? "[aviso] VARIAS ENTRADAS APUNTAN AL MISMO TABLERO DEL SERVIDOR: " + JSON.stringify(cruzados)
    : "[ok] ninguna entrada duplicada");

  // Rescate: vuelca cada copia guardada con su contenido, por si una de ellas
  // conserva tarjetas que el tablero vivo ya perdio.
  console.log("=== COPIAS GUARDADAS CON CONTENIDO ===");
  let encontradas = 0;
  for (const b of idx) {
    for (const clave of ["kanban_board_" + b.slug, "kanban_synced_" + b.slug]) {
      const s = JSON.parse(localStorage.getItem(clave) || "null");
      if (!s?.cards?.length) continue;
      encontradas++;
      console.log(`  ${clave}: ${s.cards.length} tarjetas -> ${s.cards.map(c => c.id).join(", ")}`);
      console.log(JSON.stringify(s, null, 2));
    }
  }
  if (!encontradas) console.log("  (ninguna copia con tarjetas; prueba en los otros navegadores)");
})();
