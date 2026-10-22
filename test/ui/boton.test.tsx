import type { MouseEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Boton, claseDeBoton, type TamanoDeBoton, type VarianteDeBoton } from "../../src/ui/primitivas/boton";

/**
 * Contrato de `Boton` (src/ui/primitivas/boton.tsx, contrato `primitiva-boton`): las 40 combinaciones de variante y tamaño, solo con tokens del sistema visual, sin modo oscuro, con el
 * punto de corte `md:` y la zona táctil de 44 px en celular. El comportamiento de `cargando` también se prueba en `primitivas-y-dialogo.test.tsx` (la prueba de la capa entera); acá se
 * prueba la estructura que dibuja cada combinación. Entorno de Vitest = Node: se mira el HTML del servidor y las props del elemento.
 */
const VARIANTES: Readonly<Record<VarianteDeBoton, string>> = {
  primario: "bg-tinta text-superficie hover:bg-tinta/85",
  acento: "bg-marca text-superficie hover:bg-marca-hover",
  secundario: "border border-borde-control bg-superficie text-tinta hover:bg-superficie-suave",
  peligro: "bg-error text-superficie hover:bg-error/90",
  enlace: "text-tinta-suave underline hover:text-tinta",
  "enlace-peligro": "text-error underline hover:decoration-2",
  "sobre-tinta": "border border-borde-sobre-tinta text-superficie hover:bg-superficie/10",
  interruptor: "border aria-pressed:border-ok aria-pressed:text-ok-tinta not-aria-pressed:border-error not-aria-pressed:bg-error-tinte not-aria-pressed:text-error",
};
/** La forma: `rounded` para todos y píldora (`rounded-full`) para el interruptor; nunca los dos radios a la vez. */
const FORMA: Readonly<Record<VarianteDeBoton, string>> = {
  primario: "rounded",
  acento: "rounded",
  secundario: "rounded",
  peligro: "rounded",
  enlace: "rounded",
  "enlace-peligro": "rounded",
  "sobre-tinta": "rounded",
  interruptor: "rounded-full",
};
/** El contorno del foco va por variante: `foco` (la tinta) salvo sobre un fondo oscuro, donde se ve `foco-sobre-tinta` (blanco). */
const FOCO: Readonly<Record<VarianteDeBoton, string>> = {
  primario: "focus-visible:outline-foco",
  acento: "focus-visible:outline-foco",
  secundario: "focus-visible:outline-foco",
  peligro: "focus-visible:outline-foco",
  enlace: "focus-visible:outline-foco",
  "enlace-peligro": "focus-visible:outline-foco",
  "sobre-tinta": "focus-visible:outline-foco-sobre-tinta",
  interruptor: "focus-visible:outline-foco",
};
const TAMANOS: Readonly<Record<TamanoDeBoton, string>> = {
  normal: "min-h-11 px-4 text-sm md:min-h-9 md:px-3",
  compacto: "min-h-11 px-3 text-sm md:min-h-8",
  chico: "min-h-11 px-2 text-xs md:min-h-7",
  tactil: "min-h-11 px-3 text-sm",
  "en-fila": "min-h-11 text-sm md:min-h-0",
};
/** Los tamaños que bajan de alto desde `md:`; `tactil` mide 44 px en cualquier ancho. */
const TAMANOS_QUE_BAJAN: readonly TamanoDeBoton[] = ["normal", "compacto", "chico", "en-fila"];

const clases = (html: string): string[] => (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);
const propsDe = (e: ReactElement): Record<string, unknown> => e.props as Record<string, unknown>;

