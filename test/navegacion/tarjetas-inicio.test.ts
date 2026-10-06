import { describe, expect, it } from "vitest";
import { GRUPOS_NAV, filtrarMenuPorPermiso } from "../../src/core/navegacion/estructura";
import { DESCRIPCION_DE_MODULO, tarjetasDeInicio } from "../../src/core/navegacion/tarjetas-inicio";
import { ACCIONES, type AccionClave } from "../../src/core/permisos/acciones";

describe("tarjetas de /inicio", () => {
  it("todo módulo del menú tiene su descripción, y no sobra ninguna", () => {
    for (const g of GRUPOS_NAV) expect(DESCRIPCION_DE_MODULO[g.id], `falta la descripción del módulo ${g.id}`).toBeTruthy();
    expect(Object.keys(DESCRIPCION_DE_MODULO).sort()).toEqual(GRUPOS_NAV.map((g) => g.id).sort());
  });

  it("el href de cada tarjeta es el primer ítem VISIBLE del módulo, no el primero del menú completo", () => {
    const tarjetas = tarjetasDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["reporte_trazabilidad", "reporte_vencimientos"])));
    expect(tarjetas).toEqual([{ id: "reportes", label: "Reportes", href: "/reportes/vencimientos", descripcion: DESCRIPCION_DE_MODULO.reportes }]);
  });

  it("con la matriz de fábrica: el admin tiene 8 tarjetas (con Salón) y el operador las suyas, sin Salón", () => {
    const de = (rol: "admin" | "operador") =>
      tarjetasDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set(ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes(rol)).map((a) => a.clave)))).map((t) => t.id);
    expect(de("admin")).toEqual(["administracion", "catalogo", "carta", "movimientos", "stock", "reportes", "traspasos", "pos"]);
    expect(de("operador")).not.toContain("pos");
    expect(de("operador").length).toBeGreaterThan(0);
  });

  it("sin permisos no hay tarjetas, y un módulo sin ítems visibles no tiene tarjeta", () => {
    expect(tarjetasDeInicio([])).toEqual([]);
    expect(tarjetasDeInicio([{ id: "pos", label: "Salón", items: [] }])).toEqual([]);
  });
});
