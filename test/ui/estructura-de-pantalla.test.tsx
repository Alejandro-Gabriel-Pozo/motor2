import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ANCHO_DEL_MENU,
  PUNTOS_DE_CORTE,
  anchoDelContenido,
  columnasDeLaRejilla,
  dondeSeDesplaza,
  encabezadoFijo,
  rellenoDelContenido,
} from "../../src/ui/componentes/estructura/reglas";
import { ContenedorDePagina } from "../../src/ui/componentes/estructura/contenedor-de-pagina";
import { EncabezadoDePagina } from "../../src/ui/componentes/estructura/encabezado-de-pagina";
import { RejillaDeSecciones, SeccionDeRejilla } from "../../src/ui/componentes/estructura/rejilla-de-secciones";
import { ORACULO, PUNTOS_DE_CORTE_DECLARADOS } from "./estructura-de-pantalla.oraculo";

const DIR_PIEZAS = join(__dirname, "../../src/ui/componentes/estructura");

describe("estructura de pantalla: reglas contra el oráculo (todas las combinaciones)", () => {
  for (const f of ORACULO) {
    it(`${f.ancho} px, menú ${f.menu}`, () => {
      const menu = f.menu === "sin-lateral" ? "abierto" : f.menu;
      expect(dondeSeDesplaza(f.ancho)).toBe(f.seDesplaza);
      expect(encabezadoFijo(f.ancho)).toBe(f.encabezadoDelShellFijo);
      expect(columnasDeLaRejilla(f.ancho)).toBe(f.columnasDeLaRejilla);
      expect(rellenoDelContenido(f.ancho)).toBe(f.rellenoPx);
      expect(anchoDelContenido(f.ancho, menu)).toBe(f.anchoDelContenidoPx);
    });
  }

  it("las columnas NO dependen del menú: al plegarlo la pantalla no salta de 1 a 2 columnas", () => {
    // La función recibe solo el ancho de la ventana: no hay forma de pasarle el estado del menú.
    expect(columnasDeLaRejilla.length).toBe(1);
  });

  it("nunca hay una columna de rejilla de menos de 480 px a los anchos del diseño (1366 abierto: 2 columnas)", () => {
    for (const f of ORACULO.filter((x) => x.columnasDeLaRejilla === 2)) expect((f.anchoDelContenidoPx - 16) / 2).toBeGreaterThanOrEqual(480);
  });

  it("el menú abierto mide lo de SidebarColapsable (w-56 + la lengüeta de w-5)", () => {
    expect(ANCHO_DEL_MENU).toEqual({ abierto: 244, colapsado: 20 });
  });
});

describe("estructura de pantalla: las piezas usan los puntos de corte de reglas.ts", () => {
  const PX_DE_TAILWIND: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };

  it("el oráculo y reglas.ts declaran los mismos puntos de corte, y valen lo que vale en Tailwind", () => {
    expect(Object.keys(PUNTOS_DE_CORTE).sort()).toEqual([...PUNTOS_DE_CORTE_DECLARADOS].sort());
    for (const [nombre, px] of Object.entries(PUNTOS_DE_CORTE)) expect(PX_DE_TAILWIND[nombre]).toBe(px);
  });

  it("GUARDIÁN: ninguna pieza usa un punto de corte que no esté declarado en el oráculo (una dimensión nueva exige declararla)", () => {
    for (const archivo of readdirSync(DIR_PIEZAS).filter((a) => a.endsWith(".tsx"))) {
      const usados = new Set([...readFileSync(join(DIR_PIEZAS, archivo), "utf8").matchAll(/(?<![\w-])(sm|md|lg|xl|2xl):/g)].map((m) => m[1]));
      for (const u of usados) expect(PUNTOS_DE_CORTE_DECLARADOS as readonly string[], `${archivo} usa «${u}:» y no está declarado`).toContain(u);
    }
  });

  it("ContenedorDePagina: ancho máximo de 80 rem centrado y relleno 16 → 24", () => {
    const html = renderToStaticMarkup(<ContenedorDePagina>x</ContenedorDePagina>);
    expect(html).toContain("max-w-[80rem]");
    expect(html).toContain("mx-auto");
    expect(html).toContain("p-4");
    expect(html).toContain("md:p-6");
  });

  it("RejillaDeSecciones: 1 columna y 2 desde xl; una sección completa ocupa las dos; las secciones llevan min-w-0", () => {
    const html = renderToStaticMarkup(
      <RejillaDeSecciones>
        <SeccionDeRejilla>a</SeccionDeRejilla>
        <SeccionDeRejilla completa>b</SeccionDeRejilla>
      </RejillaDeSecciones>
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("xl:grid-cols-2");
    expect(html).toContain("xl:col-span-2");
    expect(html.match(/min-w-0/g)?.length).toBe(2);
  });

  it("EncabezadoDePagina: grupo con nombre, pegado arriba solo desde md (en celular no se fija)", () => {
    const html = renderToStaticMarkup(<EncabezadoDePagina etiqueta="Acciones">x</EncabezadoDePagina>);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Acciones"');
    expect(html).toContain("md:sticky");
    expect(html).not.toMatch(/(?<![\w:-])sticky/);
  });
});
