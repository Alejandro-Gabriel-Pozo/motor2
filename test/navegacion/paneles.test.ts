import { describe, expect, it } from "vitest";
import {
  GRUPOS_NAV,
  RUTAS_FUERA_DEL_MENU,
  filtrarMenuPorPermiso,
  hrefsDelMenu,
  mostrarSelectorDePaneles,
  panelDeRuta,
  particionarMenu,
  type GrupoNav,
} from "../../src/core/navegacion/estructura";
import { ACCIONES, contextoDeAccion, type AccionClave } from "../../src/core/permisos/acciones";

const TODOS_LOS_ITEMS = [...GRUPOS_NAV.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU];

/** Las acciones que ve cada perfil de prueba: el admin ve todo el menú, el operador las que el seed le deja editar, el mozo solo el salón. */
const ADMIN = new Set(TODOS_LOS_ITEMS.flatMap((i) => (i.accion ? [i.accion] : [])));
const OPERADOR = new Set<AccionClave>(ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes("operador")).map((a) => a.clave as AccionClave));
const SOLO_SALON = new Set<AccionClave>(["pos_mesas"]);
const menuDe = (acciones: ReadonlySet<AccionClave>) => filtrarMenuPorPermiso(GRUPOS_NAV, acciones);
const hrefs = (grupos: GrupoNav[]) => grupos.flatMap((g) => g.items.map((i) => i.href));

/** Los únicos ítems cuyo panel no es el contexto de su acción: `ambos` (tienen una cara en cada panel). Cada uno con su motivo. */
const EXCEPCIONES_DE_CONTEXTO: Record<string, string> = {
  "/catalogo/productos": "El catálogo de productos es de la empresa, pero cada sucursal lo mira y edita lo suyo (disponibilidad, precio local): aparece en los dos paneles.",
  "/catalogo/productos/nuevo": "Cuelga de Productos (ruta fuera del menú): hereda su panel.",
};

describe("cada pantalla del menú declara su panel", () => {
  it("todo ítem (del menú y fuera de él) tiene un panel válido", () => {
    for (const i of TODOS_LOS_ITEMS) expect(["empresa", "sucursal", "ambos"], i.href).toContain(i.panel);
  });

  it("el panel de cada ítem coincide con el contexto de su acción (empresa/sucursal), salvo las excepciones documentadas", () => {
    const desparejos = TODOS_LOS_ITEMS.filter((i) => i.accion && i.panel !== contextoDeAccion(i.accion)).map((i) => i.href);
    expect(desparejos.sort()).toEqual(Object.keys(EXCEPCIONES_DE_CONTEXTO).sort());
  });

  it("las excepciones documentadas son todas `ambos` (una excepción vieja que ya coincide se saca de la lista)", () => {
    for (const href of Object.keys(EXCEPCIONES_DE_CONTEXTO)) expect(TODOS_LOS_ITEMS.find((i) => i.href === href)?.panel, href).toBe("ambos");
  });

  it("los ítems del módulo Salón y de Movimientos operativos son de Sucursal; Motivos y Destinos, de Empresa", () => {
    const panel = (href: string) => TODOS_LOS_ITEMS.find((i) => i.href === href)?.panel;
    expect(panel("/mesas")).toBe("sucursal");
    expect(panel("/movimientos/compra")).toBe("sucursal");
    expect(panel("/movimientos/motivos-merma")).toBe("empresa");
    expect(panel("/movimientos/destinos-consumo")).toBe("empresa");
  });
});

