import { describe, expect, it } from "vitest";
import { GRUPOS_NAV, RUTAS_DE_UNA_ENTRADA, filtrarMenuPorPermiso, type GrupoNav } from "../../src/core/navegacion/estructura";
import { buscarPantallaEnMenu, normalizarParaBuscar } from "../../src/core/navegacion/buscar-pantalla";

/**
 * El buscador del menú de celular (MOVIL, O.465): sin distinguir mayúsculas ni acentos, todas las palabras de la consulta, en el orden del menú. Sobre un menú de prueba con acentos y
 * sobre el menú real (para que el caso «recet» → «Recetas» de la pantalla no dependa de un dato de ejemplo).
 */
const MENU: GrupoNav[] = [
  {
    id: "catalogo",
    label: "Catálogo",
    items: [
      { href: "/catalogo/recetas", label: "Recetas", accion: "guardar_receta", panel: "ambos" },
      { href: "/catalogo/opciones", label: "Opciones de venta", accion: "opciones_definir", panel: "ambos" },
      { href: "/catalogo/categorias", label: "Categorías", accion: "categorias", panel: "ambos" },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    items: [
      { href: "/reportes/costos", label: "Costos y márgenes", accion: "reporte_costos", panel: "ambos" },
      { href: "/reportes/rotacion", label: "Rotación de mesas", accion: "reporte_rotacion_mesas", panel: "ambos" },
    ],
  },
];
const hrefs = (consulta: string) => buscarPantallaEnMenu(MENU, consulta).map((p) => p.href);

describe("normalizarParaBuscar", () => {
  it("pasa a minúsculas y saca los acentos", () => {
    expect(normalizarParaBuscar("RÉCETAS")).toBe("recetas");
    expect(normalizarParaBuscar("Rotación de mesas")).toBe("rotacion de mesas");
    expect(normalizarParaBuscar("Año")).toBe("ano");
  });
});

describe("buscarPantallaEnMenu", () => {
  it("encuentra por un pedazo del nombre, sin distinguir mayúsculas", () => {
    expect(hrefs("recet")).toEqual(["/catalogo/recetas"]);
    expect(hrefs("RECETAS")).toEqual(["/catalogo/recetas"]);
  });

  it("no distingue acentos: con o sin ellos, en la consulta o en el nombre", () => {
    expect(hrefs("categorias")).toEqual(["/catalogo/categorias"]);
    expect(hrefs("Categorías")).toEqual(["/catalogo/categorias"]);
    expect(hrefs("rotacion")).toEqual(["/reportes/rotacion"]);
    expect(hrefs("ROTACIÓN")).toEqual(["/reportes/rotacion"]);
  });

  it("devuelve el grupo de cada pantalla (para mostrarlo al costado)", () => {
    expect(buscarPantallaEnMenu(MENU, "costos")).toEqual([{ href: "/reportes/costos", label: "Costos y márgenes", grupoId: "reportes", grupoLabel: "Reportes" }]);
  });

  it("exige TODAS las palabras, en cualquier orden, y también mira el nombre del grupo", () => {
    expect(hrefs("opciones venta")).toEqual(["/catalogo/opciones"]);
    expect(hrefs("venta opciones")).toEqual(["/catalogo/opciones"]);
    expect(hrefs("reportes costos")).toEqual(["/reportes/costos"]);
    expect(hrefs("recetas reportes")).toEqual([]);
    expect(hrefs("reportes")).toEqual(["/reportes/costos", "/reportes/rotacion"]);
  });

  it("una consulta vacía o de espacios no devuelve nada, y sin coincidencias, tampoco", () => {
    expect(hrefs("")).toEqual([]);
    expect(hrefs("   ")).toEqual([]);
    expect(hrefs("zzzz")).toEqual([]);
  });

  it("solo busca en lo que recibe: un menú ya filtrado por permiso no deja encontrar lo que no se ofrece", () => {
    const sinRecetas: GrupoNav[] = MENU.map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/catalogo/recetas") }));
    expect(buscarPantallaEnMenu(sinRecetas, "recet")).toEqual([]);
    expect(buscarPantallaEnMenu(filtrarMenuPorPermiso(GRUPOS_NAV, new Set()), "recet").every((p) => !p.href.startsWith("/catalogo/recetas"))).toBe(true);
  });

  it("sobre el menú real, «recet» encuentra «Recetas» de Catálogo (desde DEC-13, una pestaña de «Productos»)", () => {
    const hallazgos = buscarPantallaEnMenu(GRUPOS_NAV, "recet", RUTAS_DE_UNA_ENTRADA);
    expect(hallazgos).toContainEqual(expect.objectContaining({ href: "/catalogo/recetas", label: "Recetas", grupoLabel: "Catálogo" }));
  });
});
