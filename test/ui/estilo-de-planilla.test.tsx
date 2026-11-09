import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApartadoDePlanilla } from "../../src/ui/componentes/estructura/apartado-de-planilla";
import { BarraDeFiltros } from "../../src/ui/componentes/estructura/barra-de-filtros";

/** Piezas del estilo de planilla (docs/diseno-estilo-de-planilla-2026-11-09.md): puro markup de servidor, solo tokens. */
describe("ApartadoDePlanilla", () => {
  it("es una sección con contorno, nombrada por su título (h2), con la descripción en una línea", () => {
    const html = renderToStaticMarkup(
      <ApartadoDePlanilla titulo="Lista de productos" descripcion="Buscá y operá.">
        <p>cuerpo</p>
      </ApartadoDePlanilla>,
    );
    expect(html).toMatch(/<section aria-labelledby="([^"]+)"[^>]*class="[^"]*border-borde/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain("Lista de productos");
    expect(html).toContain("Buscá y operá.");
    expect(html).toContain("<p>cuerpo</p>");
    expect(html, "sin enlace no hay «Ver todo»").not.toContain("Ver todo");
  });

  it("«Ver todo →» solo aparece si se pide, con su destino; un texto propio lo reemplaza", () => {
    const con = renderToStaticMarkup(
      <ApartadoDePlanilla titulo="Compras" verTodo={{ href: "/compras" }}>
        x
      </ApartadoDePlanilla>,
    );
    expect(con).toMatch(/<a [^>]*href="\/compras"[^>]*>Ver todo →<\/a>/);
    const otro = renderToStaticMarkup(
      <ApartadoDePlanilla titulo="Compras" verTodo={{ href: "/compras", texto: "Ver las compras →" }}>
        x
      </ApartadoDePlanilla>,
    );
    expect(otro).toContain("Ver las compras →");
  });

  it("el idDelTitulo explícito se respeta (dos apartados con el mismo título no chocan)", () => {
    const html = renderToStaticMarkup(<ApartadoDePlanilla titulo="Archivados (2)" idDelTitulo="titulo-archivados">x</ApartadoDePlanilla>);
    expect(html).toContain('aria-labelledby="titulo-archivados"');
    expect(html).toContain('<h2 id="titulo-archivados"');
  });
});

describe("BarraDeFiltros", () => {
  it("es una banda propia con fondo suave y contorno que aloja los filtros", () => {
    const html = renderToStaticMarkup(
      <BarraDeFiltros>
        <form role="search" />
      </BarraDeFiltros>,
    );
    expect(html).toContain("data-barra-de-filtros");
    expect(html).toContain("bg-superficie-suave");
    expect(html).toContain("border-borde");
    expect(html).toContain('<form role="search">');
  });
});

describe("piezas del estilo de planilla: solo tokens, sin modo oscuro, componentes de servidor", () => {
  for (const archivo of ["apartado-de-planilla.tsx", "barra-de-filtros.tsx"]) {
    it(archivo, () => {
      const fuente = readFileSync(join(__dirname, "../../src/ui/componentes/estructura", archivo), "utf8");
      expect(fuente).not.toMatch(/"use client"|useState|useEffect/);
      expect(fuente).not.toMatch(/dark:|\b(?:bg|text|border)-(?:neutral|gray|red|white|black)\b/);
    });
  }
});
