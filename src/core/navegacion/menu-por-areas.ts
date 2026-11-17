import type { GrupoNav, ItemNav } from "./estructura";

/**
 * EL MENÚ POR ÁREAS (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, el menú por áreas (Recomendada)», paso 5 del plan de pantallas; criterio «las pantallas que quedan, iguales a Pedernal»).
 * Referencia: el menú REAL de Pedernal (`apps/web/ui/navegacion/menu.ts`: una tabla declarativa área → grupo → pantalla, con Ventas, Catálogo y Cuenta fija) y la maqueta `menu-por-areas.html` (áreas
 * Ventas · Catálogo · Compras y Cuenta, que el dueño fijó el 12/11/2026 con «Clientes en Ventas», «Proveedores en Compras» y la administración dentro de «Cuenta»).
 *
 * UN interruptor reversible (`MENU_POR_AREAS`): con `true` (hoy) el menú son cuatro áreas (Ventas, Catálogo, Compras y Cuenta al final) con sus grupos, sin los dos paneles Empresa/Sucursal; con
 * `false` vuelve el menú de siempre (los grupos de módulo y el selector de paneles). Es SOLO PRESENTACIÓN: las pantallas, las rutas y los permisos son los de siempre (el menú se arma con los mismos
 * ítems, ya filtrados por permiso: `filtrarMenuPorPermiso`), y nada se borra. Mover una pantalla de grupo o de área es cambiar UNA fila de `FILAS_DEL_MENU`.
 *
 * DIFERENCIAS CON PEDERNAL (declaradas; motivo):
 *  - Compras es un área (la maqueta aprobada la tiene; el código de Pedernal todavía no la construyó): Motor2 ya tiene Compra y Proveedores.
 *  - Lo que Motor2 tiene y Pedernal no (Salón, Reportes, Stock, Traspasos, Movimientos, Carta, Maestros…) queda DENTRO de un área, declarado en la tabla; el reparto en las áreas es una PROPUESTA
 *    (no hay decisión del dueño sobre dónde va cada pantalla de Motor2 que Pedernal no tiene): se muestra en captura para que el dueño la corrija.
 *  - Sin íconos en las áreas («por ahora, solo texto», dueño, 15/11/2026, en el registro de Pedernal).
 * Los ítems nuevos (de otros frentes) que todavía no tengan fila caen en el área de su grupo de origen (`AREA_POR_GRUPO_DE_ORIGEN`) para no perderse; `test/navegacion/menu-por-areas.test.ts` falla si
 * un ítem del menú no tiene su fila (hay que declararlo a propósito).
 */
export const MENU_POR_AREAS: boolean = true;

export type AreaId = "ventas" | "catalogo" | "compras" | "cuenta";

/** Las áreas, en el orden en que se ofrecen. «Cuenta» es la fija, siempre al final. */
export const AREAS_DEL_MENU: readonly { id: AreaId; label: string }[] = [
  { id: "ventas", label: "Ventas" },
  { id: "catalogo", label: "Catálogo" },
  { id: "compras", label: "Compras" },
  { id: "cuenta", label: "Cuenta" },
];

/** Una fila: una pantalla (`href` exacto) o todas las de un prefijo (`prefijo`, p. ej. los reportes); el orden de la tabla es el orden en el menú. `grupo`: el subencabezado dentro del área. */
type Fila = { area: AreaId; grupo: string | null } & ({ href: string; prefijo?: never } | { prefijo: string; href?: never });

