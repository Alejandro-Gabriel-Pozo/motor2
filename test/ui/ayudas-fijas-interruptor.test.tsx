import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Campo } from "../../src/ui/primitivas/campo";
import { Selector } from "../../src/ui/primitivas/selector";
import { AreaDeTexto } from "../../src/ui/primitivas/area-de-texto";
import { Casilla } from "../../src/ui/primitivas/casilla";
import { AyudaCampo } from "../../src/components/ayuda-campo";

/**
 * Interruptor de las AYUDAS FIJAS de todo el sistema (`AYUDAS_FIJAS_VISIBLES`, `src/ui/primitivas/ayudas-fijas-visibles.ts`; Frente «Visual», V5): los DOS estados. Apagado (hoy) la ayuda fija
 * (`ayuda=`, `AyudaCampo`) NO se dibuja ni se anuncia, pero SÍ el aviso condicional (`aviso=`), el error y la lectura; encendido, la ayuda vuelve tal cual (reversibilidad). La sustancia de cada
 * primitiva con la ayuda encendida está en `campo.test.tsx`, `selector.test.tsx`, `area-de-texto.test.tsx` y `casilla.test.tsx` (que fijan el interruptor en `true`).
 */
const interruptor = vi.hoisted(() => ({ visibles: false }));
vi.mock("../../src/ui/primitivas/ayudas-fijas-visibles", () => ({
  get AYUDAS_FIJAS_VISIBLES() {
    return interruptor.visibles;
  },
}));

afterEach(() => {
  interruptor.visibles = false;
});

const AYUDA = "Texto fijo de ayuda";
const AVISO = "No tenés el permiso para esto.";

describe("AYUDAS_FIJAS_VISIBLES: apagado (el estado de hoy)", () => {
  it("el valor por defecto del interruptor es false (todo nace cerrado)", () => {
    expect(readFileSync(join(__dirname, "../../src/ui/primitivas/ayudas-fijas-visibles.ts"), "utf8")).toMatch(/export const AYUDAS_FIJAS_VISIBLES: boolean = false;/);
  });

  it("ninguna primitiva dibuja `ayuda`, pero todas dibujan `aviso` y lo anuncian; el error queda", () => {
    interruptor.visibles = false;
    const html = {
      campo: renderToStaticMarkup(<Campo etiqueta="x" ayuda={AYUDA} aviso={AVISO} error="Falta" />),
      selector: renderToStaticMarkup(<Selector etiqueta="x" ayuda={AYUDA} aviso={AVISO} error="Falta"><option>a</option></Selector>),
      area: renderToStaticMarkup(<AreaDeTexto etiqueta="x" ayuda={AYUDA} aviso={AVISO} error="Falta" />),
      casilla: renderToStaticMarkup(<Casilla etiqueta="x" ayuda={AYUDA} aviso={AVISO} error="Falta" />),
    };
    for (const [nombre, h] of Object.entries(html)) {
      expect(h, `${nombre}: sin ayuda`).not.toContain(AYUDA);
      expect(h, `${nombre}: sin id de ayuda`).not.toMatch(/-ayuda/);
      expect(h, `${nombre}: con aviso`).toContain(AVISO);
      expect(h, `${nombre}: aviso descrito`).toMatch(/aria-describedby="[^"]*-aviso/);
      expect(h, `${nombre}: con error`).toContain('role="alert"');
    }
  });

  it("AyudaCampo no dibuja nada", () => {
    interruptor.visibles = false;
    expect(renderToStaticMarkup(<AyudaCampo>{AYUDA}</AyudaCampo>)).toBe("");
  });
});

describe("AYUDAS_FIJAS_VISIBLES: encendido (reversibilidad)", () => {
  it("las primitivas dibujan `ayuda` y la anuncian, además del aviso", () => {
    interruptor.visibles = true;
    const html = [
      renderToStaticMarkup(<Campo etiqueta="x" ayuda={AYUDA} aviso={AVISO} />),
      renderToStaticMarkup(<Selector etiqueta="x" ayuda={AYUDA} aviso={AVISO}><option>a</option></Selector>),
      renderToStaticMarkup(<AreaDeTexto etiqueta="x" ayuda={AYUDA} aviso={AVISO} />),
      renderToStaticMarkup(<Casilla etiqueta="x" ayuda={AYUDA} aviso={AVISO} />),
    ];
    for (const h of html) {
      expect(h).toContain(AYUDA);
      expect(h).toContain(AVISO);
      expect(h).toMatch(/aria-describedby="[^"]*-ayuda[^"]*-aviso/);
    }
  });

  it("AyudaCampo vuelve a dibujar su texto", () => {
    interruptor.visibles = true;
    expect(renderToStaticMarkup(<AyudaCampo>{AYUDA}</AyudaCampo>)).toContain(AYUDA);
  });
});
