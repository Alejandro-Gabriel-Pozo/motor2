import { describe, expect, it } from "vitest";
import {
  GRUPOS_NAV,
  RUTAS_DE_UNA_ENTRADA,
  accionDeRuta,
  accionesDeNavegacion,
  accionesDelMenu,
  filtrarMenuPorPermiso,
  hrefActivoDelMenu,
  hrefsDelMenu,
  itemDeRuta,
  panelDeRuta,
  rutasDeUnaEntradaVisibles,
} from "../../src/core/navegacion/estructura";
import { buscarPantallaEnMenu } from "../../src/core/navegacion/buscar-pantalla";
import { pantallaTrasCambiarSucursal } from "../../src/core/navegacion/pantalla-tras-cambio";
import { PROCESOS_DEL_SELECTOR } from "../../src/core/movimientos/ui-config";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Fase 7, P5a: el menú REAL de Movimientos (Merma, Compra, «Registrar movimiento», «Carga de ventas sin ticket», Conteo físico) y la lista REAL de rutas que cuelgan de la entrada. El mecanismo (con datos
 * sintéticos) está en `entrada-con-varias-claves.test.ts`; acá se fija que lo real lo usa como corresponde.
 */
const COMPLETO = hrefsDelMenu();
const TODOS = new Set(COMPLETO);
const CLAVES_DEL_SELECTOR = PROCESOS_DEL_SELECTOR.map((p) => p.accion);
const puede = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);
const grupo = (id: string) => GRUPOS_NAV.find((g) => g.id === id)!;

describe("el grupo Movimientos del menú real", () => {
  it("son cinco ítems, en este orden: los directos, la entrada del selector, la carga sin ticket y el conteo", () => {
    expect(grupo("movimientos").items.map((i) => [i.href, i.label])).toEqual([
      ["/movimientos/merma", "Merma"],
      ["/movimientos/compra", "Compra"],
      ["/movimientos", "Registrar movimiento"],
      ["/movimientos/venta", "Carga de ventas sin ticket"],
      ["/movimientos/conteo-fisico", "Conteo físico"],
    ]);
  });

  it("«Registrar movimiento» es un ítem algunaDe con las claves del selector; «Carga de ventas sin ticket» conserva la clave de la venta", () => {
    const entrada = grupo("movimientos").items.find((i) => i.href === "/movimientos")!;
    expect(entrada.accion).toBeUndefined();
    expect([...(entrada.algunaDe ?? [])].sort()).toEqual([...CLAVES_DEL_SELECTOR].sort());
    expect(grupo("movimientos").items.find((i) => i.href === "/movimientos/venta")).toMatchObject({ accion: "proceso_venta" });
  });

  it("la entrada se ve con UNA sola de las claves (también solo con stock_reclasificar) y desaparece sin ninguna", () => {
    const hrefs = (claves: AccionClave[]) => filtrarMenuPorPermiso(GRUPOS_NAV, puede(...claves)).flatMap((g) => g.items.map((i) => i.href));
    for (const clave of CLAVES_DEL_SELECTOR) expect(hrefs([clave]), clave).toContain("/movimientos");
    expect(hrefs(["stock_reclasificar"])).toEqual(["/movimientos"]);
    expect(hrefs(["proceso_merma"])).toEqual(["/movimientos/merma"]);
    expect(hrefs(["proceso_venta", "ver_stock"])).not.toContain("/movimientos");
  });

  it("las entradas mudadas están en su módulo, con su clave de siempre, y ya no en Movimientos", () => {
    const de = (id: string, href: string) => grupo(id).items.find((i) => i.href === href);
    // DEC-13: Precio local es una pestaña de «Productos» de Catálogo (ruta de esa entrada), con su clave de siempre.
    expect(RUTAS_DE_UNA_ENTRADA.find((r) => r.href === "/movimientos/precio-local")).toMatchObject({ label: "Precio local", accion: "precio_local", panel: "sucursal", entrada: "/catalogo/productos" });
    expect(de("carta", "/movimientos/opciones-agotadas")).toMatchObject({ label: "Opciones agotadas", accion: "opcion_apagar_en_sucursal", panel: "sucursal" });
    // DEC-27: Depósitos, Motivos y Destinos son pestañas de «Configuración» de Stock (rutas de esa entrada), con su clave de siempre.
    const deStock = (href: string) => RUTAS_DE_UNA_ENTRADA.find((r) => r.href === href);
    expect(deStock("/movimientos/secciones")).toMatchObject({ label: "Depósitos", accion: "secciones", panel: "sucursal", entrada: "/stock/configuracion" });
    expect(deStock("/movimientos/motivos-merma")).toMatchObject({ label: "Motivos de merma", accion: "motivos_merma", panel: "empresa", entrada: "/stock/configuracion" });
    expect(deStock("/movimientos/destinos-consumo")).toMatchObject({ label: "Destinos de consumo", accion: "motivos_destino_consumo", panel: "empresa", entrada: "/stock/configuracion" });
    expect(grupo("stock").items.map((i) => i.href)).not.toContain("/stock/reclasificar");
    for (const href of ["/movimientos/precio-local", "/movimientos/opciones-agotadas", "/movimientos/secciones", "/movimientos/motivos-merma", "/movimientos/destinos-consumo"]) {
      expect(grupo("movimientos").items.map((i) => i.href), href).not.toContain(href);
    }
  });

  it("no hay hrefs repetidos en el menú, y Reclasificar sigue protegida con su clave aunque ya no sea un ítem", () => {
    expect(new Set(COMPLETO).size).toBe(COMPLETO.length);
    expect(accionDeRuta("/stock/reclasificar")).toBe("stock_reclasificar");
    expect(accionesDeNavegacion()).toContain("stock_reclasificar");
    expect(accionesDelMenu()).toContain("proceso_ajuste");
  });
});

