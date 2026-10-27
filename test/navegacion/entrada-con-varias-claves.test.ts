import { describe, expect, it } from "vitest";
import {
  GRUPOS_NAV,
  RUTAS_DE_UNA_ENTRADA,
  RUTAS_FUERA_DEL_MENU,
  accionDeRuta,
  accionesDeNavegacion,
  accionesDelMenu,
  filtrarMenuPorPermiso,
  hrefActivoDelMenu,
  hrefsDelMenu,
  itemDeRuta,
  panelDeRuta,
  type GrupoNav,
  type ItemNav,
  type RutaDeUnaEntrada,
} from "../../src/core/navegacion/estructura";
import { buscarPantallaEnMenu } from "../../src/core/navegacion/buscar-pantalla";
import { pantallaTrasCambiarSucursal } from "../../src/core/navegacion/pantalla-tras-cambio";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * P1 de «Movimientos» (Fase 7): el mecanismo del menú para una ENTRADA que reúne varias pantallas (`algunaDe`) y para las rutas de proceso que se abren desde ella (`RUTAS_DE_UNA_ENTRADA`).
 * Todo con datos SINTÉTICOS: el menú real todavía no tiene ningún ítem `algunaDe` y la lista real está vacía a propósito (poblarla antes cambiaría el ítem que se resalta).
 */

const ENTRADA: ItemNav = {
  href: "/movimientos",
  label: "Registrar movimiento",
  algunaDe: ["proceso_ajuste", "proceso_consumo", "proceso_produccion"],
  panel: "sucursal",
};
const COMPRA: ItemNav = { href: "/movimientos/compra", label: "Compra", accion: "proceso_compra", panel: "sucursal" };
const STOCK: ItemNav = { href: "/stock/consolidado", label: "Consolidado", accion: "ver_stock", panel: "sucursal" };

const MENU: GrupoNav[] = [
  { id: "movimientos", label: "Movimientos", items: [ENTRADA, COMPRA] },
  { id: "stock", label: "Stock", items: [STOCK] },
];

const RUTAS: readonly RutaDeUnaEntrada[] = [
  { href: "/movimientos/ajuste", label: "Ajuste", accion: "proceso_ajuste", panel: "sucursal", entrada: "/movimientos" },
  { href: "/movimientos/consumo", label: "Consumo", accion: "proceso_consumo", panel: "sucursal", entrada: "/movimientos" },
  { href: "/movimientos/produccion", label: "Producción", accion: "proceso_produccion", panel: "sucursal", entrada: "/movimientos" },
];

const puede = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);

describe("ítem con `algunaDe`: se ve si el rol puede Ver ALGUNA de las claves", () => {
  it("con una sola de las claves, el ítem se ve (y los otros ítems siguen su propia regla)", () => {
    const menu = filtrarMenuPorPermiso(MENU, puede("proceso_consumo"));
    expect(menu.map((g) => g.id)).toEqual(["movimientos"]);
    expect(menu[0].items.map((i) => i.href)).toEqual(["/movimientos"]);
  });

  it("sin ninguna de las claves visibles, el ítem desaparece, y el grupo con él si queda vacío", () => {
    expect(filtrarMenuPorPermiso(MENU, puede("proceso_compra"))[0].items.map((i) => i.href)).toEqual(["/movimientos/compra"]);
    expect(filtrarMenuPorPermiso(MENU, puede("ver_stock")).map((g) => g.id)).toEqual(["stock"]);
    expect(filtrarMenuPorPermiso(MENU, puede())).toEqual([]);
  });

  it("falla cerrado: un ítem sin `accion` ni `algunaDe` (solo posible esquivando los tipos) no lo ve nadie", () => {
    const sinClave = { href: "/sin-clave", label: "Sin clave", panel: "sucursal" } as unknown as ItemNav;
    const sinListaVacia = { href: "/lista-vacia", label: "Lista vacía", algunaDe: [], panel: "sucursal" } as unknown as ItemNav;
    const menu: GrupoNav[] = [{ id: "x", label: "X", items: [sinClave, sinListaVacia, STOCK] }];
    expect(filtrarMenuPorPermiso(menu, puede("ver_stock"))[0].items.map((i) => i.href)).toEqual(["/stock/consolidado"]);
    expect(filtrarMenuPorPermiso(menu, puede())).toEqual([]);
  });

  it("accionesDelMenu trae las claves de `algunaDe` (sin repetir)", () => {
    expect(accionesDelMenu(MENU).sort()).toEqual(["proceso_ajuste", "proceso_compra", "proceso_consumo", "proceso_produccion", "ver_stock"]);
  });

  it("los tipos: la lista no puede estar vacía ni convivir con `accion`", () => {
    // @ts-expect-error la lista de `algunaDe` es no vacía por tipo
    const vacia: ItemNav = { href: "/a", label: "A", algunaDe: [], panel: "sucursal" };
    // @ts-expect-error un ítem lleva `accion` O `algunaDe`, no las dos
    const ambas: ItemNav = { href: "/b", label: "B", accion: "ver_stock", algunaDe: ["ver_stock"], panel: "sucursal" };
    // @ts-expect-error un ítem sin ninguna clave no compila
    const ninguna: ItemNav = { href: "/c", label: "C", panel: "sucursal" };
    expect([vacia, ambas, ninguna]).toHaveLength(3);
  });
});

