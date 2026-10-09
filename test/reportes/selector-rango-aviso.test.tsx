import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectorRango } from "../../src/components/selector-rango";
import { MAXIMO_DE_DIAS_DE_UN_RANGO, resolverRangoDeReporte } from "../../src/core/reportes/public";

/**
 * M-21 (T16): el recorte de un rango a 366 días no avisaba: solo cambiaba la fecha que muestra el selector, y el reporte parecía ser lo que se pidió. Rotación de mesas, en cambio, sí avisa
 * cuando trunca (`data-aviso-truncado`). Ahora el selector (que todas las pantallas de reportes con rango dibujan) muestra el mismo estilo de aviso cuando el rango se recortó.
 */
const ahora = new Date("2026-09-22T12:00:00Z");
const dibujar = (sp: { desde?: string; hasta?: string }) => {
  const rango = resolverRangoDeReporte(sp, ahora);
  return renderToStaticMarkup(<SelectorRango opcion={rango.opcion} desdeISO={rango.desdeISO} hastaISO={rango.hastaISO} recortadoDesde={rango.recortadoDesde} />);
};

describe("SelectorRango: aviso cuando el rango se recortó (M-21)", () => {
  it("EL DEFECTO: un rango de 26 años se recorta y la pantalla lo DICE, con el «desde» pedido, el tope y el rango que sí se muestra", () => {
    const html = dibujar({ desde: "2000-01-01" });
    expect(html).toContain("data-aviso-rango-recortado");
    expect(html).toContain('role="status"');
    expect(html).toContain("2000-01-01");
    expect(html).toContain(String(MAXIMO_DE_DIAS_DE_UN_RANGO));
    expect(html).toContain("2025-09-22");
    expect(html).toContain("2026-09-22");
  });

  it("un rango que entra entero (o los 30 días de siempre) no muestra ningún aviso", () => {
    expect(dibujar({ desde: "2025-09-22", hasta: "2026-09-22" })).not.toContain("data-aviso-rango-recortado");
    expect(dibujar({})).not.toContain("data-aviso-rango-recortado");
  });

  it("el formulario del selector sigue siendo el mismo con y sin aviso", () => {
    const con = dibujar({ desde: "2000-01-01" });
    expect(con).toContain('<select id="rango" name="rango"');
    expect(con).toContain('name="desde"');
  });
});

describe("las pantallas de reportes con rango le pasan el recorte al selector", () => {
  const raiz = join(__dirname, "../../src/app/(app)/reportes");
  const paginas = readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "page.tsx")
    .map((e) => join(e.parentPath, e.name))
    .filter((ruta) => readFileSync(ruta, "utf8").includes("resolverRangoDeReporte"));

  it("sanidad: son las nueve pantallas que resuelven un rango", () => {
    expect(paginas).toHaveLength(9);
  });

  it.each(paginas.map((p) => [p.slice(raiz.length)]))("%s pasa recortadoDesde={rango.recortadoDesde} a SelectorRango", (ruta) => {
    const fuente = readFileSync(join(raiz, ruta), "utf8");
    expect(fuente).toMatch(/<SelectorRango[^>]*recortadoDesde=\{rango\.recortadoDesde\}/);
  });
});