describe("Boton: variantes y tamaños", () => {
  for (const [variante, esperadas] of Object.entries(VARIANTES) as [VarianteDeBoton, string][]) {
    for (const [tamano, esperadosDelTamano] of Object.entries(TAMANOS) as [TamanoDeBoton, string][]) {
      it(`${variante} / ${tamano}: las clases de la variante y del tamaño, y la base accesible`, () => {
        const html = renderToStaticMarkup(
          <Boton variante={variante} tamano={tamano}>
            Guardar
          </Boton>,
        );
        const dibujadas = clases(html);
        for (const clase of [...esperadas.split(" "), ...esperadosDelTamano.split(" ")]) expect(dibujadas, `${variante}/${tamano} sin «${clase}»`).toContain(clase);
        // Foco con el token de SU variante y forma del sistema.
        for (const clase of [FORMA[variante], "font-medium", "focus-visible:outline-2", "focus-visible:outline-offset-2", FOCO[variante]]) expect(dibujadas, `${variante}/${tamano} sin «${clase}»`).toContain(clase);
        // Un solo color de contorno: el de la variante, nunca los dos.
        expect(dibujadas.filter((c) => /^focus-visible:outline-(?!2$|offset)/.test(c)), `${variante}/${tamano}`).toEqual([FOCO[variante]]);
        expect(dibujadas.filter((c) => /^rounded/.test(c)), `${variante}/${tamano}: un solo radio`).toEqual([FORMA[variante]]);
        expect(html).toContain('type="button"');
        expect(html).toContain(">Guardar</button>");
      });
    }
  }

  it("el botón por defecto es primario y normal", () => {
    const porDefecto = clases(renderToStaticMarkup(<Boton>x</Boton>));
    const explicito = clases(renderToStaticMarkup(<Boton variante="primario" tamano="normal">x</Boton>));
    expect(porDefecto).toEqual(explicito);
  });

  it("solo tokens del sistema visual: ningún color de la escala de Tailwind, ni blanco/negro, ni modo oscuro, ni el corte sm:", () => {
    for (const variante of Object.keys(VARIANTES) as VarianteDeBoton[]) {
      for (const tamano of Object.keys(TAMANOS) as TamanoDeBoton[]) {
        const clase = claseDeBoton(variante, tamano);
        expect(clase, `${variante}/${tamano}`).not.toMatch(/(^|[\s:])dark:/);
        expect(clase, `${variante}/${tamano}`).not.toMatch(/(^|[\s:])sm:/);
        expect(clase, `${variante}/${tamano}`).not.toMatch(/(^|[:\s-])(?:neutral|gray|slate|zinc|stone|red|white|black)(?:-\d+)?(?=[\s/]|$)/);
        expect(clase, `${variante}/${tamano}`).not.toMatch(/\[[^\]]*\]/);
      }
    }
  });

  it("zona táctil de 44 px en celular y el tamaño compacto solo desde md:", () => {
    for (const variante of Object.keys(VARIANTES) as VarianteDeBoton[]) {
      for (const tamano of TAMANOS_QUE_BAJAN) {
        const dibujadas = claseDeBoton(variante, tamano).split(" ");
        expect(dibujadas, `${variante}/${tamano}`).toContain("min-h-11");
        // Toda altura menor está detrás de `md:`: sin `min-h-*` sin prefijo que no sea la de 44 px.
        expect(dibujadas.filter((c) => /^min-h-/.test(c)), `${variante}/${tamano}`).toEqual(["min-h-11"]);
        expect(dibujadas.some((c) => /^md:min-h-/.test(c))).toBe(true);
      }
    }
  });

  it("tamano tactil: 44 px en cualquier ancho (sin ninguna altura detrás de md:)", () => {
    for (const variante of Object.keys(VARIANTES) as VarianteDeBoton[]) {
      const dibujadas = claseDeBoton(variante, "tactil").split(" ");
      expect(dibujadas.filter((c) => /min-h-/.test(c)), variante).toEqual(["min-h-11"]);
      expect(dibujadas.some((c) => /^md:/.test(c)), `${variante}: ninguna clase de md:`).toBe(false);
    }
  });

  it("tamano en-fila: 44 px en celular y la altura del texto desde md:, sin ningún relleno horizontal (la fila de escritorio no crece)", () => {
    for (const variante of Object.keys(VARIANTES) as VarianteDeBoton[]) {
      const dibujadas = claseDeBoton(variante, "en-fila").split(" ");
      expect(dibujadas.filter((c) => /min-h-/.test(c)), variante).toEqual(["min-h-11", "md:min-h-0"]);
      expect(dibujadas.filter((c) => /^(md:)?p[xylrtb]?-/.test(c)), `${variante}: sin relleno propio`).toEqual([]);
    }
  });

  it("sobre-tinta: contorno translúcido, texto blanco y foco blanco (no la tinta, que no se ve sobre la barra oscura)", () => {
    const dibujadas = clases(renderToStaticMarkup(<Boton variante="sobre-tinta">Deshacer</Boton>));
    expect(dibujadas).toContain("focus-visible:outline-foco-sobre-tinta");
    expect(dibujadas).not.toContain("focus-visible:outline-foco");
  });

  it("interruptor: píldora de dos estados por aria-pressed (ok marcado, error con su tinte sin marcar), 44 px siempre con tactil y deshabilitado al 70 % con cursor de «no permitido»", () => {
    const dibujadas = clases(renderToStaticMarkup(<Boton variante="interruptor" tamano="tactil" aria-pressed={false}>Agotada</Boton>));
    for (const clase of ["rounded-full", "border", "aria-pressed:border-ok", "aria-pressed:text-ok-tinta", "not-aria-pressed:border-error", "not-aria-pressed:bg-error-tinte", "not-aria-pressed:text-error", "disabled:cursor-not-allowed", "disabled:opacity-70", "min-h-11"]) {
      expect(dibujadas, clase).toContain(clase);
    }
    expect(dibujadas).not.toContain("disabled:opacity-50");
    expect(renderToStaticMarkup(<Boton variante="interruptor" aria-pressed={true}>Disponible</Boton>)).toMatch(/<button[^>]*\saria-pressed="true"/);
    // Las demás variantes siguen al 50 % y con el radio común.
    expect(clases(renderToStaticMarkup(<Boton>x</Boton>))).toContain("disabled:opacity-50");
  });

  it("className se suma al final sin quitar las clases del sistema", () => {
    const dibujadas = clases(renderToStaticMarkup(<Boton className="w-full">x</Boton>));
    expect(dibujadas[dibujadas.length - 1]).toBe("w-full");
    expect(dibujadas).toContain("min-h-11");
  });
});

