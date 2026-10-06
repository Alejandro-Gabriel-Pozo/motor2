import { describe, expect, it } from "vitest";
import { GRUPOS_NAV, hrefActivoDelMenu, hrefsDelMenu } from "../../src/core/navegacion/estructura";

const COMPLETO = hrefsDelMenu();
const TODOS = new Set(COMPLETO);
const activo = (pathname: string, visibles: ReadonlySet<string> = TODOS) => hrefActivoDelMenu(pathname, COMPLETO, visibles);

describe("hrefActivoDelMenu: un solo ítem resaltado, el de la ruta más larga", () => {
  it.each([
    ["/carta", "/carta"],
    ["/carta/agrupados", "/carta/agrupados"],
    ["/carta/portal", "/carta/portal"],
    ["/carta/tema", "/carta/tema"],
    ["/traspasos", "/traspasos"],
    ["/traspasos/solicitar", "/traspasos/solicitar"],
    ["/traspasos/enviar", "/traspasos/enviar"],
    ["/reportes", "/reportes"],
    ["/reportes/rendimiento-recetas", "/reportes/rendimiento-recetas"],
    ["/reportes/rendimiento-recetas/por-sucursal", "/reportes/rendimiento-recetas/por-sucursal"],
  ])("%s resalta solo %s", (pathname, esperado) => {
    expect(activo(pathname)).toBe(esperado);
  });

  it("una pantalla hija resalta el ítem del que cuelga", () => {
    expect(activo("/catalogo/recetas/abc123/historial")).toBe("/catalogo/recetas");
    expect(activo("/catalogo/proveedores/comparativa")).toBe("/catalogo/proveedores");
    expect(activo("/catalogo/productos/nuevo")).toBe("/catalogo/productos");
  });

  it("ignora la barra final, la consulta y el ancla", () => {
    expect(activo("/reportes/costos/")).toBe("/reportes/costos");
    expect(activo("/reportes/costos?desde=2026-01-01")).toBe("/reportes/costos");
    expect(activo("/stock/minimo#fila-3")).toBe("/stock/minimo");
  });

  it("exige la barra: un prefijo de texto que no es una ruta hija no cuenta", () => {
    expect(activo("/stock/consolidado-x")).toBeNull();
    expect(activo("/carta-publica")).toBeNull();
  });

  it("una pantalla que no es del menú no resalta nada", () => {
    expect(activo("/inicio")).toBeNull();
    expect(activo("/")).toBeNull();
    expect(activo("/otra-cosa/seguro")).toBeNull();
  });

  it("si la ruta más larga es de un ítem que el usuario no ve, no resalta ninguno (ni uno más corto)", () => {
    const sinConsolidado = new Set(COMPLETO.filter((h) => h !== "/reportes/consolidado"));
    expect(activo("/reportes/consolidado", sinConsolidado)).toBeNull();
    const sinPorSucursal = new Set(COMPLETO.filter((h) => h !== "/reportes/rendimiento-recetas/por-sucursal"));
    expect(activo("/reportes/rendimiento-recetas/por-sucursal", sinPorSucursal)).toBeNull();
  });

  it("cada ítem del menú se resuelve a sí mismo", () => {
    for (const href of COMPLETO) expect(activo(href), href).toBe(href);
  });
});

describe("el menú completo", () => {
  it("no repite ningún href (con uno repetido quedarían dos ítems resaltados)", () => {
    const repetidos = COMPLETO.filter((h, i) => COMPLETO.indexOf(h) !== i);
    expect(repetidos).toEqual([]);
  });

  it("hrefsDelMenu recorre todos los grupos", () => {
    expect(COMPLETO).toHaveLength(GRUPOS_NAV.reduce((n, g) => n + g.items.length, 0));
  });
});