const FILAS_DEL_MENU: readonly Fila[] = [
  // Ventas: lo que se hace al vender y lo que se mira del negocio.
  { area: "ventas", grupo: "Salón", href: "/mesas" },
  { area: "ventas", grupo: "Salón", href: "/mesas/mostrador" },
  { area: "ventas", grupo: "Clientes", href: "/catalogo/clientes" }, // «Clientes deberían estar en ventas» (dueño, 12/11/2026)
  { area: "ventas", grupo: "Reportes", prefijo: "/reportes" },
  // Catálogo: lo que se vende, la carta y el stock.
  { area: "catalogo", grupo: "Productos", href: "/catalogo/productos" },
  { area: "catalogo", grupo: "Productos", href: "/catalogo/opciones" },
  { area: "catalogo", grupo: "Productos", href: "/catalogo/insumos-grupos" },
  { area: "catalogo", grupo: "Carta", href: "/carta" },
  { area: "catalogo", grupo: "Carta", href: "/carta/parametrizacion/promociones" },
  { area: "catalogo", grupo: "Carta", href: "/carta/parametrizacion/apariencia" },
  { area: "catalogo", grupo: "Stock", href: "/stock/consolidado" },
  { area: "catalogo", grupo: "Stock", href: "/movimientos" },
  { area: "catalogo", grupo: "Stock", href: "/movimientos/merma" },
  { area: "catalogo", grupo: "Stock", href: "/movimientos/conteo-fisico" },
  { area: "catalogo", grupo: "Stock", href: "/movimientos/venta" },
  { area: "catalogo", grupo: "Stock", href: "/stock/configuracion" },
  { area: "catalogo", grupo: "Traspasos", prefijo: "/traspasos" },
  // Compras: la compra y los proveedores («Proveedores son de las compras», maqueta). Las órdenes de compra se suman acá cuando exista su ruta.
  { area: "compras", grupo: "Compras", href: "/movimientos/compra" },
  { area: "compras", grupo: "Proveedores", href: "/catalogo/proveedores" },
  // Cuenta: la administración (Pedernal: grupos «Empresa» y «Sucursal»; acá, según el panel que ya declara cada ítem).
  { area: "cuenta", grupo: "Empresa", href: "/administracion/empresa" },
  { area: "cuenta", grupo: "Empresa", href: "/administracion/gerencia" },
  { area: "cuenta", grupo: "Empresa", href: "/administracion/roles" },
  { area: "cuenta", grupo: "Empresa", href: "/administracion/permisos" },
  { area: "cuenta", grupo: "Empresa", href: "/administracion/capacidades-sucursal" },
  { area: "cuenta", grupo: "Empresa", href: "/administracion/sucursales" },
  { area: "cuenta", grupo: "Sucursal", href: "/administracion/usuarios" },
  { area: "cuenta", grupo: "Sucursal", href: "/administracion/auditoria" },
];

/** El área de un ítem sin fila propia: la de su grupo de siempre (así un ítem nuevo no desaparece del menú). */
const AREA_POR_GRUPO_DE_ORIGEN: Readonly<Record<string, AreaId>> = {
  pos: "ventas",
  reportes: "ventas",
  catalogo: "catalogo",
  carta: "catalogo",
  movimientos: "catalogo",
  stock: "catalogo",
  traspasos: "catalogo",
  administracion: "cuenta",
};

const quitarBarra = (ruta: string) => ruta.replace(/\/+$/, "");

/** La fila de una pantalla: la de `href` exacto o, si no, la del prefijo más largo; su posición es su orden. */
function filaDe(href: string): { fila: Fila; orden: number } | null {
  const ruta = quitarBarra(href);
  const exacta = FILAS_DEL_MENU.findIndex((f) => f.href !== undefined && quitarBarra(f.href) === ruta);
  if (exacta >= 0) return { fila: FILAS_DEL_MENU[exacta], orden: exacta };
  let mejor = -1;
  FILAS_DEL_MENU.forEach((f, i) => {
    if (f.prefijo !== undefined && (ruta === f.prefijo || ruta.startsWith(`${f.prefijo}/`)) && (mejor < 0 || f.prefijo.length > (FILAS_DEL_MENU[mejor].prefijo ?? "").length)) mejor = i;
  });
  return mejor >= 0 ? { fila: FILAS_DEL_MENU[mejor], orden: mejor } : null;
}

/** ¿Tiene este ítem su fila en la tabla? (el guardián de `test/navegacion/menu-por-areas.test.ts` lo exige para todo el menú). */
export function tieneFilaDeArea(href: string): boolean {
  return filaDe(href) !== null;
}

/**
 * El menú por áreas: los MISMOS ítems que recibe (ya filtrados por permiso), reagrupados en las áreas de `AREAS_DEL_MENU` en el orden de `FILAS_DEL_MENU`; cada ítem lleva su `subgrupo` (el grupo dentro del
 * área). Un área sin ítems no aparece. Pura: no decide qué se ofrece (eso ya lo decidió el permiso), solo dónde se pone.
 */
export function armarMenuPorAreas(grupos: readonly GrupoNav[]): GrupoNav[] {
  type Colocado = { item: ItemNav; area: AreaId; grupo: string | null; orden: number };
  const colocados: Colocado[] = [];
  let secuencia = 0;
  for (const g of grupos) {
    for (const item of g.items) {
      const f = filaDe(item.href);
      secuencia += 1;
      if (f) colocados.push({ item, area: f.fila.area, grupo: f.fila.grupo, orden: f.orden * 1000 + secuencia });
      else colocados.push({ item, area: AREA_POR_GRUPO_DE_ORIGEN[g.id] ?? "cuenta", grupo: g.label, orden: FILAS_DEL_MENU.length * 1000 + secuencia });
    }
  }
  return AREAS_DEL_MENU.map((a) => ({
    id: a.id,
    label: a.label,
    items: colocados
      .filter((c) => c.area === a.id)
      .sort((x, y) => x.orden - y.orden)
      .map((c) => (c.grupo === null ? c.item : { ...c.item, subgrupo: c.grupo })),
  })).filter((a) => a.items.length > 0);
}
