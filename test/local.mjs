// Pruebas de navegador del modo local: la app sin backend de ninguna clase.
// Ejecutar con: npm run test:browser
import { launchBrowser, serveDist, killBrowsers, makeReporter, sleep } from "./harness.mjs";

const PORT = 8311;
const APP = `http://127.0.0.1:${PORT}/`;
const server = serveDist(PORT);
const { check, report } = makeReporter("Modo local (sin servidor)");
const page = await launchBrowser("local", 9350);

try {
  // -- Arranque limpio --
  await page.goto(APP);
  await page.ev("localStorage.clear()");
  await page.goto(APP);
  check(await page.ev("return document.getElementById('boardSelectorOverlay').classList.contains('open')"),
    "sin tableros se abre el selector");
  check(await page.ev("return document.getElementById('boardSelectorClose').style.visibility === 'hidden'"),
    "no se puede cerrar el selector sin elegir tablero");
  check(await page.ev("return /Sólo existirá en este navegador/.test(document.querySelector('.bs-local-warn')?.textContent || '')"),
    "crear un tablero local avisa de que sólo vive en este navegador");

  // -- Primer tablero: el catálogo de plantillas y el tutorial --
  // Desde que las plantillas se gatillan sólo al crear, el tablero nuevo nace
  // vacío y el tutorial llega si se elige en el catálogo.
  await page.ev("document.getElementById('newBoardName').value='Trabajo';" +
                "document.getElementById('newBoardCreate').click();");
  await sleep(400);
  check(await page.ev("return document.getElementById('templatesOverlay').classList.contains('open')"),
    "crear un tablero ofrece el catálogo de plantillas");
  await page.ev(`[...document.querySelectorAll('#templatesGrid .template-card')]
      .find(c=>c.textContent.includes('Bienvenida')).click();`);
  await sleep(400);
  const tutorial = await page.ev("return document.querySelectorAll('#board .card').length");
  check(tutorial === 8, "la plantilla de bienvenida carga el tutorial", `tarjetas=${tutorial}`);
  check(await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_board_trabajo'));
    return s.cards.every(c=>c.cr && c.ca);`),
    "las tarjetas de una plantilla nacen selladas: sin fecha no habría métricas");

  // -- Segundo tablero: en blanco --
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev("const o=document.getElementById('templatesOverlay'); if(o) o.classList.remove('open');");
  await page.ev("document.getElementById('newBoardName').value='Personal';" +
                "document.getElementById('newBoardCreate').click();");
  await sleep(400);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === 0,
    "los tableros siguientes nacen vacíos");
  check(await page.ev("return JSON.parse(localStorage.getItem('kanban_board_personal')).ws.map(w=>w.label).join()") === "General",
    "el tablero nuevo trae un frente 'General'");
  check(await page.ev("return document.getElementById('headerTitle').textContent") === "Personal",
    "el título del tablero nuevo es el nombre dado");

  // -- Aislamiento entre tableros --
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev("[...document.querySelectorAll('.bs-name')].find(b=>b.textContent.startsWith('Trabajo')).click()");
  await sleep(400);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === 8,
    "volver a un tablero recupera su contenido");

  // -- updatedAt y persistencia --
  const before = await page.ev("return JSON.parse(localStorage.getItem('kanban_boards')).find(b=>b.slug==='trabajo').updatedAt");
  await sleep(1100);
  await page.ev(`const b=document.querySelector('[data-col="todo"] .add-btn'); b.click();
    const f=b.parentNode.querySelector('.add-form'); f.querySelector('.f-title').value='Tarea de prueba';
    f.querySelector('.f-save').click();`);
  await sleep(250);
  const after = await page.ev("return JSON.parse(localStorage.getItem('kanban_boards')).find(b=>b.slug==='trabajo').updatedAt");
  check(before !== after, "crear una tarjeta actualiza la fecha del tablero", `${before} -> ${after}`);
  check(await page.ev("return JSON.parse(localStorage.getItem('kanban_board_trabajo')).cards.length") === 9,
    "la tarjeta queda persistida");

  // -- Filtrar no debe escribir en disco --
  await page.ev(`window.__w=0; const o=localStorage.setItem.bind(localStorage);
    localStorage.setItem=function(k,v){window.__w++; return o(k,v);};`);
  await page.ev(`document.getElementById('searchInput').value='zzz';
    document.getElementById('searchInput').dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(200);
  const writes = await page.ev("return window.__w");
  check(writes === 0, "buscar no escribe en localStorage", `escrituras=${writes}`);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === 0, "el buscador filtra");
  await page.ev("document.getElementById('searchClear').click()");
  await sleep(200);

  // -- XSS en el nombre de un tablero --
  await page.ev("window.__xss=false; document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev(`document.getElementById('newBoardName').value='<img src=x onerror="window.__xss=true">';
    document.getElementById('newBoardCreate').click();`);
  await sleep(300);
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev(`const r=[...document.querySelectorAll('.bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.includes('<img'));
    const d=r.querySelector('.bs-delete'); d.click(); d.click();`);
  await sleep(400);
  check(await page.ev("return window.__xss") === false, "un nombre de tablero malicioso no ejecuta código");
  check(await page.ev(`const t=document.querySelector('.toast-msg');
    return t ? (t.querySelector('img')===null && t.textContent.includes('<img')) : 'sin-toast';`) === true,
    "el toast muestra el texto escapado");

  // -- Importar un tablero sin tarjetas --
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev("[...document.querySelectorAll('.bs-name')].find(b=>b.textContent.startsWith('Personal')).click()");
  await sleep(300);
  await page.ev(`document.getElementById('dataBtn').click();
    document.getElementById('importBox').value = JSON.stringify({app:'kanban-lite',rev:2,
      meta:{eyebrow:'x',title:'Vacio',titleThin:'',subtitle:'',branch:'v1'},
      ws:[{key:'GEN',label:'General',color:'#0a8fa6'}], cards:[]});
    document.getElementById('importBtn').click();`);
  await sleep(350);
  const msg = await page.ev("return document.getElementById('importMsg').textContent");
  check(msg.startsWith("✓"), "se puede importar un tablero sin tarjetas", msg);

  // -- El título de la ventana lleva el tablero activo --
  check((await page.ev("return document.title")) === "Personal · Kanban Lite",
    "el title de la ventana muestra el tablero activo",
    await page.ev("return document.title"));

  // -- Atajo N: la tarjeta nueva nace en Backlog --
  await page.ev(`document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',bubbles:true}));`);
  await sleep(200);
  check(await page.ev("return !!document.querySelector('[data-col=\"backlog\"] .add-form.open')"),
    "la tecla N abre el formulario en Backlog");
  check(await page.ev("return !document.querySelector('[data-col=\"todo\"] .add-form.open')"),
    "la tecla N ya no abre el formulario en Por hacer");
  await page.ev("document.querySelector('[data-col=\"backlog\"] .add-form.open .f-cancel').click()");
  await sleep(150);

  // -- Un segundo frente, para poder elegir por tarjeta al pegar --
  await page.ev(`document.getElementById('cfgBtn').click();
    document.getElementById('newWsName').value='Soporte';
    document.getElementById('newWsAdd').click();`);
  await sleep(300);
  await page.ev("document.getElementById('cfgClose').click()");
  await sleep(150);
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .ws.map(w=>w.key).join(',');`) === "GEN,SOPO",
    "el tablero tiene dos frentes para la prueba de pegado",
    await page.ev("return JSON.parse(localStorage.getItem('kanban_board_personal')).ws.map(w=>w.key).join(',')"));

  // -- Pegar desde el portapapeles --
  await page.ev(`const dt = new DataTransfer();
    dt.setData('text/plain', [
      '- Comprar materiales',
      '[12/03/2025, 10:22] Víctor: Revisar el informe',
      '',
      '3) Llamar al proveedor | antes del viernes',
      'Descartada'
    ].join('\\n'));
    document.activeElement.blur();
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`);
  await sleep(250);
  check(await page.ev("return document.getElementById('pasteOverlay').classList.contains('open')"),
    "pegar abre la vista previa");
  const titulos = await page.ev("return [...document.querySelectorAll('#pasteList .paste-title')].map(i=>i.value)");
  check(JSON.stringify(titulos) === JSON.stringify(
      ["Comprar materiales", "Revisar el informe", "Llamar al proveedor", "Descartada"]),
    "se limpian viñetas, numeración y la marca de WhatsApp", JSON.stringify(titulos));
  check(await page.ev("return [...document.querySelectorAll('#pasteList .paste-check')].every(c=>c.checked)"),
    "la vista previa llega con todo marcado");

  // Frente y prioridad por tarjeta: la segunda se desvía del valor común
  await page.ev(`document.getElementById('pastePri').value='alta';
    document.getElementById('pastePri').dispatchEvent(new Event('change',{bubbles:true}));`);
  check(await page.ev("return [...document.querySelectorAll('#pasteList .paste-row-pri')].every(s=>s.value==='alta')"),
    "el selector de arriba fija la prioridad de toda la tanda");
  await page.ev(`const filas=[...document.querySelectorAll('#pasteList .paste-row')];
    filas[1].querySelector('.paste-row-pri').value='critica';
    filas[1].querySelector('.paste-row-ws').value='SOPO';`);
  check(await page.ev("return document.querySelector('#pasteList .paste-row-pri').value") === "alta",
    "desviar una fila no toca a las demás");

  const antes = await page.ev("return document.querySelectorAll('#board .card').length");
  await page.ev(`[...document.querySelectorAll('#pasteList .paste-check')].pop().click();
    document.getElementById('pasteImport').click();`);
  await sleep(350);
  const backlog = await page.ev("return [...document.querySelectorAll('[data-col=\"backlog\"] .card .ctitle')].map(e=>e.textContent)");
  check(backlog.length === 3 && backlog.includes("Llamar al proveedor") && !backlog.includes("Descartada"),
    "sólo se importan las tarjetas marcadas, y van a Backlog", JSON.stringify(backlog));
  check(await page.ev("return document.querySelectorAll('#board .card').length") === antes + 3,
    "las tarjetas desmarcadas no entran");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.filter(c=>c.col==='backlog').length`) === 3,
    "lo pegado queda persistido");
  check(await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Llamar al proveedor'); return c && c.d;`) === "antes del viernes",
    "el texto tras la barra vertical se guarda como descripción");

  const importadas = await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.filter(c=>c.col==='backlog').map(c=>[c.t,c.ws,c.pri]);`);
  const porTitulo = Object.fromEntries(importadas.map(([t, ws, pri]) => [t, { ws, pri }]));
  check(porTitulo["Revisar el informe"] && porTitulo["Revisar el informe"].pri === "critica" &&
        porTitulo["Revisar el informe"].ws === "SOPO",
    "cada tarjeta se guarda con el frente y la prioridad elegidos en su fila",
    JSON.stringify(importadas));
  check(porTitulo["Comprar materiales"] && porTitulo["Comprar materiales"].pri === "alta" &&
        porTitulo["Comprar materiales"].ws === "GEN",
    "las demás conservan los valores comunes", JSON.stringify(importadas));

  // -- Corregir en la vista previa y marcar pulsando la fila --
  await page.ev(`const dt = new DataTransfer();
    dt.setData('text/plain', 'Titulo con error');
    document.activeElement.blur();
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`);
  await sleep(250);
  await page.ev(`const row=document.querySelector('#pasteList .paste-row');
    row.click();`);
  check(await page.ev("return document.getElementById('pasteImport').disabled") === true,
    "pulsar la fila desmarca y deja el botón de importar inactivo");
  await page.ev(`const row=document.querySelector('#pasteList .paste-row');
    row.click();
    row.querySelector('.paste-title').value='Titulo corregido';
    document.getElementById('pasteImport').click();`);
  await sleep(300);
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.some(c=>c.t==='Titulo corregido');`),
    "el título corregido en la vista previa es el que se guarda");

  // -- Formato completo: ID | WS | prioridad | col | Título | Descripción --
  await page.ev(`const dt = new DataTransfer();
    dt.setData('text/plain', [
      '# Formato por línea:  ID | WS | prioridad | col | Título | Descripción',
      'CORE-H01 | CORE | baja | done | Sandbox InfluxDB + FastAPI | 2025-01: origen del proyecto.',
      'DEP-H03 | DEP | media | done | MK1 a producción | 2025-03: primera puesta en producción.',
      'OPS-9 | CORE | Crítica | En progreso | Nombres escritos con tilde | y una | barra en la descripción'
    ].join('\\n'));
    document.activeElement.blur();
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`);
  await sleep(250);
  const filas = await page.ev(`return [...document.querySelectorAll('#pasteList .paste-row')].map(r=>({
      id: r.querySelector('.paste-id') ? r.querySelector('.paste-id').textContent : '',
      t: r.querySelector('.paste-title').value,
      ws: r.querySelector('.paste-row-ws').value,
      pri: r.querySelector('.paste-row-pri').value,
      col: r.querySelector('.paste-row-col').value
    }));`);
  check(filas.length === 3, "la línea de comentario '#' no cuenta como tarjeta", JSON.stringify(filas));
  check(filas[0] && filas[0].id === "CORE-H01" && filas[0].ws === "CORE" &&
        filas[0].pri === "baja" && filas[0].col === "done",
    "la vista previa respeta ID, frente, prioridad y columna de la línea", JSON.stringify(filas[0]));
  check(filas[2] && filas[2].pri === "critica" && filas[2].col === "inprogress",
    "prioridad y columna se aceptan escritas con tilde y nombre largo", JSON.stringify(filas[2]));

  // El valor común no debe pisar lo que la línea ya declaraba
  await page.ev(`document.getElementById('pasteCol').value='backlog';
    document.getElementById('pasteCol').dispatchEvent(new Event('change',{bubbles:true}));`);
  check(await page.ev("return document.querySelector('#pasteList .paste-row-col').value") === "done",
    "el selector común no pisa la columna que traía la línea");

  await page.ev("document.getElementById('pasteImport').click()");
  await sleep(400);
  const importadasFull = await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_board_personal'));
    return { ws: s.ws.map(w=>w.key), cards: s.cards.filter(c=>c.id.startsWith('CORE-')||c.id.startsWith('DEP-')||c.id.startsWith('OPS-'))
      .map(c=>[c.id,c.ws,c.pri,c.col]) };`);
  check(importadasFull.ws.includes("CORE") && importadasFull.ws.includes("DEP"),
    "los frentes que no existían se crean al importar", JSON.stringify(importadasFull.ws));
  check(importadasFull.cards.length === 3 &&
        importadasFull.cards.some(c => c[0] === "CORE-H01" && c[3] === "done") &&
        importadasFull.cards.some(c => c[0] === "OPS-9" && c[1] === "CORE" && c[2] === "critica" && c[3] === "inprogress"),
    "las tarjetas conservan su ID y caen en su columna", JSON.stringify(importadasFull.cards));
  check(await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.id==='OPS-9'); return c && c.d;`) === "y una | barra en la descripción",
    "la barra vertical dentro de la descripción se conserva");

  // -- Pegar la misma lista otra vez: los IDs repetidos llegan desmarcados --
  await page.ev(`const dt = new DataTransfer();
    dt.setData('text/plain', 'CORE-H01 | CORE | baja | done | Sandbox InfluxDB + FastAPI | otra vez');
    document.activeElement.blur();
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));`);
  await sleep(250);
  check(await page.ev("return document.querySelector('#pasteList .paste-row').classList.contains('paste-dup')") === true &&
        await page.ev("return document.querySelector('#pasteList .paste-check').checked") === false,
    "un ID que ya existe se marca como repetido y llega desmarcado");
  check(await page.ev("return document.getElementById('pasteImport').disabled") === true,
    "sin nada marcado no se puede importar");
  const antesDup = await page.ev("return JSON.parse(localStorage.getItem('kanban_board_personal')).cards.length");
  await page.ev(`document.querySelector('#pasteList .paste-check').click();
    document.getElementById('pasteImport').click();`);
  await sleep(350);
  const trasDup = await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_board_personal'));
    return { total: s.cards.length, conEseId: s.cards.filter(c=>c.id==='CORE-H01').length };`);
  check(trasDup.total === antesDup + 1 && trasDup.conEseId === 1,
    "importarlo de todos modos no duplica el ID: recibe uno nuevo", JSON.stringify(trasDup));

  // -- Texto enriquecido en la descripción --
  await page.ev(`window.__rtxss=false;
    const b=document.querySelector('[data-col="todo"] .add-btn'); b.click();
    const f=b.parentNode.querySelector('.add-form');
    f.querySelector('.f-title').value='Tarjeta con formato';
    f.querySelector('.f-desc').value='Con **fuerte** y <img src=x onerror="window.__rtxss=true">\\n- [ ] una\\n- [x] otra';
    f.querySelector('.f-save').click();`);
  await sleep(300);
  const rt = await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta con formato'));
    return { fuerte: !!c.querySelector('.cdesc.rich strong'),
             img: !!c.querySelector('.cdesc img'),
             escapado: c.querySelector('.cdesc').textContent.includes('<img'),
             casillas: c.querySelectorAll('.rt-check').length,
             prog: c.querySelector('.rt-prog') ? c.querySelector('.rt-prog').textContent : '' };`);
  check(rt.fuerte && rt.casillas === 2, "la descripción pinta negrita y subtareas", JSON.stringify(rt));
  check(rt.prog.includes("1/2"), "el pie cuenta las subtareas hechas", rt.prog);
  check(await page.ev("return window.__rtxss") === false && rt.img === false && rt.escapado === true,
    "una descripción maliciosa no ejecuta código y se muestra escapada", JSON.stringify(rt));

  await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta con formato'));
    c.querySelector('.rt-check').click();`);
  await sleep(250);
  check(await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Tarjeta con formato');
    return c && c.d.includes('- [x] una');`),
    "marcar la casilla desde la tarjeta se guarda en la descripción");
  check(await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta con formato'));
    return c.querySelector('.rt-prog').textContent.includes('2/2') &&
           c.querySelectorAll('.rt-task.rt-done').length === 2;`),
    "el contador y el tachado se actualizan sin volver a pintar el tablero");

  // La barra de formato envuelve la selección, ahora en el editor de la ficha
  await page.ev(`[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta con formato')).click();`);
  await sleep(250);
  await page.ev(`document.getElementById('cdDescEdit').click();`);
  await sleep(200);
  await page.ev(`const ta=document.querySelector('#cdDescEditor .cd-desc-input');
    ta.value='palabra'; ta.setSelectionRange(0,7);
    document.querySelector('#cdDescEditor .rt-bar .rt-b')
      .dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));`);
  await sleep(150);
  check(await page.ev("return document.querySelector('#cdDescEditor .cd-desc-input').value") === "**palabra**",
    "el botón de negrita envuelve la selección",
    await page.ev("return document.querySelector('#cdDescEditor .cd-desc-input').value"));
  await page.ev(`[...document.querySelectorAll('#cdDescEditor .btn')].find(b=>b.textContent==='Cancelar').click();
    document.getElementById('cardClose').click();`);
  await sleep(200);

  // -- Ya no hay controles de edición dentro de la tarjeta de la columna --
  const controles = await page.ev(`return {
      mv: document.querySelectorAll('#board .card .mv').length,
      moves: document.querySelectorAll('#board .card .moves').length,
      forms: document.querySelectorAll('#board .card .edit-form').length
    };`);
  check(controles.mv === 0 && controles.moves === 0 && controles.forms === 0,
    "la tarjeta de la columna no lleva flechas ni lápiz: se edita en su ficha",
    JSON.stringify(controles));

  // -- Ficha de la tarjeta: resumen en la columna y modal central --
  await page.ev(`const b=document.querySelector('[data-col="todo"] .add-btn'); b.click();
    const f=b.parentNode.querySelector('.add-form');
    f.querySelector('.f-title').value='Tarjeta de ficha';
    f.querySelector('.f-desc').value='**Primera** linea de una descripcion muy larga que no cabe entera en la tarjeta de la columna y por eso se resume\\nsegunda\\ntercera\\ncuarta\\nquinta';
    f.querySelector('.f-save').click();`);
  await sleep(300);
  const resumen = await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha'));
    const d=c.querySelector('.cdesc');
    return { corta: d.classList.contains('cdesc-corta'), texto: d.textContent,
             fuerte: !!d.querySelector('strong'), lineas: d.querySelectorAll('.rt-p').length };`);
  check(resumen.corta && resumen.texto.includes("…") && resumen.texto.length < 200,
    "la tarjeta muestra un resumen de la descripción, no el texto entero",
    JSON.stringify(resumen).slice(0, 160));
  check(resumen.fuerte && !resumen.texto.includes("*"),
    "el recorte no deja marcadores sueltos a la vista", JSON.stringify(resumen).slice(0, 160));
  check(resumen.lineas <= 4, "el resumen se limita en número de líneas", String(resumen.lineas));

  // Al hacer clic se abre la ficha central
  await page.ev(`[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha')).click();`);
  await sleep(250);
  const ficha = await page.ev(`return {
      abierta: document.getElementById('cardOverlay').classList.contains('open'),
      id: document.getElementById('cdId').textContent,
      titulo: document.getElementById('cdTitle').value,
      ws: document.getElementById('cdWs').value,
      lineas: document.querySelectorAll('#cdDesc .rt-p').length,
      recortado: document.getElementById('cdDesc').textContent.includes('…')
    };`);
  check(ficha.abierta && ficha.titulo === "Tarjeta de ficha" && ficha.id.length > 0 && ficha.ws.length > 0,
    "el clic abre la ficha con id, título y frente", JSON.stringify(ficha));
  check(ficha.lineas === 5 && ficha.recortado === false,
    "la ficha muestra la descripción completa, sin recortar", JSON.stringify(ficha));

  // Etiquetas
  await page.ev(`const i=document.getElementById('cdLabelInput'); i.value='#API Externa';
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await sleep(250);
  check(await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Tarjeta de ficha'); return JSON.stringify(c.labels);`) === '["api-externa"]',
    "la etiqueta se normaliza y se guarda",
    await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal')).cards.find(c=>c.t==='Tarjeta de ficha'); return JSON.stringify(c.labels);`));
  check(await page.ev("return document.querySelectorAll('#cdLabels .cd-label').length") === 1,
    "la ficha pinta la etiqueta como chip");
  check(await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha'));
    return c.querySelector('.clabel').textContent;`) === "#api-externa",
    "la etiqueta también se ve en la tarjeta de la columna");

  // El buscador encuentra por etiqueta, con y sin '#'
  await page.ev(`document.getElementById('cardClose').click();
    const s=document.getElementById('searchInput'); s.value='#api-externa';
    s.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(250);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === 1,
    "el buscador filtra por etiqueta");
  await page.ev("document.getElementById('searchClear').click()");
  await sleep(200);

  // Fecha de cierre
  await page.ev(`[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha')).click();`);
  await sleep(200);
  await page.ev(`const d=document.getElementById('cdDue'); d.value='2020-01-15';
    d.dispatchEvent(new Event('change',{bubbles:true}));`);
  await sleep(250);
  check(await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Tarjeta de ficha'); return c.due;`) === "2020-01-15",
    "la fecha de cierre se guarda");
  check((await page.ev("return document.getElementById('cdDueHint').textContent")).startsWith("Vencida"),
    "una fecha pasada se marca como vencida",
    await page.ev("return document.getElementById('cdDueHint').textContent"));
  check(await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha'));
    return c.querySelector('.cdue').classList.contains('cd-due-late');`),
    "la tarjeta avisa de la fecha vencida");

  // Comentarios
  await page.ev(`const t=document.getElementById('cdCommentText'); t.value='Primer **comentario**';
    document.getElementById('cdCommentAdd').click();`);
  await sleep(250);
  const coment = await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Tarjeta de ficha');
    return { n: c.comments.length, by: c.comments[0].by, texto: c.comments[0].text,
             tieneId: Boolean(c.comments[0].id), tieneFecha: Boolean(c.comments[0].at) };`);
  check(coment.n === 1 && coment.tieneId && coment.tieneFecha && coment.by === "yo",
    "el comentario se guarda con autor, fecha e identificador", JSON.stringify(coment));
  check(await page.ev("return !!document.querySelector('#cdComments .cd-comment-body strong')"),
    "el comentario se pinta con su texto enriquecido");
  check(await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Tarjeta de ficha'));
    return c.querySelector('.ccomments').textContent.includes('1');`),
    "la tarjeta cuenta los comentarios");

  // Editar la descripción y guardarla cierra el editor de verdad: `hidden` no
  // basta si el componente declara su propio `display`.
  await page.ev(`document.getElementById('cdDescEdit').click();`);
  await sleep(200);
  check(await page.ev(`const e=document.getElementById('cdDescEditor');
    return !e.hidden && e.getClientRects().length > 0;`),
    "✎ Editar abre el editor de la descripción");
  await page.ev(`const ta=document.querySelector('#cdDescEditor .cd-desc-input');
    ta.value='Descripción **reescrita** desde la ficha';
    document.querySelector('#cdDescEditor .btn.primary').click();`);
  await sleep(300);
  check(await page.ev(`const e=document.getElementById('cdDescEditor');
    return e.hidden && e.getClientRects().length === 0;`),
    "guardar la descripción cierra el editor",
    await page.ev(`const e=document.getElementById('cdDescEditor');
      return JSON.stringify({hidden:e.hidden, rects:e.getClientRects().length, display:getComputedStyle(e).display});`));
  check(await page.ev(`const v=document.getElementById('cdDesc');
    return !v.hidden && !!v.querySelector('strong');`),
    "y vuelve a mostrar la descripción renderizada");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.some(c=>c.d==='Descripción **reescrita** desde la ficha');`),
    "la descripción editada en la ficha se guarda");

  // Guardarla sin tocar nada deja lo mismo y cierra igual
  await page.ev(`document.getElementById('cdDescEdit').click();`);
  await sleep(200);
  await page.ev(`document.querySelector('#cdDescEditor .btn.primary').click();`);
  await sleep(250);
  check(await page.ev(`const e=document.getElementById('cdDescEditor');
    return e.hidden && e.getClientRects().length === 0;`),
    "guardar sin cambios también cierra el editor");

  // El título se edita desde la ficha
  await page.ev(`const t=document.getElementById('cdTitle'); t.value='Ficha renombrada';
    t.dispatchEvent(new Event('blur'));`);
  await sleep(250);
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.some(c=>c.t==='Ficha renombrada');`),
    "el título editado en la ficha se guarda");

  // Escape dentro de un campo no cierra la ficha; fuera, sí
  await page.ev(`document.getElementById('cdCommentText').focus();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await sleep(150);
  check(await page.ev("return document.getElementById('cardOverlay').classList.contains('open')"),
    "Escape en un campo no cierra la ficha entera");
  await page.ev(`document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await sleep(200);
  check(await page.ev("return !document.getElementById('cardOverlay').classList.contains('open')"),
    "Escape fuera de los campos cierra la ficha");

  // -- Menú de la barra superior --
  const menu0 = await page.ev(`return {
      panel: document.getElementById('menuPanel').hidden,
      expandido: document.getElementById('menuBtn').getAttribute('aria-expanded'),
      sueltos: document.querySelectorAll('.head-tools > .btn').length,
      syncFuera: !document.getElementById('menuPanel').contains(document.getElementById('syncStatus'))
    };`);
  check(menu0.panel === true && menu0.expandido === "false",
    "el menú arranca cerrado", JSON.stringify(menu0));
  check(menu0.sueltos === 0 && menu0.syncFuera === true,
    "no queda ninguna herramienta suelta en la cabecera y el estado de sincronización está fuera del menú",
    JSON.stringify(menu0));

  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(150);
  check(await page.ev(`const p=document.getElementById('menuPanel');
    return !p.hidden && p.getClientRects().length > 0 &&
      p.querySelectorAll('.menu-item:not([hidden])').length >= 8;`),
    "el menú se abre con todas las opciones dentro",
    await page.ev("return document.querySelectorAll('#menuPanel .menu-item:not([hidden])').length"));

  // Elegir una opción cierra el menú (si no, quedan dos capas de interfaz)
  await page.ev("document.getElementById('trashBtn').click()");
  await sleep(200);
  check(await page.ev("return document.getElementById('menuPanel').hidden") === true,
    "elegir una opción cierra el menú");
  await page.ev("document.getElementById('trashClose').click()");
  await sleep(150);

  // Escape y clic fuera
  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(120);
  await page.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await sleep(120);
  check(await page.ev("return document.getElementById('menuPanel').hidden") === true,
    "Escape cierra el menú");
  await page.ev(`document.getElementById('menuBtn').click();`);
  await sleep(120);
  await page.ev(`document.getElementById('board').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  await sleep(120);
  check(await page.ev("return document.getElementById('menuPanel').hidden") === true,
    "un clic fuera cierra el menú");

  // La tecla M
  await page.ev(`document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'m',bubbles:true}));`);
  await sleep(150);
  check(await page.ev("return document.getElementById('menuPanel').hidden") === false,
    "la tecla M abre el menú");
  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(120);

  // -- Descargar la app para usarla sin conexión --
  // Se intercepta createObjectURL para quedarnos con el archivo en vez de
  // descargarlo: así se comprueba qué se está entregando.
  await page.ev(`window.__dl=null;
    const orig=URL.createObjectURL.bind(URL);
    URL.createObjectURL=function(blob){ window.__dl=blob; return 'blob:capturado'; };
    window.__origCOU=orig;`);
  await page.ev(`document.getElementById('menuBtn').click();
    document.getElementById('offlineBtn').click();`);
  await sleep(700);
  const offline = await page.ev(`if(!window.__dl) return {sin:'nada'};
    const txt = await window.__dl.text();
    return { tipo: window.__dl.type, bytes: txt.length,
             esApp: txt.includes('id="board"') && txt.includes('</html>'),
             conEstilos: txt.includes('.card'),
             sinDatos: !txt.includes('Titulo corregido') };`);
  check(offline.esApp === true && offline.bytes > 200000,
    "la descarga offline entrega la aplicación completa en un archivo",
    JSON.stringify(offline).slice(0, 200));
  check(offline.tipo === "text/html" && offline.conEstilos === true,
    "el archivo descargado es HTML con todo embebido", JSON.stringify(offline).slice(0, 200));
  check(offline.sinDatos === true,
    "la copia offline no lleva dentro las tarjetas de quien la descarga",
    JSON.stringify(offline).slice(0, 200));
  await page.ev("URL.createObjectURL = window.__origCOU;");

  // -- Los frentes vienen plegados --
  const ws0 = await page.ev(`return {
      plegado: document.getElementById('wsFilters').hidden,
      chips: document.querySelectorAll('#wsFilters .chip').length,
      resumen: document.getElementById('wsCount').textContent,
      limpiar: document.getElementById('wsClear').hidden
    };`);
  check(ws0.plegado === true && ws0.chips > 0,
    "los filtros de frente arrancan plegados, con sus píldoras ya pintadas", JSON.stringify(ws0));
  const totalWs = await page.ev("return JSON.parse(localStorage.getItem('kanban_board_personal')).ws.length");
  check(ws0.resumen === String(totalWs) && ws0.limpiar === true,
    "plegado muestra cuántos frentes hay y no ofrece limpiar si no hay filtro",
    JSON.stringify(ws0));

  await page.ev("document.getElementById('wsToggle').click()");
  await sleep(150);
  check(await page.ev(`const b=document.getElementById('wsFilters');
    return !b.hidden && b.getClientRects().length > 0 &&
      document.getElementById('wsToggle').getAttribute('aria-expanded') === 'true';`),
    "pulsar Frente despliega las píldoras");

  // Filtrar y volver a plegar: el contador avisa de que hay un filtro puesto
  await page.ev("document.querySelector('#wsFilters .chip').click()");
  await sleep(200);
  await page.ev("document.getElementById('wsToggle').click()");
  await sleep(150);
  const ws1 = await page.ev(`return {
      plegado: document.getElementById('wsFilters').hidden,
      resumen: document.getElementById('wsCount').textContent,
      avisa: document.getElementById('wsToggle').classList.contains('filtering'),
      limpiar: document.getElementById('wsClear').hidden
    };`);
  check(ws1.plegado === true && ws1.resumen === (totalWs - 1) + "/" + totalWs &&
        ws1.avisa === true && ws1.limpiar === false,
    "plegado con un filtro puesto: el contador lo delata y aparece el botón de limpiar",
    JSON.stringify(ws1));

  await page.ev("document.getElementById('wsClear').click()");
  await sleep(200);
  check(await page.ev(`return document.getElementById('wsCount').textContent === '${totalWs}' &&
      document.getElementById('wsClear').hidden &&
      !document.getElementById('wsToggle').classList.contains('filtering');`),
    "limpiar devuelve todos los frentes sin desplegar");

  // La preferencia se recuerda entre recargas
  await page.ev("document.getElementById('wsToggle').click()");
  await sleep(150);
  await page.goto(APP);
  await sleep(500);
  check(await page.ev("return document.getElementById('wsFilters').hidden === false"),
    "si los dejas desplegados, siguen desplegados tras recargar");
  await page.ev("document.getElementById('wsToggle').click()");
  await sleep(150);

  // -- Clonar un tablero --
  // Se clona el tablero activo, que a estas alturas tiene tarjetas repartidas
  // por varias columnas, etiquetas, fechas y comentarios.
  const antesClon = await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_board_personal'));
    return { cards: s.cards.length, ws: s.ws.length,
             cols: [...new Set(s.cards.map(c=>c.col))].sort().join(','),
             conEtiqueta: s.cards.filter(c=>(c.labels||[]).length).length,
             conComentario: s.cards.filter(c=>(c.comments||[]).length).length,
             conFecha: s.cards.filter(c=>c.due).length };`);
  check(antesClon.cards > 1 && antesClon.cols.includes(",") &&
        antesClon.conEtiqueta > 0 && antesClon.conComentario > 0 && antesClon.conFecha > 0,
    "el tablero de origen tiene material para probar el clonado", JSON.stringify(antesClon));

  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(250);
  check(await page.ev(`const r=[...document.querySelectorAll('.bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Personal'));
    return !!r.querySelector('.bs-clone');`),
    "cada tablero de la lista ofrece clonarse");

  // Un clic sólo arma el botón: clonar por descuido duplica trabajo
  await page.ev(`const r=[...document.querySelectorAll('.bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Personal'));
    r.querySelector('.bs-clone').click();`);
  await sleep(150);
  check(await page.ev("return JSON.parse(localStorage.getItem('kanban_boards')).length") === 3 &&
        await page.ev(`return document.querySelector('.bs-clone.armed').textContent`) === "¿Clonar?",
    "el primer clic sólo pide confirmación");

  await page.ev(`document.querySelector('.bs-clone.armed').click();`);
  await sleep(500);
  const clon = await page.ev(`const idx=JSON.parse(localStorage.getItem('kanban_boards'));
    const e=idx.find(b=>b.name==='Personal (copia)');
    const s=e ? JSON.parse(localStorage.getItem('kanban_board_'+e.slug)) : null;
    return { existe: !!e, kind: e && e.kind, remote: e && Boolean(e.remote), slug: e && e.slug,
             cards: s && s.cards.length, ws: s && s.ws.length,
             cols: s && [...new Set(s.cards.map(c=>c.col))].join(','),
             etiquetas: s && s.cards.filter(c=>(c.labels||[]).length).length,
             comentarios: s && s.cards.filter(c=>(c.comments||[]).length).length,
             fechas: s && s.cards.filter(c=>c.due).length,
             descripciones: s && s.cards.filter(c=>c.d).length,
             titulo: s && s.meta.title, rev: s && s.rev };`);
  check(clon.existe && clon.cards === antesClon.cards && clon.ws === antesClon.ws,
    "el clon conserva todos los frentes y todas las tarjetas", JSON.stringify(clon));
  check(clon.cols === "backlog",
    "todas las tarjetas del clon caen en Backlog", String(clon.cols));
  check(clon.etiquetas === antesClon.conEtiqueta && clon.descripciones > 0,
    "las etiquetas y las descripciones viajan con la tarjeta", JSON.stringify(clon));
  check(clon.comentarios === 0 && clon.fechas === 0,
    "los comentarios y las fechas de cierre se quedan en el original", JSON.stringify(clon));
  check(clon.kind === "local" && clon.remote === false,
    "el clon es un tablero local", JSON.stringify(clon));
  // La revisión se compara contra la del tablero original, no contra un número
  // escrito aquí: cada campo nuevo de la tarjeta sube SEED_REV y esta prueba
  // se quedaba vieja sin que nadie la mirara.
  const revOriginal = await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal')).rev`);
  check(clon.titulo === "Personal (copia)" && clon.rev === revOriginal,
    "el encabezado del clon lleva su propio nombre y la revisión al día", JSON.stringify(clon));

  // El original no se toca y el clon queda abierto
  const original = await page.ev(`const s=JSON.parse(localStorage.getItem('kanban_board_personal'));
    return { cards: s.cards.length, cols: [...new Set(s.cards.map(c=>c.col))].sort().join(','),
             comentarios: s.cards.filter(c=>(c.comments||[]).length).length };`);
  check(original.cards === antesClon.cards && original.cols === antesClon.cols &&
        original.comentarios === antesClon.conComentario,
    "el tablero original queda intacto", JSON.stringify(original));
  check(await page.ev("return document.getElementById('headerTitle').textContent") === "Personal (copia)" &&
        await page.ev("return document.querySelectorAll('[data-col=\"backlog\"] .card').length") > 0,
    "clonar abre el tablero nuevo, con sus tarjetas en Backlog",
    await page.ev("return document.getElementById('headerTitle').textContent"));

  // Clonar dos veces no repite el nombre
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(250);
  await page.ev(`const r=[...document.querySelectorAll('.bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Personal (copia)'));
    const b=r.querySelector('.bs-clone'); b.click(); b.click();`);
  await sleep(500);
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
      .some(b=>b.name==='Personal (copia) (copia)');`),
    "clonar un clon no choca de nombre",
    await page.ev("return JSON.parse(localStorage.getItem('kanban_boards')).map(b=>b.name).join(' | ')"));

  // Volver al tablero de las siguientes pruebas
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(250);
  await page.ev("[...document.querySelectorAll('.bs-name')].find(b=>b.textContent.startsWith('Personal ·')||b.textContent==='Personal').click()");
  await sleep(400);

  // -- La bitácora es cosa de tableros compartidos --
  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(150);
  check(await page.ev(`const b=document.getElementById('logBtn');
    return b.hidden && b.getClientRects().length === 0;`),
    "en un tablero local no aparece el botón de bitácora",
    await page.ev(`const b=document.getElementById('logBtn');
      return JSON.stringify({hidden:b.hidden, rects:b.getClientRects().length});`));
  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(150);

  // -- Métricas de flujo: sellos, píldora de edad y panel --
  await page.ev(`const b=document.querySelector('[data-col="backlog"] .add-btn'); b.click();
    const f=b.parentNode.querySelector('.add-form');
    f.querySelector('.f-title').value='Medir el flujo';
    f.querySelector('.f-save').click();`);
  await sleep(300);
  const selloAlta = await page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Medir el flujo');
    return { cr: !!c.cr, ca: !!c.ca, st: c.st, dn: c.dn, col: c.col };`);
  check(selloAlta.cr && selloAlta.ca && selloAlta.st === "" && selloAlta.dn === "",
    "una tarjeta nueva en Backlog nace con fecha de creación y sin ciclo empezado",
    JSON.stringify(selloAlta));

  // Mover con el <select> de la ficha, que es el otro camino además de arrastrar
  const moverA = async (col) => {
    await page.ev(`[...document.querySelectorAll('#board .card')]
        .find(x=>x.textContent.includes('Medir el flujo')).click();`);
    await sleep(250);
    await page.ev(`const s=document.getElementById('cdCol'); s.value='${col}';
      s.dispatchEvent(new Event('change',{bubbles:true}));`);
    await sleep(250);
    await page.ev("document.getElementById('cdDone').click()");
    await sleep(250);
  };
  const sello = () => page.ev(`const c=JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.find(c=>c.t==='Medir el flujo');
    return { st: c.st, dn: c.dn, ca: c.ca };`);

  await moverA("inprogress");
  const enCurso = await sello();
  check(enCurso.st !== "" && enCurso.dn === "" && enCurso.ca !== "",
    "entrar en trabajo sella el inicio del ciclo y la entrada a la columna", JSON.stringify(enCurso));
  check(await page.ev(`const c=[...document.querySelectorAll('#board .card')]
      .find(x=>x.textContent.includes('Medir el flujo'));
    return !!c.querySelector('.cage');`),
    "la tarjeta en curso muestra su edad en la columna");

  await moverA("done");
  const cerrada = await sello();
  check(cerrada.dn !== "" && cerrada.st === enCurso.st,
    "cerrarla sella la fecha de fin y conserva la de inicio", JSON.stringify(cerrada));

  await moverA("inprogress");
  const reabierta = await sello();
  check(reabierta.dn === "" && reabierta.st === enCurso.st,
    "reabrirla borra la fecha de fin: ya no está terminada", JSON.stringify(reabierta));

  check(await page.ev(`const t=[...document.querySelectorAll('#stats .stat .l')].map(e=>e.textContent);
    return t.includes('WIP') && t.includes('Throughput') && t.includes('⚑ Añejas');`),
    "la tira de la cabecera trae los KPI de flujo",
    await page.ev(`return [...document.querySelectorAll('#stats .stat .l')].map(e=>e.textContent).join('|')`));

  // El WIP no depende del filtro: mide la carga real del equipo
  const wipSinFiltro = await page.ev(`return [...document.querySelectorAll('#stats .stat')]
      .find(s=>s.querySelector('.l').textContent==='WIP').querySelector('.n').textContent.trim();`);
  await page.ev(`document.getElementById('wsToggle').click();`);
  await sleep(150);
  await page.ev(`const chip=document.querySelector('#wsFilters .chip'); if (chip) chip.click();`);
  await sleep(300);
  const wipFiltrado = await page.ev(`return [...document.querySelectorAll('#stats .stat')]
      .find(s=>s.querySelector('.l').textContent==='WIP').querySelector('.n').textContent.trim();`);
  check(wipSinFiltro === wipFiltrado,
    "filtrar por frente no cambia el WIP", `${wipSinFiltro} vs ${wipFiltrado}`);
  await page.ev(`const c=document.getElementById('wsClear'); if (c) c.click();`);
  await sleep(300);

  await page.ev("document.getElementById('menuBtn').click()");
  await sleep(150);
  await page.ev("document.getElementById('metricsBtn').click()");
  await sleep(300);
  const panel = await page.ev(`const o=document.getElementById('metricsOverlay');
    return { abierto: o.classList.contains('open'),
             tiles: o.querySelectorAll('#metricsBody .stat').length,
             filas: o.querySelectorAll('#metricsBody .mt-table tbody tr').length,
             barras: o.querySelectorAll('#metricsBody .mt-bar-row').length };`);
  check(panel.abierto && panel.tiles >= 9 && panel.filas === 5 && panel.barras >= 8,
    "el panel de métricas abre con sus tiles, sus barras y una fila por columna",
    JSON.stringify(panel));

  await page.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await sleep(250);
  check(await page.ev(`const o=document.getElementById('metricsOverlay');
    return !o.classList.contains('open') && o.getClientRects().length === 0;`),
    "Escape cierra el panel y deja de ocupar sitio");

  // La copia offline no puede llevar dentro las métricas de quien la descarga
  check(await page.ev(`return window.__snapshotIds ? true :
    (document.getElementById('metricsBody') !== null);`),
    "el panel de métricas existe para poder vaciarse en la copia offline");

  // Devolver la tarjeta a Backlog para no alterar las pruebas siguientes
  await moverA("backlog");

  // -- Papelera: una tarjeta eliminada se recupera --
  const antesPapelera = await page.ev("return document.querySelectorAll('#board .card').length");
  await page.ev(`[...document.querySelectorAll('#board .card')]
      .find(c=>c.textContent.includes('Comprar materiales')).click();`);
  await sleep(250);
  await page.ev(`const del=document.getElementById('cdDelete'); del.click(); del.click();`);
  await sleep(300);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === antesPapelera - 1,
    "eliminar una tarjeta la quita del tablero");
  check((await page.ev("return document.getElementById('trashBtn').textContent")).includes("(1)"),
    "el botón de papelera cuenta lo eliminado",
    await page.ev("return document.getElementById('trashBtn').textContent"));
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_trash_personal'))
      .some(e=>e.kind==='card' && e.data.t==='Comprar materiales');`),
    "la tarjeta eliminada queda guardada en la papelera del tablero");

  await page.ev("document.getElementById('trashBtn').click()");
  await sleep(200);
  check(await page.ev("return document.querySelectorAll('#trashList .trash-row').length") === 1,
    "la papelera muestra la entrada");
  await page.ev("document.querySelector('#trashList .trash-restore').click()");
  await sleep(300);
  await page.ev("document.getElementById('trashClose').click()");
  await sleep(150);
  check(await page.ev("return document.querySelectorAll('#board .card').length") === antesPapelera,
    "restaurar la devuelve al tablero");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.some(c=>c.t==='Comprar materiales');`),
    "la tarjeta restaurada queda persistida");
  check(await page.ev("return JSON.parse(localStorage.getItem('kanban_trash_personal')).length") === 0,
    "al restaurar se vacía su entrada de la papelera");

  // -- Papelera: un frente eliminado vuelve con sus tarjetas --
  const antesSopo = await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.filter(c=>c.ws==='SOPO').map(c=>c.id);`);
  check(antesSopo.length > 0, "hay tarjetas en el frente que se va a eliminar", JSON.stringify(antesSopo));
  await page.ev(`document.getElementById('cfgBtn').click();
    const fila=[...document.querySelectorAll('.ws-row')].find(r=>r.querySelector('.key').textContent==='SOPO');
    fila.querySelector('.del').click();`);
  await sleep(250);
  await page.ev(`const bar=document.querySelector('.ws-reassign');
    bar.querySelector('select').value='GEN';
    bar.querySelectorAll('button')[0].click();`);
  await sleep(300);
  await page.ev("document.getElementById('cfgClose').click()");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .ws.every(w=>w.key!=='SOPO');`), "el frente desaparece del tablero");
  const entradaWs = await page.ev(`const t=JSON.parse(localStorage.getItem('kanban_trash_personal'))[0];
    return { kind: t.kind, key: t.data.key, reassignedTo: t.reassignedTo, cards: t.cards.length };`);
  check(entradaWs.kind === "ws" && entradaWs.key === "SOPO" &&
        entradaWs.reassignedTo === "GEN" && entradaWs.cards === antesSopo.length,
    "la papelera guarda el frente, a dónde fueron sus tarjetas y cuáles eran",
    JSON.stringify(entradaWs));

  await page.ev(`document.getElementById('trashBtn').click();
    document.querySelector('#trashList .trash-restore').click();`);
  await sleep(300);
  await page.ev("document.getElementById('trashClose').click()");
  const trasSopo = await page.ev(`return JSON.parse(localStorage.getItem('kanban_board_personal'))
      .cards.filter(c=>c.ws==='SOPO').map(c=>c.id);`);
  check(JSON.stringify(trasSopo.sort()) === JSON.stringify(antesSopo.sort()),
    "restaurar el frente devuelve sus tarjetas", JSON.stringify({ antesSopo, trasSopo }));

  // -- Tableros: borrado suave y recuperación --
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev("document.getElementById('newBoardName').value='Temporal';" +
                "document.getElementById('newBoardCreate').click();");
  await sleep(400);
  await page.ev(`const b=document.querySelector('[data-col="backlog"] .add-btn'); b.click();
    const f=b.parentNode.querySelector('.add-form'); f.querySelector('.f-title').value='Tarea del temporal';
    f.querySelector('.f-save').click();`);
  await sleep(250);
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev(`const r=[...document.querySelectorAll('#boardList .bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Temporal'));
    const d=r.querySelector('.bs-delete'); d.click(); d.click();`);
  await sleep(350);
  check(await page.ev("return document.getElementById('deletedBoardsSection').hidden") === false,
    "la sección de tableros eliminados aparece al eliminar uno");
  check(await page.ev(`return [...document.querySelectorAll('#deletedBoards .bs-item')]
      .some(r=>r.textContent.includes('Temporal'));`),
    "el tablero eliminado se lista como recuperable");
  check(await page.ev("return !!localStorage.getItem('kanban_board_temporal')"),
    "el contenido del tablero eliminado NO se borra");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
      .find(b=>b.slug==='temporal').deletedAt ? true : false;`),
    "la entrada del índice queda marcada con su fecha de borrado");
  check(await page.ev(`return [...document.querySelectorAll('#boardList .bs-item .bs-name')]
      .every(n=>!n.textContent.startsWith('Temporal'));`),
    "y ya no aparece en la lista de tableros");

  await page.ev(`[...document.querySelectorAll('#deletedBoards .bs-item')]
      .find(r=>r.textContent.includes('Temporal')).querySelector('.bs-restore').click();`);
  await sleep(350);
  check(await page.ev(`return [...document.querySelectorAll('#boardList .bs-item .bs-name')]
      .some(n=>n.textContent.startsWith('Temporal'));`),
    "restaurarlo lo devuelve a la lista");
  await page.ev(`[...document.querySelectorAll('#boardList .bs-name')]
      .find(b=>b.textContent.startsWith('Temporal')).click();`);
  await sleep(400);
  check((await page.cards()).includes("Tarea del temporal"),
    "el tablero recuperado abre con su contenido intacto");

  // -- Purga: el borrado definitivo sí borra --
  await page.ev("document.getElementById('resetBtn').click()");
  await sleep(200);
  await page.ev(`const r=[...document.querySelectorAll('#boardList .bs-item')]
      .find(x=>x.querySelector('.bs-name').textContent.startsWith('Temporal'));
    const d=r.querySelector('.bs-delete'); d.click(); d.click();`);
  await sleep(350);
  await page.ev(`const r=[...document.querySelectorAll('#deletedBoards .bs-item')]
      .find(x=>x.textContent.includes('Temporal'));
    const d=r.querySelector('.bs-delete'); d.click(); d.click();`);
  await sleep(350);
  check(await page.ev("return localStorage.getItem('kanban_board_temporal') === null"),
    "la purga sí borra el contenido");
  check(await page.ev(`return JSON.parse(localStorage.getItem('kanban_boards'))
      .every(b=>b.slug!=='temporal');`), "y saca la entrada del índice");
  await page.ev("document.getElementById('boardSelectorClose').click()");
  await sleep(200);

  // -- Tipografías locales --
  check(await page.ev("return getComputedStyle(document.querySelector('h1')).fontFamily.includes('Chakra Petch')"),
    "las tipografías embebidas se aplican");
  check(await page.ev("return document.fonts.size") === 10, "las 10 caras van embebidas en el archivo");
  check(await page.ev("return performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('http://127.0.0.1:" + PORT + "')).length") === 0,
    "la app no hace ninguna petición externa");

  process.exitCode = report([page]) ? 1 : 0;
} finally {
  killBrowsers();
  server.close();
}
