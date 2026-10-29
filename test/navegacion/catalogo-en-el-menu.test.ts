import { describe, expect, it } from "vitest";
import {
  GRUPOS_NAV,
  RUTAS_DE_UNA_ENTRADA,
  accionDeRuta,
  filtrarMenuPorPermiso,
  hrefActivoDelMenu,
  hrefsDelMenu,
  itemDeRuta,
  panelDeRuta,
  particionarMenu,
  rutasDeUnaEntradaVisibles,
} from "../../src/core/navegacion/estructura";
import { buscarPantallaEnMenu } from "../../src/core/navegacion/buscar-pantalla";
import { pantallaTrasCambiarSucursal } from "../../src/core/navegacion/pantalla-tras-cambio";
import { PESTANAS_DE_MAESTROS, PESTANAS_DE_PRODUCTOS } from "../../src/core/catalogo/ui-config";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Fase 7, DEC-13: el grupo Catálogo del menú real tiene CINCO entradas y el resto de sus pantallas cuelga de «Productos» o de «Maestros» (rutas de una entrada) con su clave de siempre y la misma URL.
 * Diseño: `docs/diseno-modulo-catalogo-2026-10-28.md` §8.
 */
const COMPLETO = hrefsDelMenu();
const TODOS = new Set(COMPLETO);
const puede = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);
const catalogo = () => GRUPOS_NAV.find((g) => g.id === "catalogo")!;
const hrefsVisibles = (claves: AccionClave[]) => filtrarMenuPorPermiso(GRUPOS_NAV, puede(...claves)).flatMap((g) => g.items.map((i) => i.href));
const CLAVES_DE_MAESTROS: AccionClave[] = ["grupos_familia", "categorias", "unidades", "margen_objetivo_editar"];

