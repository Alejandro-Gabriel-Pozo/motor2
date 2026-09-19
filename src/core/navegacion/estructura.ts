import { NAV_MOVIMIENTOS } from "@/core/movimientos/ui-config";
import type { AccionClave } from "@/core/permisos/acciones";

export interface ItemNav {
  href: string;
  label: string;
  /** Si está, el ítem solo se muestra a quien puede VER esa acción (la misma que protege la página). Sin `accion`, siempre se muestra. */
  accion?: AccionClave;
}

export interface GrupoNav {
  id: string;
  label: string;
  items: ItemNav[];
}

/**
 * Fuente única del árbol de navegación — antes vivía duplicada, un array
 * `SECCIONES` distinto por cada `layout.tsx` de sección (6 copias del mismo
 * header, cada una con su propio criterio de qué mostrar y links "← / →"
 * a mano para saltar a la sección vecina). Ahora hay un solo lugar: el
 * sidebar persistente (`src/components/app-shell.tsx`) lo recorre entero,
 * así que ningún grupo necesita apuntar a los demás.
 */
export const GRUPOS_NAV: GrupoNav[] = [
  {
    id: "administracion",
    label: "Administración",
    items: [
      { href: "/administracion/usuarios", label: "Usuarios" },
      { href: "/administracion/roles", label: "Roles" },
      { href: "/administracion/permisos", label: "Permisos" },
      { href: "/administracion/capacidades-sucursal", label: "Capacidades por sucursal" },
      { href: "/administracion/sucursales", label: "Sucursales" },
      { href: "/administracion/auditoria", label: "Auditoría" },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    items: [
      { href: "/catalogo/productos", label: "Productos" },
      { href: "/catalogo/proveedores", label: "Proveedores" },
      { href: "/catalogo/recetas", label: "Recetas" },
      { href: "/catalogo/insumos-grupos", label: "Insumos / Grupos" },
      { href: "/catalogo/categorias", label: "Categorías" },
      { href: "/catalogo/unidades", label: "Unidades" },
    ],
  },
  {
    id: "movimientos",
    // NAV_MOVIMIENTOS trae 2 links cruzados a Stock/Reportes al final —
    // sobran acá, cada uno ya es su propio grupo del sidebar.
    label: "Movimientos",
    items: NAV_MOVIMIENTOS.filter((i) => i.href !== "/stock/consolidado" && i.href !== "/reportes"),
  },
  {
    id: "stock",
    label: "Stock",
    items: [
      { href: "/stock/consolidado", label: "Consolidado" },
      { href: "/stock/por-familia", label: "Por familia" },
      { href: "/stock/alertas", label: "Alertas" },
      { href: "/stock/minimo", label: "Stock mínimo" },
      { href: "/stock/reclasificar", label: "Reclasificar" },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    items: [
      // Cada reporte se protege con la acción de «Ver» que lleva `accion` (la página usa la misma clave; un test lo comprueba).
      // Grupos: dinero (ventas, costos, márgenes, valuación), control (pérdidas, devoluciones, diferencias), operativos,
      // catálogo; y los que ya tenían acción propia (promociones, consignación, conteos, huecos de catálogo).
      { href: "/reportes", label: "Resumen", accion: "ver_reportes_dinero" },
      { href: "/reportes/consolidado", label: "Consolidado (mis sucursales)", accion: "ver_reportes_dinero" },
      { href: "/reportes/periodo", label: "Período", accion: "ver_reportes_dinero" },
      { href: "/reportes/categorias", label: "Por categoría", accion: "ver_reportes_dinero" },
      { href: "/reportes/costos", label: "Costos y márgenes", accion: "ver_reportes_dinero" },
      { href: "/reportes/rendimiento-recetas", label: "Rendimiento real de recetas", accion: "ver_reportes_dinero" },
      { href: "/reportes/valuacion", label: "Valuación de inventario", accion: "ver_reportes_dinero" },
      { href: "/reportes/promociones", label: "Promociones", accion: "promociones_config" },
      { href: "/reportes/perdidas", label: "Pérdidas", accion: "ver_reportes_control" },
      { href: "/reportes/devoluciones", label: "Devoluciones", accion: "ver_reportes_control" },
      { href: "/reportes/vencimientos", label: "Vencimientos", accion: "ver_reportes_operativos" },
      { href: "/reportes/diferencias", label: "Diferencias de ajuste", accion: "ver_reportes_control" },
      { href: "/reportes/sin-receta", label: "Ventas sin receta", accion: "ver_reportes_catalogo" },
      { href: "/reportes/insumos-sin-receta", label: "Insumos sin receta", accion: "ver_reportes_catalogo" },
      { href: "/reportes/consignacion", label: "Consignación", accion: "pagar_consignante" },
      { href: "/reportes/salud", label: "Salud por producto", accion: "ver_reportes_operativos" },
      { href: "/reportes/huecos-catalogo", label: "Huecos de catálogo", accion: "insumos_mezclados" },
      { href: "/reportes/conteos", label: "Conteos físicos", accion: "proceso_control" },
      { href: "/reportes/historial", label: "Historial de un producto", accion: "ver_reportes_operativos" },
      { href: "/reportes/trazabilidad", label: "Trazabilidad por ID", accion: "ver_reportes_operativos" },
    ],
  },
  {
    id: "traspasos",
    label: "Traspasos",
    items: [
      { href: "/traspasos", label: "Bandeja" },
      { href: "/traspasos/solicitar", label: "Solicitar (a otra sucursal)" },
      { href: "/traspasos/enviar", label: "Enviar directo" },
    ],
  },
];

/** Todas las acciones que aparecen en algún ítem del menú: lo que hay que consultar para saber qué se muestra. */
export function accionesDelMenu(grupos: GrupoNav[] = GRUPOS_NAV): AccionClave[] {
  return [...new Set(grupos.flatMap((g) => g.items.flatMap((i) => (i.accion ? [i.accion] : []))))];
}

/** Deja solo los ítems que el usuario puede ver; un grupo que se queda sin ítems desaparece. */
export function filtrarMenuPorPermiso(grupos: GrupoNav[], puedeVer: ReadonlySet<AccionClave>): GrupoNav[] {
  return grupos
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.accion || puedeVer.has(i.accion)) }))
    .filter((g) => g.items.length > 0);
}