describe("rutas de una entrada: se leen como las pantallas fuera del menú", () => {
  it("itemDeRuta y accionDeRuta resuelven la ruta de la lista (con consulta, ancla y barra final) por su propia acción", () => {
    expect(itemDeRuta("/movimientos/ajuste", MENU, RUTAS)?.href).toBe("/movimientos/ajuste");
    expect(itemDeRuta("/movimientos/ajuste/?x=1#a", MENU, RUTAS)?.href).toBe("/movimientos/ajuste");
    expect(accionDeRuta("/movimientos/ajuste?x=1", MENU, RUTAS)).toBe("proceso_ajuste");
    expect(accionDeRuta("/movimientos/consumo", MENU, RUTAS)).toBe("proceso_consumo");
  });

  it("sin la lista, esa ruta cae en la entrada `algunaDe` (que no tiene UNA acción: null) y la ruta de otro ítem sigue igual", () => {
    expect(accionDeRuta("/movimientos/ajuste", MENU, [])).toBeNull();
    expect(accionDeRuta("/movimientos/compra", MENU, RUTAS)).toBe("proceso_compra");
  });

  it("la ruta más larga gana: la de la lista sobre la entrada de la que cuelga", () => {
    expect(itemDeRuta("/movimientos/ajuste", MENU, RUTAS)?.href).not.toBe("/movimientos");
    expect(itemDeRuta("/movimientos", MENU, RUTAS)?.href).toBe("/movimientos");
  });

  it("panelDeRuta usa el panel de la ruta de la lista (no el de la entrada)", () => {
    const empresa: RutaDeUnaEntrada[] = [{ href: "/movimientos/secreta", label: "Secreta", accion: "proceso_ajuste", panel: "empresa", entrada: "/movimientos" }];
    expect(panelDeRuta("/movimientos/secreta", MENU, empresa)).toBe("empresa");
    expect(panelDeRuta("/movimientos/ajuste", MENU, RUTAS)).toBe("sucursal");
    expect(panelDeRuta("/movimientos/ajuste", MENU, [])).toBe("sucursal");
  });

  it("accionesDeNavegacion suma las acciones de la lista", () => {
    const sinLista = accionesDeNavegacion(MENU, []);
    const extra: RutaDeUnaEntrada[] = [{ href: "/movimientos/otra", label: "Otra", accion: "stock_reclasificar", panel: "sucursal", entrada: "/movimientos" }];
    expect(sinLista).not.toContain("stock_reclasificar");
    expect(accionesDeNavegacion(MENU, extra)).toContain("stock_reclasificar");
  });
});

describe("hrefActivoDelMenu: una ruta de la lista resalta su entrada", () => {
  const COMPLETO = hrefsDelMenu(MENU);
  const TODOS = new Set(COMPLETO);
  const activo = (pathname: string, visibles: ReadonlySet<string> = TODOS) => hrefActivoDelMenu(pathname, COMPLETO, visibles, RUTAS);

  it.each(["/movimientos/ajuste", "/movimientos/consumo", "/movimientos/produccion", "/movimientos/ajuste?x=1", "/movimientos/ajuste/", "/movimientos/ajuste/abc"])("%s resalta la entrada", (pathname) => {
    expect(activo(pathname)).toBe("/movimientos");
  });

  it("la entrada y los ítems que no son de la lista siguen resaltándose a sí mismos", () => {
    expect(activo("/movimientos")).toBe("/movimientos");
    expect(activo("/movimientos/compra")).toBe("/movimientos/compra");
    expect(activo("/stock/consolidado")).toBe("/stock/consolidado");
  });

  it("sin la traducción, la ruta resalta la entrada solo por prefijo (con otra ruta, ninguna)", () => {
    expect(hrefActivoDelMenu("/movimientos/ajuste", COMPLETO, TODOS, [])).toBe("/movimientos");
    const otra: RutaDeUnaEntrada[] = [{ href: "/stock/reclasificar", label: "Reclasificar", accion: "stock_reclasificar", panel: "sucursal", entrada: "/movimientos" }];
    expect(hrefActivoDelMenu("/stock/reclasificar", COMPLETO, TODOS, [])).toBeNull();
    expect(hrefActivoDelMenu("/stock/reclasificar", COMPLETO, TODOS, otra)).toBe("/movimientos");
  });

  it("si el rol no ve la entrada, no se resalta nada (ni un ítem más corto)", () => {
    const sinEntrada = new Set(COMPLETO.filter((h) => h !== "/movimientos"));
    expect(activo("/movimientos/ajuste", sinEntrada)).toBeNull();
  });
});

