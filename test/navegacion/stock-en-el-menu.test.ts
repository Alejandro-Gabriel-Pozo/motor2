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
import { EDITORES_DE_PARAMETROS, PESTANAS_DE_CONFIGURACION, PESTANAS_DE_EXISTENCIAS, pestanaActualDeStock } from "../../src/core/stock/ui-config";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Fase 7, DEC-27: el grupo Stock del menú real tiene DOS entradas, «Existencias» y «Configuración», y el resto de sus pantallas cuelga de ellas (rutas de una entrada) con su clave de siempre y la misma URL.
 * Diseño: `docs/diseno-modulo-stock-2026-10-27.md` §8.
 */
const COMPLETO = hrefsDelMenu();
const TODOS = new Set(COMPLETO);
const puede = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);
const stock = () => GRUPOS_NAV.find((g) => g.id === "stock")!;
const hrefsVisibles = (claves: AccionClave[]) => filtrarMenuPorPermiso(GRUPOS_NAV, puede(...claves)).flatMap((g) => g.items.map((i) => i.href));
const CLAVES_DE_CONFIGURACION: AccionClave[] = ["stock_minimo", "stock_seccion_habitual", "conteo_frecuencia", "secciones", "motivos_merma", "motivos_destino_consumo"];

describe("el grupo Stock del menú real (DEC-27)", () => {
  it("son dos ítems, en este orden: Existencias y Configuración", () => {
    expect(stock().items.map((i) => [i.href, i.label])).toEqual([
      ["/stock/consolidado", "Existencias"],
      ["/stock/configuracion", "Configuración"],
    ]);
  });

  it("Existencias se ve con ver_stock; Configuración es `algunaDe` con las claves de todas sus pestañas y es de los dos paneles", () => {
    const [existencias, configuracion] = stock().items;
    expect(existencias).toMatchObject({ accion: "ver_stock", panel: "sucursal" });
    expect(configuracion.accion).toBeUndefined();
    expect(configuracion.panel).toBe("ambos");
    expect([...(configuracion.algunaDe ?? [])].sort()).toEqual([...CLAVES_DE_CONFIGURACION].sort());
  });

  it("Configuración se ve con UNA sola de sus claves (también una de empresa) y desaparece sin ninguna", () => {
    for (const clave of CLAVES_DE_CONFIGURACION) expect(hrefsVisibles([clave]), clave).toEqual(["/stock/configuracion"]);
    expect(hrefsVisibles(["ver_stock"])).toEqual(["/stock/consolidado"]);
    expect(hrefsVisibles(["stock_reclasificar"])).not.toContain("/stock/configuracion");
  });

  it("quien solo ve motivos de merma (empresa) encuentra Configuración en el panel Empresa; quien solo ve depósitos, también en el de Sucursal", () => {
    const soloMotivos = particionarMenu(filtrarMenuPorPermiso(GRUPOS_NAV, puede("motivos_merma")));
    expect(soloMotivos.empresa.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/stock/configuracion"]);
    const conDepositos = particionarMenu(filtrarMenuPorPermiso(GRUPOS_NAV, puede("secciones", "ver_stock")));
    expect(conDepositos.sucursal.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/stock/consolidado", "/stock/configuracion"]);
  });

  it("las pantallas viejas siguen con su clave aunque ya no sean ítems (las URL no cambiaron)", () => {
    for (const [href, clave] of [
      ["/stock/por-familia", "ver_stock"],
      ["/stock/alertas", "ver_stock"],
      ["/stock/minimo", "stock_minimo"],
      ["/stock/seccion-habitual", "stock_seccion_habitual"],
      ["/stock/conteo-frecuencia", "conteo_frecuencia"],
      ["/movimientos/secciones", "secciones"],
      ["/movimientos/motivos-merma", "motivos_merma"],
      ["/movimientos/destinos-consumo", "motivos_destino_consumo"],
    ] as const) {
      expect(accionDeRuta(href), href).toBe(clave);
      expect(itemDeRuta(href)?.href, href).toBe(href);
    }
    // La entrada `algunaDe` no tiene UNA acción: `accionDeRuta` da null (la página se protege con su guarda).
    expect(accionDeRuta("/stock/configuracion")).toBeNull();
  });
});

describe("las rutas que cuelgan de Existencias y de Configuración", () => {
  it("cada pantalla resalta su entrada y conserva su panel (motivos y destinos, Empresa)", () => {
    for (const href of ["/stock/por-familia", "/stock/alertas"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe("/stock/consolidado");
      expect(panelDeRuta(href), href).toBe("sucursal");
    }
    for (const href of ["/stock/minimo", "/stock/seccion-habitual", "/stock/conteo-frecuencia", "/movimientos/secciones"]) {
      expect(hrefActivoDelMenu(`${href}?editar=x`, COMPLETO, TODOS), href).toBe("/stock/configuracion");
      expect(panelDeRuta(href), href).toBe("sucursal");
    }
    for (const href of ["/movimientos/motivos-merma", "/movimientos/destinos-consumo"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe("/stock/configuracion");
      expect(panelDeRuta(href), href).toBe("empresa");
    }
    // La entrada «Configuración» es de los dos paneles: no fija panel.
    expect(panelDeRuta("/stock/configuracion")).toBeNull();
    expect(hrefActivoDelMenu("/stock/consolidado", COMPLETO, TODOS)).toBe("/stock/consolidado");
  });

  it("los depósitos ya no resaltan «Registrar movimiento» aunque su URL empiece con /movimientos", () => {
    expect(hrefActivoDelMenu("/movimientos/secciones", COMPLETO, TODOS)).not.toBe("/movimientos");
  });

  it("si el rol no ve la entrada, la pantalla no resalta nada", () => {
    expect(hrefActivoDelMenu("/stock/alertas", COMPLETO, new Set(COMPLETO.filter((h) => h !== "/stock/consolidado")))).toBeNull();
  });

  it("cambiar de sucursal vuelve a la misma pantalla si el rol la ve allá, y a ninguna si no", () => {
    expect(pantallaTrasCambiarSucursal("/stock/alertas?x=1", puede("ver_stock"))).toBe("/stock/alertas");
    expect(pantallaTrasCambiarSucursal("/stock/minimo?editar=abc", puede("stock_minimo"))).toBe("/stock/minimo");
    expect(pantallaTrasCambiarSucursal("/stock/minimo", puede("conteo_frecuencia"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/stock/configuracion", puede("motivos_merma"))).toBe("/stock/configuracion");
    expect(pantallaTrasCambiarSucursal("/stock/configuracion", puede("ver_stock"))).toBeNull();
  });

  it("el buscador del cajón de celular encuentra «alertas» y «depósitos» con su grupo, solo para quien los ve", () => {
    const visibles = puede("ver_stock", "secciones");
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, visibles);
    const rutas = rutasDeUnaEntradaVisibles(visibles);
    expect(buscarPantallaEnMenu(menu, "alertas", rutas)).toEqual([{ href: "/stock/alertas", label: "Alertas", grupoId: "stock", grupoLabel: "Stock" }]);
    expect(buscarPantallaEnMenu(menu, "depósitos", rutas).map((p) => p.href)).toEqual(["/movimientos/secciones"]);
    const sin = puede("ver_stock");
    expect(buscarPantallaEnMenu(filtrarMenuPorPermiso(GRUPOS_NAV, sin), "depósitos", rutasDeUnaEntradaVisibles(sin))).toEqual([]);
  });

  it("las rutas de Stock son las pestañas que no son la entrada y los tres editores", () => {
    const deStock = RUTAS_DE_UNA_ENTRADA.filter((r) => r.entrada.startsWith("/stock/")).map((r) => r.href);
    expect(deStock).toEqual([
      "/stock/por-familia",
      "/stock/alertas",
      "/movimientos/secciones",
      "/movimientos/motivos-merma",
      "/movimientos/destinos-consumo",
      ...EDITORES_DE_PARAMETROS.map((e) => e.href),
    ]);
  });
});

describe("pestanaActualDeStock: qué pestaña se marca", () => {
  it("la de la ruta abierta; en un editor de parámetros, «Parámetros por insumo»; fuera de la fila, ninguna", () => {
    expect(pestanaActualDeStock(PESTANAS_DE_EXISTENCIAS, "/stock/alertas")).toBe("/stock/alertas");
    expect(pestanaActualDeStock(PESTANAS_DE_CONFIGURACION, "/movimientos/motivos-merma")).toBe("/movimientos/motivos-merma");
    for (const e of EDITORES_DE_PARAMETROS) expect(pestanaActualDeStock(PESTANAS_DE_CONFIGURACION, e.href), e.href).toBe("/stock/configuracion");
    expect(pestanaActualDeStock(PESTANAS_DE_EXISTENCIAS, "/stock/minimo")).toBeNull();
    // Si el rol no ve «Parámetros por insumo» (la fila no la trae), un editor no marca ninguna.
    expect(pestanaActualDeStock(PESTANAS_DE_CONFIGURACION.slice(1), "/stock/minimo")).toBeNull();
  });
});
