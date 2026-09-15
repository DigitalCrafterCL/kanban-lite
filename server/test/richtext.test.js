// El renderizador de texto enriquecido de las descripciones. Vive en el
// cliente (src/js/richtext.js) pero no toca el DOM, así que se prueba aquí con
// node:test junto al resto.
import test from "node:test";
import assert from "node:assert/strict";
import { renderRich, plainRich, shortRich, taskProgress, toggleTask } from "../../src/js/richtext.js";

test("los marcadores inline se convierten en etiquetas", () => {
  const html = renderRich("Hola **fuerte** y *flojo* y ~~fuera~~");
  assert.match(html, /<strong>fuerte<\/strong>/);
  assert.match(html, /<em>flojo<\/em>/);
  assert.match(html, /<del>fuera<\/del>/);
});

test("cada línea es su propio párrafo y las vacías separan bloques", () => {
  const html = renderRich("una\ndos\n\ntres");
  assert.equal((html.match(/class="rt-p"/g) || []).length, 3);
  assert.match(html, /rt-gap/);
});

test("nada de lo que escriba el usuario se interpreta como HTML", () => {
  const html = renderRich('<img src=x onerror="alert(1)"> **b**');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>b<\/strong>/);
});

test("las subtareas llevan su número de línea para poder marcarse", () => {
  const html = renderRich("intro\n- [ ] pendiente\n- [x] hecha");
  assert.match(html, /data-line="1"[^>]*aria-label/);
  assert.match(html, /data-line="2" checked/);
  assert.equal((html.match(/<li class="rt-task/g) || []).length, 2);
});

test("las viñetas y las subtareas son listas distintas", () => {
  const html = renderRich("- suelta\n- [ ] tarea");
  assert.match(html, /<ul class="rt-list">/);
  assert.match(html, /<ul class="rt-tasks">/);
});

test("taskProgress cuenta sólo las subtareas", () => {
  assert.deepEqual(taskProgress("- [x] a\n- [ ] b\n- suelta\ntexto"), { done: 1, total: 2 });
  assert.deepEqual(taskProgress(""), { done: 0, total: 0 });
});

test("toggleTask invierte la casilla de una línea concreta", () => {
  assert.equal(toggleTask("- [ ] a\n- [x] b", 0), "- [x] a\n- [x] b");
  assert.equal(toggleTask("- [ ] a\n- [x] b", 1), "- [ ] a\n- [ ] b");
});

test("toggleTask devuelve null si esa línea ya no es una subtarea", () => {
  // Es el caso de una descripción que cambió por debajo (deshacer, importación
  // o sincronización): la casilla del DOM ya no corresponde a esa línea.
  assert.equal(toggleTask("texto suelto", 0), null);
  assert.equal(toggleTask("- [ ] a", 7), null);
});

test("plainRich deja el texto sin marcadores para tooltips y búsquedas", () => {
  assert.equal(plainRich("**Hola**\n- [x] hecho\n- [ ] no\n- suelta"), "Hola ✓ hecho ○ no • suelta");
});

// -- Recorte para la vista previa de la tarjeta -----------------------------

test("shortRich recorta por palabras y cierra los marcadores partidos", () => {
  const r = shortRich("Una **descripción larguísima** que no cabe entera en la tarjeta de la columna", 40, 4);
  assert.equal(r.truncated, true);
  assert.match(r.text, /…$/);
  // Un `**` impar dejaría asteriscos sueltos a la vista.
  assert.equal(((r.text.match(/\*\*/g) || []).length) % 2, 0);
  assert.doesNotMatch(renderRich(r.text), /\*/);
});

test("shortRich no parte una palabra por la mitad", () => {
  const r = shortRich("alfa beta gamma delta epsilon", 14, 4);
  assert.equal(r.text, "alfa beta …");
});

test("shortRich respeta el límite de líneas", () => {
  const r = shortRich("a\nb\nc\nd\ne\nf", 500, 3);
  assert.equal(r.text, "a\nb\nc …");
  assert.equal(r.truncated, true);
});

test("shortRich conserva los índices de línea de las subtareas", () => {
  // Se recorta por el final, así que la casilla de la línea 2 sigue siendo la
  // línea 2 del texto completo y toggleTask() marca la correcta.
  const r = shortRich("intro\n- [ ] una\n- [ ] dos\n- [ ] tres\n- [ ] cuatro", 500, 3);
  assert.match(renderRich(r.text), /data-line="2"/);
  assert.doesNotMatch(renderRich(r.text), /data-line="3"/);
});

test("shortRich deja el texto tal cual cuando cabe", () => {
  const r = shortRich("corto y **claro**", 200, 4);
  assert.deepEqual(r, { text: "corto y **claro**", truncated: false });
});

test("shortRich descarta un elemento de lista que quedó sin texto", () => {
  const r = shortRich("- [ ] una\n- [ ] ", 500, 4);
  assert.equal(r.text, "- [ ] una …");
});

test("shortRich no deja media casilla de subtarea a la vista", () => {
  // Cortar "- [x] hecho" por dentro del marcador dejaba una viñeta con un
  // "[x" suelto en la tarjeta.
  const r = shortRich("intro corta\n- [x] hecho", 16, 4);
  assert.equal(r.text, "intro corta …");
  assert.doesNotMatch(renderRich(r.text), /\[x/);
});
