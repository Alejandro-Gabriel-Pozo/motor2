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
import { PESTANAS_DE_APARIENCIA, PESTANAS_DE_CARTA, PESTANAS_DE_PROMOCIONES, armarPestanasDeCarta, primeraPantallaVisible } from "../../src/core/carta/ui-config";
import { MENU_DEL_DIA_VISIBLE } from "../../src/core/carta/menu-del-dia";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Fase 7, DEC-24: el grupo Carta del menú real tiene TRES entradas, «Carta» (Hoy · Secciones y géneros · Ítems agrupados), «Promociones» y «Apariencia y publicación», y el resto de sus pantallas cuelga de
 * ellas (rutas de una entrada) con su clave de siempre y la misma URL. Diseño: `docs/diseno-modulo-carta-2026-10-28.md` §8.
 */
const COMPLETO = hrefsDelMenu();
const TODOS = new Set(COMPLETO);
const puede = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);
const carta = () => GRUPOS_NAV.find((g) => g.id === "carta")!;
const hrefsVisibles = (claves: AccionClave[]) => filtrarMenuPorPermiso(GRUPOS_NAV, puede(...claves)).flatMap((g) => g.items.map((i) => i.href));

describe("el grupo Carta del menú real (DEC-24)", () => {
  it("son tres ítems, en este orden: Carta, Promociones y Apariencia y publicación", () => {
    expect(carta().items.map((i) => [i.href, i.label])).toEqual([
      ["/carta", "Carta"],
      ["/carta/parametrizacion/promociones", "Promociones"],
      ["/carta/parametrizacion/apariencia", "Apariencia y publicación"],
    ]);
  });

  it("Carta es `algunaDe` de sus pestañas (sucursal); Promociones pide carta_ver (los dos paneles); Apariencia es `algunaDe` de tema y portal (los dos paneles)", () => {
    const [entradaCarta, promociones, apariencia] = carta().items;
    expect(entradaCarta.accion).toBeUndefined();
    expect([...(entradaCarta.algunaDe ?? [])].sort()).toEqual(["carta_items_agrupados", "carta_ver", "opcion_apagar_en_sucursal"]);
    expect(entradaCarta.panel).toBe("sucursal");
    expect(promociones).toMatchObject({ accion: "carta_ver", panel: "ambos" });
    expect([...(apariencia.algunaDe ?? [])].sort()).toEqual(["carta_portal", "carta_tema"]);
    expect(apariencia.panel).toBe("ambos");
  });

  it("el operario que solo agota opciones sigue encontrando la carta; quien solo ve el portal (empresa) encuentra Apariencia en el panel Empresa", () => {
    expect(hrefsVisibles(["opcion_apagar_en_sucursal"])).toEqual(["/carta"]);
    expect(hrefsVisibles(["carta_items_agrupados"])).toEqual(["/carta"]);
    expect(hrefsVisibles(["carta_ver"])).toEqual(["/carta", "/carta/parametrizacion/promociones"]);
    expect(hrefsVisibles(["carta_tema"])).toEqual(["/carta/parametrizacion/apariencia"]);
    const soloPortal = particionarMenu(filtrarMenuPorPermiso(GRUPOS_NAV, puede("carta_portal")));
    expect(soloPortal.empresa.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/carta/parametrizacion/apariencia"]);
    expect(hrefsVisibles(["producto_disponibilidad"])).not.toContain("/carta");
  });

  it("las pantallas viejas siguen con su clave aunque ya no sean ítems (las URL no cambiaron)", () => {
    for (const [href, clave] of [
      ["/movimientos/opciones-agotadas", "opcion_apagar_en_sucursal"],
      ["/carta/agrupados", "carta_items_agrupados"],
      ["/carta/parametrizacion/secciones", "carta_ver"],
      ["/carta/parametrizacion/generos", "carta_ver"],
      ["/carta/parametrizacion", "carta_ver"],
      ["/carta/tema", "carta_tema"],
      ["/carta/portal", "carta_portal"],
    ] as const) {
      expect(accionDeRuta(href), href).toBe(clave);
      expect(itemDeRuta(href)?.href, href).toBe(href);
    }
    // Las entradas `algunaDe` no tienen UNA acción: `accionDeRuta` da null (la página se protege con su guarda).
    expect(accionDeRuta("/carta")).toBeNull();
    expect(accionDeRuta("/carta/parametrizacion/apariencia")).toBeNull();
    expect(accionDeRuta("/carta/parametrizacion/promociones")).toBe("carta_ver");
  });

  it("el Menú del día solo cuelga de Promociones con su interruptor prendido (apagado, su página es 404)", () => {
    const menuDelDia = RUTAS_DE_UNA_ENTRADA.find((r) => r.href === "/movimientos/menu-del-dia");
    if (MENU_DEL_DIA_VISIBLE) expect(menuDelDia).toMatchObject({ accion: "promo_menu_del_dia", entrada: "/carta/parametrizacion/promociones" });
    else expect(menuDelDia).toBeUndefined();
    expect(PESTANAS_DE_PROMOCIONES.map((p) => p.texto)).toEqual(MENU_DEL_DIA_VISIBLE ? ["Promociones", "Menú del día"] : ["Promociones"]);
  });
});

describe("las rutas que cuelgan de las entradas de Carta", () => {
  it("cada pantalla resalta su entrada y conserva su panel (el portal, Empresa)", () => {
    for (const href of ["/movimientos/opciones-agotadas", "/carta/agrupados", "/carta/parametrizacion/secciones", "/carta/parametrizacion/generos", "/carta/parametrizacion"]) {
      expect(hrefActivoDelMenu(href, COMPLETO, TODOS), href).toBe("/carta");
      expect(panelDeRuta(href), href).toBe("sucursal");
    }
    expect(hrefActivoDelMenu("/carta/tema", COMPLETO, TODOS)).toBe("/carta/parametrizacion/apariencia");
    expect(panelDeRuta("/carta/tema")).toBe("sucursal");
    expect(hrefActivoDelMenu("/carta/portal?x=1", COMPLETO, TODOS)).toBe("/carta/parametrizacion/apariencia");
    expect(panelDeRuta("/carta/portal")).toBe("empresa");
    // Las entradas de los dos paneles no fijan panel.
    expect(panelDeRuta("/carta/parametrizacion/apariencia")).toBeNull();
    expect(panelDeRuta("/carta/parametrizacion/promociones")).toBeNull();
    // Opciones agotadas ya no resalta «Registrar movimiento» aunque su URL empiece con /movimientos.
    expect(hrefActivoDelMenu("/movimientos/opciones-agotadas", COMPLETO, TODOS)).not.toBe("/movimientos");
  });

  it("si el rol no ve la entrada, la pantalla no resalta nada", () => {
    expect(hrefActivoDelMenu("/carta/agrupados", COMPLETO, new Set(COMPLETO.filter((h) => h !== "/carta")))).toBeNull();
  });

  it("cambiar de sucursal vuelve a la misma pantalla si el rol la ve allá, y a ninguna si no", () => {
    expect(pantallaTrasCambiarSucursal("/movimientos/opciones-agotadas", puede("opcion_apagar_en_sucursal"))).toBe("/movimientos/opciones-agotadas");
    expect(pantallaTrasCambiarSucursal("/carta/agrupados", puede("carta_ver"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/carta/tema", puede("carta_tema"))).toBe("/carta/tema");
  });

  it("el buscador del cajón de celular encuentra «opciones agotadas» y «tema» con su grupo, solo para quien los ve", () => {
    const visibles = puede("carta_ver", "opcion_apagar_en_sucursal", "carta_tema");
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, visibles);
    const rutas = rutasDeUnaEntradaVisibles(visibles);
    expect(buscarPantallaEnMenu(menu, "agotadas", rutas).map((p) => [p.href, p.grupoId])).toEqual([["/movimientos/opciones-agotadas", "carta"]]);
    expect(buscarPantallaEnMenu(menu, "tema", rutas).map((p) => p.href)).toEqual(["/carta/tema"]);
    const sin = puede("carta_ver");
    expect(buscarPantallaEnMenu(filtrarMenuPorPermiso(GRUPOS_NAV, sin), "agotadas", rutasDeUnaEntradaVisibles(sin))).toEqual([]);
  });
});

describe("armarPestanasDeCarta: qué pestañas se ofrecen, a dónde llevan y cuál se marca", () => {
  it("con todo, «Hoy» lleva a /carta y se marca también en Opciones agotadas; «Secciones y géneros» se marca en Géneros", () => {
    const todo = puede("carta_ver", "opcion_apagar_en_sucursal", "carta_items_agrupados");
    expect(armarPestanasDeCarta(PESTANAS_DE_CARTA, todo, "/movimientos/opciones-agotadas")).toEqual([
      { href: "/carta", texto: "Hoy", actual: true },
      { href: "/carta/parametrizacion/secciones", texto: "Secciones y géneros", actual: false },
      { href: "/carta/agrupados", texto: "Ítems agrupados", actual: false },
    ]);
    expect(armarPestanasDeCarta(PESTANAS_DE_CARTA, todo, "/carta/parametrizacion/generos").find((p) => p.actual)?.texto).toBe("Secciones y géneros");
  });

  it("sin carta_ver, «Hoy» lleva a Opciones agotadas y «Secciones y géneros» no se ofrece; sin ninguna clave, nada", () => {
    expect(armarPestanasDeCarta(PESTANAS_DE_CARTA, puede("opcion_apagar_en_sucursal"), "/movimientos/opciones-agotadas")).toEqual([
      { href: "/movimientos/opciones-agotadas", texto: "Hoy", actual: true },
    ]);
    expect(armarPestanasDeCarta(PESTANAS_DE_CARTA, puede(), "/carta")).toEqual([]);
  });

  it("primeraPantallaVisible: a dónde redirige una entrada a quien no ve su pantalla principal", () => {
    expect(primeraPantallaVisible(PESTANAS_DE_CARTA, puede("carta_items_agrupados"))).toBe("/carta/agrupados");
    expect(primeraPantallaVisible(PESTANAS_DE_APARIENCIA, puede("carta_portal"))).toBe("/carta/portal");
    expect(primeraPantallaVisible(PESTANAS_DE_APARIENCIA, puede("carta_tema", "carta_portal"))).toBe("/carta/tema");
    expect(primeraPantallaVisible(PESTANAS_DE_APARIENCIA, puede("carta_ver"))).toBeNull();
  });
});