describe("el grupo Catálogo del menú real (DEC-13)", () => {
  it("son cinco ítems, en este orden: Productos, Biblioteca de opciones, Maestros, Proveedores y Clientes con descuento", () => {
    expect(catalogo().items.map((i) => [i.href, i.label])).toEqual([
      ["/catalogo/productos", "Productos"],
      ["/catalogo/opciones", "Biblioteca de opciones"],
      ["/catalogo/insumos-grupos", "Maestros"],
      ["/catalogo/proveedores", "Proveedores"],
      ["/catalogo/clientes", "Clientes con descuento"],
    ]);
  });

  it("Productos conserva la clave de la lista y es de los dos paneles; Maestros es `algunaDe` con las cuatro claves de sus pestañas; el resto, con su clave de siempre", () => {
    const [productos, biblioteca, maestros, proveedores, clientes] = catalogo().items;
    expect(productos).toMatchObject({ accion: "producto_ver_catalogo", panel: "ambos" });
    expect(biblioteca).toMatchObject({ accion: "opciones_definir", panel: "empresa" });
    expect(maestros.accion).toBeUndefined();
    expect(maestros.panel).toBe("empresa");
    expect([...(maestros.algunaDe ?? [])].sort()).toEqual([...CLAVES_DE_MAESTROS].sort());
    expect(proveedores).toMatchObject({ accion: "proveedores", panel: "empresa" });
    expect(clientes).toMatchObject({ accion: "clientes", panel: "empresa" });
  });

  it("Maestros se ve con UNA sola de sus claves y desaparece sin ninguna", () => {
    for (const clave of CLAVES_DE_MAESTROS) expect(hrefsVisibles([clave]), clave).toEqual(["/catalogo/insumos-grupos"]);
    expect(hrefsVisibles(["producto_ver_catalogo"])).toEqual(["/catalogo/productos"]);
    expect(hrefsVisibles(["insumo_alta", "categoria_alta"])).not.toContain("/catalogo/insumos-grupos");
  });

  it("Precio local y Recetas ya no son ítems: los encuentra quien ve Productos, en sus pestañas", () => {
    expect(COMPLETO).not.toContain("/movimientos/precio-local");
    expect(COMPLETO).not.toContain("/catalogo/recetas");
    expect(hrefsVisibles(["precio_local", "producto_ver_catalogo"])).toEqual(["/catalogo/productos"]);
  });

  it("quien solo ve un maestro encuentra Maestros en el panel Empresa", () => {
    const soloUnidades = particionarMenu(filtrarMenuPorPermiso(GRUPOS_NAV, puede("unidades")));
    expect(soloUnidades.empresa.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/catalogo/insumos-grupos"]);
    expect(soloUnidades.sucursal).toEqual([]);
  });

  it("las pantallas que dejaron de ser ítems siguen con su clave (las URL no cambiaron)", () => {
    for (const [href, clave] of [
      ["/movimientos/precio-local", "precio_local"],
      ["/catalogo/recetas", "guardar_receta"],
      ["/catalogo/recetas/p1", "guardar_receta"],
      ["/catalogo/recetas/p1/historial", "guardar_receta"],
      ["/catalogo/categorias", "categorias"],
      ["/catalogo/unidades", "unidades"],
      ["/catalogo/margen-objetivo", "margen_objetivo_editar"],
    ] as const) {
      expect(accionDeRuta(href), href).toBe(clave);
    }
    expect(itemDeRuta("/catalogo/recetas/p1")?.href).toBe("/catalogo/recetas");
    // La lista y el espacio del producto conservan su clave exacta (P-1 del diseño: los enlaces a un producto se muestran solo a quien puede abrirlo).
    expect(accionDeRuta("/catalogo/productos")).toBe("producto_ver_catalogo");
    expect(accionDeRuta("/catalogo/productos/p1/datos")).toBe("producto_ver_catalogo");
    expect(accionDeRuta("/catalogo/opciones/g1")).toBe("opciones_definir");
    // La entrada `algunaDe` no tiene UNA acción: `accionDeRuta` da null (la página se protege con su guarda).
    expect(accionDeRuta("/catalogo/insumos-grupos")).toBeNull();
  });
});

describe("las rutas que cuelgan de Productos y de Maestros", () => {
  it("cada pantalla resalta su entrada y conserva su panel", () => {
    expect(hrefActivoDelMenu("/movimientos/precio-local", COMPLETO, TODOS)).toBe("/catalogo/productos");
    expect(panelDeRuta("/movimientos/precio-local")).toBe("sucursal");
    for (const href of ["/catalogo/recetas", "/catalogo/recetas/p1", "/catalogo/recetas/p1/historial?x=1"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe("/catalogo/productos");
      expect(panelDeRuta(href), href).toBe("empresa");
    }
    for (const href of ["/catalogo/categorias", "/catalogo/unidades", "/catalogo/margen-objetivo"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe("/catalogo/insumos-grupos");
      expect(panelDeRuta(href), href).toBe("empresa");
    }
    expect(hrefActivoDelMenu("/catalogo/opciones/limpiar", COMPLETO, TODOS)).toBe("/catalogo/opciones");
    expect(panelDeRuta("/catalogo/productos")).toBeNull();
  });

  it("el precio local ya no resalta nada de Movimientos aunque su URL empiece con /movimientos", () => {
    expect(hrefActivoDelMenu("/movimientos/precio-local", COMPLETO, TODOS)).not.toBe("/movimientos");
  });

  it("si el rol no ve la entrada, la pantalla no resalta nada", () => {
    expect(hrefActivoDelMenu("/catalogo/unidades", COMPLETO, new Set(COMPLETO.filter((h) => h !== "/catalogo/insumos-grupos")))).toBeNull();
  });

  it("cambiar de sucursal vuelve a la misma pantalla si el rol la ve allá, y a ninguna si no", () => {
    expect(pantallaTrasCambiarSucursal("/movimientos/precio-local", puede("precio_local"))).toBe("/movimientos/precio-local");
    expect(pantallaTrasCambiarSucursal("/movimientos/precio-local", puede("producto_ver_catalogo"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/catalogo/insumos-grupos", puede("unidades"))).toBe("/catalogo/insumos-grupos");
    expect(pantallaTrasCambiarSucursal("/catalogo/unidades", puede("categorias"))).toBeNull();
  });

  it("el buscador del cajón de celular encuentra «precio local», «recetas» y «unidades» con su grupo, solo para quien los ve", () => {
    const visibles = puede("producto_ver_catalogo", "precio_local", "unidades");
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, visibles);
    const rutas = rutasDeUnaEntradaVisibles(visibles);
    expect(buscarPantallaEnMenu(menu, "precio local", rutas)).toEqual([{ href: "/movimientos/precio-local", label: "Precio local", grupoId: "catalogo", grupoLabel: "Catálogo" }]);
    expect(buscarPantallaEnMenu(menu, "unidades", rutas).map((p) => p.href)).toEqual(["/catalogo/unidades"]);
    expect(buscarPantallaEnMenu(menu, "recetas", rutas)).toEqual([]);
  });

  it("las rutas de Catálogo son las pestañas que no son la entrada", () => {
    const deCatalogo = RUTAS_DE_UNA_ENTRADA.filter((r) => r.entrada.startsWith("/catalogo/")).map((r) => [r.href, r.entrada]);
    expect(deCatalogo).toEqual([
      ...PESTANAS_DE_PRODUCTOS.slice(1).map((p) => [p.href, "/catalogo/productos"]),
      ...PESTANAS_DE_MAESTROS.slice(1).map((p) => [p.href, "/catalogo/insumos-grupos"]),
    ]);
    expect(deCatalogo.map(([h]) => h)).toEqual(["/movimientos/precio-local", "/catalogo/recetas", "/catalogo/categorias", "/catalogo/unidades", "/catalogo/margen-objetivo"]);
  });
});
