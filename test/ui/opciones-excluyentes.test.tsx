import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpcionesExcluyentes, type OpcionExcluyente } from "../../src/ui/primitivas/opciones-excluyentes";

/**
 * Contrato de `OpcionesExcluyentes` (src/ui/primitivas/opciones-excluyentes.tsx): el grupo de radios con `fieldset` + `legend` (la pregunta se anuncia al entrar al grupo), cada opción con su
 * etiqueta atada y, si está deshabilitada, el motivo visible y conectado. Tiene dos presentaciones, `lista` (por defecto: lo que ya usan las pantallas) y `tarjetas` (recuadros de 44 px que se
 * tocan enteros); las dos cumplen lo mismo. Entorno de Vitest = Node: se mira el HTML del servidor.
 */
const opciones: readonly OpcionExcluyente[] = [
  { valor: "unidad", etiqueta: "Por unidad", ayuda: "Se vende de a uno" },
  { valor: "peso", etiqueta: "Por peso", deshabilitada: true, motivo: "Falta cargar la balanza" },
  { valor: "combo", etiqueta: "Combo" },
];
const dibujar = (extra: { presentacion?: "lista" | "tarjetas"; valorInicial?: string } = {}): string => renderToStaticMarkup(<OpcionesExcluyentes leyenda="¿Cómo se vende?" nombre="venta" opciones={opciones} {...extra} />);
const clasesDe = (html: string, etiqueta: string): string[] => (new RegExp(`<${etiqueta}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe.each(["lista", "tarjetas"] as const)("OpcionesExcluyentes, presentación %s", (presentacion) => {
  it("es un fieldset con su legend (la pregunta del grupo) antes de las opciones", () => {
    const html = dibujar({ presentacion });
    expect(html).toMatch(/^<fieldset[^>]*><legend[^>]*>¿Cómo se vende\?<\/legend>/);
    expect(html.indexOf("<legend")).toBeLessThan(html.indexOf("<input"));
  });

  it("cada opción es un radio del mismo name con su etiqueta atada por htmlFor/id", () => {
    const html = dibujar({ presentacion });
    const radios = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    for (const radio of radios) {
      expect(radio).toContain('type="radio"');
      expect(radio).toContain('name="venta"');
      const id = /\sid="([^"]+)"/.exec(radio)?.[1];
      expect(html, `etiqueta de ${id}`).toContain(`<label for="${id}"`);
    }
    expect(new Set(radios.map((r) => /\sid="([^"]+)"/.exec(r)?.[1])).size).toBe(3);
  });

  it("la opción elegida al abrir queda marcada y la deshabilitada dice por qué (visible y conectado)", () => {
    const html = dibujar({ presentacion, valorInicial: "combo" });
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="combo"/);
    const peso = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).find((r) => r.includes('value="peso"')) ?? "";
    expect(peso).toMatch(/\sdisabled(=""|\s|>)/);
    const motivo = /aria-describedby="([^"]+)"/.exec(peso)?.[1];
    expect(html).toContain(`<span id="${motivo}"`);
    expect(html).toContain("Falta cargar la balanza");
  });

  it("nunca trae sm:, modo oscuro ni colores de escala", () => {
    const html = dibujar({ presentacion });
    expect(html).not.toMatch(/(^|[\s":])dark:/);
    expect(html).not.toMatch(/(^|[\s":])sm:/);
    expect(html).not.toMatch(/(^|[\s":-])(?:neutral|gray|slate|zinc|stone|red|white|black)-\d/);
  });
});

describe("OpcionesExcluyentes: la presentación", () => {
  it("por defecto es la lista: es lo que ya dibujan sus dos pantallas, idéntico a pasarla explícita", () => {
    expect(dibujar()).toBe(dibujar({ presentacion: "lista" }));
    expect(dibujar()).not.toContain("border-borde-control");
    expect(dibujar()).toContain('<div class="flex items-start gap-2">');
  });

  it("las tarjetas son recuadros de tokens con piso de 44 px en celular, la elegida marcada con borde, y se tocan enteras", () => {
    const html = dibujar({ presentacion: "tarjetas" });
    const tarjeta = (/<div class="(relative [^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);
    for (const clase of ["border-borde-control", "bg-superficie", "text-tinta", "min-h-11", "md:min-h-9", "has-checked:border-tinta", "relative"]) expect(tarjeta, clase).toContain(clase);
    expect(clasesDe(html, "label")).toContain("after:inset-0");
    expect(html).not.toContain("tinta-tenue");
  });
});