describe("las rutas que cuelgan de «Registrar movimiento» (lista real)", () => {
  it("son los 7 procesos del selector y Reclasificar, todas de la entrada «/movimientos» y del panel Sucursal", () => {
    const deMovimientos = RUTAS_DE_UNA_ENTRADA.filter((r) => r.entrada === "/movimientos");
    expect(deMovimientos.map((r) => [r.href, r.label, r.accion])).toEqual(PROCESOS_DEL_SELECTOR.map((p) => [p.href, p.etiquetaCorta, p.accion]));
    expect(deMovimientos).toHaveLength(8);
    for (const r of deMovimientos) expect(r.panel, r.href).toBe("sucursal");
  });

  it.each(PROCESOS_DEL_SELECTOR.map((p) => p.href))("%s resalta «Registrar movimiento», es del panel Sucursal y se resuelve por su propia acción", (href) => {
    const proceso = PROCESOS_DEL_SELECTOR.find((p) => p.href === href)!;
    expect(hrefActivoDelMenu(href, COMPLETO, TODOS)).toBe("/movimientos");
    expect(hrefActivoDelMenu(`${href}?productoId=abc`, COMPLETO, TODOS)).toBe("/movimientos");
    expect(panelDeRuta(href)).toBe("sucursal");
    expect(accionDeRuta(href)).toBe(proceso.accion);
    expect(itemDeRuta(href)?.href).toBe(href);
  });

  it("los directos y las pantallas que se quedaron en el menú se resaltan a sí mismas", () => {
    for (const href of ["/movimientos/merma", "/movimientos/compra", "/movimientos/venta", "/movimientos/conteo-fisico", "/stock/consolidado"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe(href);
    }
    expect(hrefActivoDelMenu("/movimientos", COMPLETO, TODOS)).toBe("/movimientos");
  });

  it("si el rol no ve la entrada, ninguna de sus rutas resalta algo", () => {
    const sinEntrada = new Set(COMPLETO.filter((h) => h !== "/movimientos"));
    expect(hrefActivoDelMenu("/movimientos/ajuste", COMPLETO, sinEntrada)).toBeNull();
  });

  it("cambiar de sucursal vuelve a la misma ruta si el rol ve su acción allá, y a ninguna si no", () => {
    expect(pantallaTrasCambiarSucursal("/movimientos/ajuste?x=1", puede("proceso_ajuste"))).toBe("/movimientos/ajuste");
    expect(pantallaTrasCambiarSucursal("/stock/reclasificar", puede("stock_reclasificar"))).toBe("/stock/reclasificar");
    expect(pantallaTrasCambiarSucursal("/stock/reclasificar", puede("proceso_ajuste"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/movimientos", puede("stock_reclasificar"))).toBe("/movimientos");
  });
});

describe("el buscador del cajón de celular encuentra las rutas que el servidor le ofrece", () => {
  it("rutasDeUnaEntradaVisibles deja solo las que el rol puede ver", () => {
    expect(rutasDeUnaEntradaVisibles(puede("proceso_ajuste", "proceso_merma")).map((r) => r.href)).toEqual(["/movimientos/ajuste"]);
    expect(rutasDeUnaEntradaVisibles(puede())).toEqual([]);
  });

  it("«ajuste» sigue apareciendo (con Movimientos como grupo) para quien ve el proceso, y no aparece para quien no", () => {
    const visibles = puede("proceso_ajuste", "proceso_merma");
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, visibles);
    expect(buscarPantallaEnMenu(menu, "ajuste", rutasDeUnaEntradaVisibles(visibles))).toEqual([{ href: "/movimientos/ajuste", label: "Ajuste", grupoId: "movimientos", grupoLabel: "Movimientos" }]);
    const sin = puede("proceso_merma");
    expect(buscarPantallaEnMenu(filtrarMenuPorPermiso(GRUPOS_NAV, sin), "ajuste", rutasDeUnaEntradaVisibles(sin))).toEqual([]);
  });

  it("«reclasificar» lo encuentra quien solo tiene stock_reclasificar", () => {
    const visibles = puede("stock_reclasificar");
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, visibles);
    expect(buscarPantallaEnMenu(menu, "reclasificar", rutasDeUnaEntradaVisibles(visibles)).map((p) => p.href)).toEqual(["/stock/reclasificar"]);
  });
});
