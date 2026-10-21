import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotonActivarDesactivar } from "../../src/components/boton-activar-desactivar";

/**
 * DENSIDAD de las acciones de fila (Fase 6, ola de primitivas): «Desactivar», «Sí, desactivar», «Cancelar»… eran enlaces o botones de texto de ~20 px; al migrar a `Boton` con
 * `tamano="compacto"` pasaron a 32 px (+ `px-3`) desde `md:` y cada fila de una lista de escritorio creció 12 px. Estas acciones usan `tamano="en-fila"`: 44 px en celular y la altura del
 * texto desde `md:`, sin relleno horizontal (la medida real la miran las capturas y `movil-acciones-de-texto.spec.ts`; acá, la clase que dibuja cada botón).
 *
 * Entorno de Vitest = Node: lo que se dibuja sin interactuar se mira en el HTML del servidor; los botones que solo aparecen con el estado abierto (la confirmación) se miran en el
 * código fuente, etiqueta por etiqueta.
 */
const FUENTES = {
  activarDesactivar: "src/components/boton-activar-desactivar.tsx",
} as const;

/** Las etiquetas de apertura `<Boton …>` (y `<BotonDeServidor …>`) de un archivo, completas: salta las llaves para no cortar en el `=>` de un `onClick`. */
function etiquetasDeBoton(archivo: string): string[] {
  const fuente = readFileSync(archivo, "utf8");
  const etiquetas: string[] = [];
  for (const m of fuente.matchAll(/<Boton(?:DeServidor)?(?=[\s>])/g)) {
    let profundidad = 0;
    let i = m.index;
    for (; i < fuente.length; i++) {
      const c = fuente[i];
      if (c === "{") profundidad++;
      else if (c === "}") profundidad--;
      else if (c === ">" && profundidad === 0) break;
    }
    etiquetas.push(fuente.slice(m.index, i + 1));
  }
  return etiquetas;
}

function clasesDeLosBotones(html: string): string[][] {
  return [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1].split(" "));
}

function esEnFila(clases: string[]): boolean {
  return clases.includes("min-h-11") && clases.includes("md:min-h-0") && !clases.some((c) => /^md:min-h-(?!0$)/.test(c)) && !clases.some((c) => /^px-/.test(c));
}

describe("BotonActivarDesactivar: acciones de la altura del texto en escritorio", () => {
  for (const activo of [true, false]) {
    it(`${activo ? "«Desactivar»" : "«Activar»"}: tamano en-fila (min-h-11, md:min-h-0, sin px)`, () => {
      const html = renderToStaticMarkup(<BotonActivarDesactivar activo={activo} ocupado={false} aviso="Saca el acceso." onCambiar={() => undefined} />);
      const botones = clasesDeLosBotones(html);
      expect(botones).toHaveLength(1);
      expect(esEnFila(botones[0]), botones[0].join(" ")).toBe(true);
    });
  }

  it("los cuatro botones del archivo (Activar, Desactivar, «Sí, desactivar» y Cancelar) usan tamano en-fila", () => {
    const etiquetas = etiquetasDeBoton(FUENTES.activarDesactivar);
    expect(etiquetas).toHaveLength(4);
    for (const e of etiquetas) expect(e, e).toContain('tamano="en-fila"');
  });
});
