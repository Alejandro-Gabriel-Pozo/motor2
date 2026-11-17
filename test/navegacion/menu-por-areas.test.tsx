import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GRUPOS_NAV, filtrarMenuPorPermiso, type GrupoNav } from "../../src/core/navegacion/estructura";
import { AREAS_DEL_MENU, armarMenuPorAreas, tieneFilaDeArea } from "../../src/core/navegacion/menu-por-areas";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * El menú por áreas (Frente 6, paso 5; `src/core/navegacion/menu-por-areas.ts`). Oráculo escrito aparte de la tabla: qué pantalla va en qué área y grupo y en qué orden (PROPUESTA hasta que el dueño la
 * corrija en captura), y los guardianes: ningún ítem del menú se pierde ni se repite, todo ítem tiene su fila, y solo se reubica lo que el permiso ya dejó ver.
 */
const TODOS = GRUPOS_NAV.flatMap((g) => g.items);
const HREFS = new Set(TODOS.map((i) => i.href));
const REPORTES = TODOS.filter((i) => i.href.startsWith("/reportes")).map((i) => i.href);

/** Lo esperado por área: [grupo, hrefs en orden]. Los hrefs que hoy no son ítem del menú (p. ej. los que se ocultan con un interruptor) se omiten. */
const ESPERADO: Record<string, [string, string[]][]> = {
  ventas: [
    ["Salón", ["/mesas", "/mesas/mostrador"]],
    ["Clientes", ["/catalogo/clientes"]],
    ["Reportes", REPORTES],
  ],
  catalogo: [
    ["Productos", ["/catalogo/productos", "/catalogo/opciones", "/catalogo/insumos-grupos"]],
    ["Carta", ["/carta", "/carta/parametrizacion/promociones", "/carta/parametrizacion/apariencia"]],
    ["Stock", ["/stock/consolidado", "/movimientos", "/movimientos/merma", "/movimientos/conteo-fisico", "/movimientos/venta", "/stock/configuracion"]],
    ["Traspasos", ["/traspasos", "/traspasos/solicitar", "/traspasos/enviar"]],
  ],
  compras: [
    ["Compras", ["/movimientos/compra"]],
    ["Proveedores", ["/catalogo/proveedores"]],
  ],
  cuenta: [
    ["Empresa", ["/administracion/empresa", "/administracion/gerencia", "/administracion/roles", "/administracion/permisos", "/administracion/capacidades-sucursal", "/administracion/sucursales"]],
    ["Sucursal", ["/administracion/usuarios", "/administracion/auditoria"]],
  ],
};

const leer = (areas: GrupoNav[]) =>
  Object.fromEntries(
    areas.map((a) => {
      const grupos: [string, string[]][] = [];
      for (const i of a.items) {
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo[0] === (i.subgrupo ?? null)) ultimo[1].push(i.href);
        else grupos.push([i.subgrupo ?? "", [i.href]]);
      }
      return [a.id, grupos];
    })
  );
const esperadoPresente = Object.fromEntries(
  Object.entries(ESPERADO).map(([a, gs]) => [a, gs.map(([g, hs]): [string, string[]] => [g, hs.filter((h) => HREFS.has(h))]).filter(([, hs]) => hs.length > 0)])
);

describe("menú por áreas: el oráculo", () => {
  const areas = armarMenuPorAreas(GRUPOS_NAV);
  it("las áreas salen en su orden, con su nombre, y «Cuenta» al final", () => {
    expect(areas.map((a) => a.id)).toEqual(AREAS_DEL_MENU.map((a) => a.id).filter((id) => esperadoPresente[id].length > 0));
    expect(areas.at(-1)?.id).toBe("cuenta");
    expect(Object.fromEntries(areas.map((a) => [a.id, a.label]))).toMatchObject({ ventas: "Ventas", catalogo: "Catálogo", compras: "Compras", cuenta: "Cuenta" });
  });
  it("cada pantalla cae en su área y grupo, en el orden esperado", () => {
    expect(leer(areas)).toEqual(esperadoPresente);
  });
});