describe("panelDeRuta: el panel de la pantalla abierta", () => {
  it.each([
    ["/catalogo/categorias", "empresa"],
    ["/catalogo/margen-objetivo", "empresa"],
    ["/administracion/roles", "empresa"],
    ["/carta/agrupados", "empresa"],
    ["/carta/tema", "sucursal"],
    ["/carta", "sucursal"],
    ["/movimientos/compra", "sucursal"],
    ["/movimientos/motivos-merma", "empresa"],
    ["/reportes/huecos-catalogo", "empresa"],
    ["/reportes/costos", "sucursal"],
    ["/mesas", "sucursal"],
  ] as const)("%s → %s", (ruta, esperado) => {
    expect(panelDeRuta(ruta)).toBe(esperado);
  });

  it("una pantalla hija es del panel del ítem del que cuelga (también las que están fuera del menú)", () => {
    expect(panelDeRuta("/catalogo/recetas/abc/historial")).toBe("empresa");
    expect(panelDeRuta("/catalogo/proveedores/comparativa")).toBe("empresa");
    expect(panelDeRuta("/catalogo/proveedores/xyz")).toBe("empresa");
    expect(panelDeRuta("/reportes/rendimiento-recetas/por-sucursal")).toBe("sucursal");
  });

  it("una pantalla de ambos paneles, el inicio o una ruta desconocida no fijan panel (null)", () => {
    expect(panelDeRuta("/catalogo/productos")).toBeNull();
    expect(panelDeRuta("/catalogo/productos/nuevo")).toBeNull();
    expect(panelDeRuta("/catalogo/productos/abc")).toBeNull();
    expect(panelDeRuta("/inicio")).toBeNull();
    expect(panelDeRuta("/otra-cosa")).toBeNull();
  });

  it("ignora la barra final, la consulta y el ancla", () => {
    expect(panelDeRuta("/catalogo/categorias/")).toBe("empresa");
    expect(panelDeRuta("/stock/minimo?x=1")).toBe("sucursal");
    expect(panelDeRuta("/administracion/sucursales#a")).toBe("empresa");
  });

  it("cada ítem del menú se resuelve a su propio panel", () => {
    for (const href of hrefsDelMenu()) {
      const item = TODOS_LOS_ITEMS.find((i) => i.href === href)!;
      expect(panelDeRuta(href), href).toBe(item.panel === "ambos" ? null : item.panel);
    }
  });
});

describe("particionarMenu", () => {
  it("cada ítem está en el panel que declara y los `ambos` en los dos; ninguno falta ni está de más", () => {
    const { empresa, sucursal } = particionarMenu(GRUPOS_NAV);
    for (const i of GRUPOS_NAV.flatMap((g) => g.items)) {
      expect(hrefs(empresa).includes(i.href), `${i.href} en Empresa`).toBe(i.panel !== "sucursal");
      expect(hrefs(sucursal).includes(i.href), `${i.href} en Sucursal`).toBe(i.panel !== "empresa");
    }
  });

  it("un grupo que se queda sin ítems en un panel no aparece en él, y el resto conserva su orden", () => {
    const { empresa, sucursal } = particionarMenu(GRUPOS_NAV);
    expect(sucursal.map((g) => g.id)).toEqual(["administracion", "catalogo", "carta", "movimientos", "stock", "reportes", "traspasos", "pos"]);
    expect(empresa.map((g) => g.id)).toEqual(["administracion", "catalogo", "carta", "movimientos", "reportes"]);
    expect(hrefs(sucursal).filter((h) => h.startsWith("/catalogo"))).toEqual(["/catalogo/productos"]);
  });

  it("no pierde ni inventa nada: la unión de los dos paneles es el menú entero", () => {
    const { empresa, sucursal } = particionarMenu(GRUPOS_NAV);
    expect(new Set([...hrefs(empresa), ...hrefs(sucursal)])).toEqual(new Set(hrefsDelMenu()));
  });
});

describe("mostrarSelectorDePaneles: por perfil", () => {
  it("el administrador ve los dos paneles", () => {
    const menu = menuDe(ADMIN);
    expect(mostrarSelectorDePaneles(menu)).toBe(true);
    const { empresa, sucursal } = particionarMenu(menu);
    expect(hrefs(empresa)).toContain("/catalogo/categorias");
    expect(hrefs(empresa)).not.toContain("/stock/consolidado");
    expect(hrefs(sucursal)).toContain("/stock/consolidado");
    expect(hrefs(sucursal)).not.toContain("/catalogo/categorias");
  });

  it("el operador no ve ninguna pantalla exclusiva de Empresa: menú único, sin selector", () => {
    const menu = menuDe(OPERADOR);
    expect(menu.flatMap((g) => g.items).filter((i) => i.panel === "empresa")).toEqual([]);
    expect(mostrarSelectorDePaneles(menu)).toBe(false);
  });

  it("quien solo tiene el salón no ve selector", () => {
    expect(mostrarSelectorDePaneles(menuDe(SOLO_SALON))).toBe(false);
  });

  it("quien ve únicamente pantallas de Empresa no ve selector (el panel Sucursal estaría vacío)", () => {
    expect(mostrarSelectorDePaneles(menuDe(new Set<AccionClave>(["categorias", "unidades"])))).toBe(false);
  });

  it("alcanza con una sola pantalla de Empresa más alguna de Sucursal", () => {
    expect(mostrarSelectorDePaneles(menuDe(new Set<AccionClave>(["categorias", "ver_stock"])))).toBe(true);
  });

  it("un menú vacío no tiene selector", () => {
    expect(mostrarSelectorDePaneles([])).toBe(false);
  });
});