describe("Boton: accesibilidad y estado cargando", () => {
  const clic = (el: ReactElement, preventDefault = vi.fn()) => (propsDe(el).onClick as (e: MouseEvent<HTMLButtonElement>) => void)({ preventDefault } as unknown as MouseEvent<HTMLButtonElement>);

  it("cargando: aria-busy, el clic no llega al consumidor y se frena el envío del formulario", () => {
    const alClic = vi.fn();
    const preventDefault = vi.fn();
    const enCurso = Boton({ cargando: true, onClick: alClic, type: "submit", children: "Cobrar" });
    clic(enCurso, preventDefault);
    expect(alClic).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(<Boton cargando>Cobrar</Boton>)).toContain('aria-busy="true"');
    // El atributo (no la variante de Tailwind `aria-busy:`, que sí está en la clase).
    expect(renderToStaticMarkup(<Boton>Cobrar</Boton>)).not.toMatch(/<button[^>]*\saria-busy=/);
  });

  it("sin cargando el clic llega al consumidor y no se frena nada", () => {
    const alClic = vi.fn();
    const preventDefault = vi.fn();
    clic(Boton({ onClick: alClic, children: "Cobrar" }), preventDefault);
    expect(alClic).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("cargando no pone el atributo disabled (se perdería el foco del teclado); disabled sí", () => {
    expect(renderToStaticMarkup(<Boton cargando>Cobrar</Boton>)).not.toMatch(/<button[^>]*\sdisabled[\s=>]/);
    expect(renderToStaticMarkup(<Boton disabled>Cobrar</Boton>)).toMatch(/<button[^>]*\sdisabled[\s=>]/);
  });
});