describe("menú por áreas: los guardianes", () => {
  it("todo ítem del menú tiene su fila declarada (un ítem nuevo hay que ubicarlo a propósito)", () => {
    expect(TODOS.filter((i) => !tieneFilaDeArea(i.href)).map((i) => i.href)).toEqual([]);
  });
  it("no se pierde ni se repite ninguna pantalla: son los mismos ítems, una sola vez", () => {
    const salida = armarMenuPorAreas(GRUPOS_NAV).flatMap((a) => a.items.map((i) => i.href));
    expect(salida.length).toBe(TODOS.length);
    expect([...salida].sort()).toEqual([...HREFS].sort());
  });
  it("solo reubica: la etiqueta, la ruta y la acción de cada ítem no cambian", () => {
    const original = new Map(TODOS.map((i) => [i.href, i]));
    for (const a of armarMenuPorAreas(GRUPOS_NAV)) for (const i of a.items) expect({ ...i, subgrupo: undefined }).toEqual({ ...original.get(i.href), subgrupo: undefined });
  });
  it("con el permiso ya aplicado: un rol que solo ve el salón tiene una sola área con una sola pantalla de salón, y las áreas vacías no aparecen", () => {
    const soloSalon = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["pos_mesas"]));
    const areas = armarMenuPorAreas(soloSalon);
    expect(areas.map((a) => a.id)).toEqual(["ventas"]);
    expect(areas[0].items.map((i) => i.href)).toEqual(["/mesas", "/mesas/mostrador"]);
  });
  it("sin ítems, sin áreas", () => {
    expect(armarMenuPorAreas([])).toEqual([]);
  });
  it("un ítem sin fila propia cae en el área de su grupo de origen, con el grupo de origen como subencabezado, y no se pierde", () => {
    const base = TODOS.find((i) => i.href === "/catalogo/productos")!;
    const nuevo = { ...base, href: "/stock/pantalla-nueva", label: "Pantalla nueva" };
    const areas = armarMenuPorAreas([{ id: "stock", label: "Stock", items: [nuevo] }]);
    expect(areas).toHaveLength(1);
    expect(areas[0].id).toBe("catalogo");
    expect(areas[0].items[0]).toMatchObject({ href: "/stock/pantalla-nueva", subgrupo: "Stock" });
  });
  it("un reporte nuevo entra solo en Ventas › Reportes (la fila es por prefijo)", () => {
    const base = TODOS.find((i) => i.href.startsWith("/reportes"))!;
    const areas = armarMenuPorAreas([{ id: "reportes", label: "Reportes", items: [{ ...base, href: "/reportes/uno-nuevo", label: "Uno nuevo" }] }]);
    expect(areas[0]).toMatchObject({ id: "ventas" });
    expect(areas[0].items[0]).toMatchObject({ href: "/reportes/uno-nuevo", subgrupo: "Reportes" });
  });
});

// El menú lateral, los dos estados del interruptor: con áreas, sin selector de paneles y con subencabezados; sin áreas, el de siempre.
vi.mock("next/navigation", () => ({ usePathname: () => "/catalogo/productos" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>, useLinkStatus: () => ({ pending: false }) }));

describe("menú lateral: los dos estados", () => {
  afterEach(() => vi.resetModules());
  it("por áreas: la pantalla abierta abre su área, con el subencabezado de su grupo y sin selector de paneles ni íconos", async () => {
    const { SidebarNav } = await import("../../src/components/sidebar-nav");
    const areas = armarMenuPorAreas(GRUPOS_NAV);
    const html = renderToStaticMarkup(<SidebarNav grupos={areas} hrefsDelMenu={[...HREFS]} dosPaneles sucursalNombre="Central" porAreas />);
    expect(html).toContain("Catálogo");
    expect(html).toContain("Ventas");
    expect(html).toContain("Cuenta");
    expect(html).toContain(">Productos<"); // subencabezado del grupo, en el área abierta
    expect(html).not.toContain("Panel del menú");
    expect(html).not.toContain("<svg");
  });
  it("de siempre: los grupos de módulo y, con los dos paneles, el selector", async () => {
    const { SidebarNav } = await import("../../src/components/sidebar-nav");
    const html = renderToStaticMarkup(<SidebarNav grupos={GRUPOS_NAV} hrefsDelMenu={[...HREFS]} dosPaneles sucursalNombre="Central" />);
    expect(html).toContain("Panel del menú");
    expect(html).toContain("Administración");
    expect(html).not.toContain("Ventas");
  });
});