describe("buscarPantallaEnMenu: encuentra las rutas de la lista que recibe (ya filtradas por permiso)", () => {
  it("«ajuste» encuentra la ruta, con el grupo de su entrada, después de los ítems del grupo", () => {
    expect(buscarPantallaEnMenu(MENU, "ajuste", RUTAS)).toEqual([{ href: "/movimientos/ajuste", label: "Ajuste", grupoId: "movimientos", grupoLabel: "Movimientos" }]);
    expect(buscarPantallaEnMenu(MENU, "movimientos", RUTAS).map((p) => p.href)).toEqual([
      "/movimientos",
      "/movimientos/compra",
      "/movimientos/ajuste",
      "/movimientos/consumo",
      "/movimientos/produccion",
    ]);
  });

  it("sin la lista (el valor por defecto: quien llama la filtra por permiso), no aparecen", () => {
    expect(buscarPantallaEnMenu(MENU, "ajuste")).toEqual([]);
  });

  it("si el menú que recibe no tiene la entrada, la ruta no aparece", () => {
    const sinMovimientos = MENU.filter((g) => g.id !== "movimientos");
    expect(buscarPantallaEnMenu(sinMovimientos, "ajuste", RUTAS)).toEqual([]);
  });

  it("exige todas las palabras, también con el nombre del grupo", () => {
    expect(buscarPantallaEnMenu(MENU, "movimientos ajuste", RUTAS).map((p) => p.href)).toEqual(["/movimientos/ajuste"]);
    expect(buscarPantallaEnMenu(MENU, "stock ajuste", RUTAS)).toEqual([]);
  });
});

describe("pantallaTrasCambiarSucursal sobre las rutas de la lista y la entrada", () => {
  const cambio = (actual: string, visibles: ReadonlySet<AccionClave>) => pantallaTrasCambiarSucursal(actual, visibles, MENU, RUTAS);

  it("vuelve a la misma ruta de la lista si el rol ve su acción en la sucursal nueva (sin consulta ni ids)", () => {
    expect(cambio("/movimientos/ajuste?productoId=abc", puede("proceso_ajuste"))).toBe("/movimientos/ajuste");
    expect(cambio("/movimientos/consumo/", puede("proceso_consumo"))).toBe("/movimientos/consumo");
  });

  it("si ve la entrada por OTRA clave pero no la de esta ruta, da null (no vuelve a una pantalla que no puede abrir)", () => {
    expect(cambio("/movimientos/ajuste", puede("proceso_consumo"))).toBeNull();
    expect(cambio("/movimientos/ajuste", puede())).toBeNull();
  });

  it("la entrada misma vuelve si el rol ve ALGUNA de sus claves", () => {
    expect(cambio("/movimientos", puede("proceso_produccion"))).toBe("/movimientos");
    expect(cambio("/movimientos", puede("ver_stock"))).toBeNull();
  });
});

describe("la lista real", () => {
  it("cada ruta apunta a un ítem del menú real como entrada, no repite ruta ni choca con un ítem del menú o una pantalla fuera del menú", () => {
    const hrefsDelMenuReal = new Set(hrefsDelMenu());
    const propios = [...hrefsDelMenuReal, ...RUTAS_FUERA_DEL_MENU.map((i) => i.href)];
    const rutas = RUTAS_DE_UNA_ENTRADA.map((r) => r.href);
    expect(new Set(rutas).size).toBe(rutas.length);
    for (const r of RUTAS_DE_UNA_ENTRADA) {
      expect(hrefsDelMenuReal.has(r.entrada), `${r.href}: su entrada ${r.entrada} no es un ítem del menú`).toBe(true);
      expect(propios.includes(r.href), `${r.href} ya es un ítem del menú o una pantalla fuera del menú`).toBe(false);
    }
  });

  it("el menú real no tiene ítems sin clave: cada ítem lleva `accion` o una lista `algunaDe` no vacía", () => {
    for (const item of GRUPOS_NAV.flatMap((g) => g.items)) {
      expect(item.accion !== undefined || (item.algunaDe?.length ?? 0) > 0, item.href).toBe(true);
    }
  });
});
