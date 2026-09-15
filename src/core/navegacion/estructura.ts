import { NAV_MOVIMIENTOS } from "@/core/movimientos/ui-config";

export interface ItemNav {
  href: string;
  label: string;
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
      { href: "/reportes", label: "Resumen" },
      { href: "/reportes/consolidado", label: "Consolidado (mis sucursales)" },
      { href: "/reportes/periodo", label: "Período" },
      { href: "/reportes/categorias", label: "Por categoría" },
      { href: "/reportes/costos", label: "Costos y márgenes" },
      { href: "/reportes/valuacion", label: "Valuación de inventario" },
      { href: "/reportes/promociones", label: "Promociones" },
      { href: "/reportes/perdidas", label: "Pérdidas" },
      { href: "/reportes/devoluciones", label: "Devoluciones" },
      { href: "/reportes/vencimientos", label: "Vencimientos" },
      { href: "/reportes/diferencias", label: "Diferencias de ajuste" },
      { href: "/reportes/sin-receta", label: "Ventas sin receta" },
      { href: "/reportes/insumos-sin-receta", label: "Insumos sin receta" },
      { href: "/reportes/consignacion", label: "Consignación" },
      { href: "/reportes/salud", label: "Salud por producto" },
      { href: "/reportes/huecos-catalogo", label: "Huecos de catálogo" },
      { href: "/reportes/conteos", label: "Conteos físicos" },
      { href: "/reportes/historial", label: "Historial de un producto" },
      { href: "/reportes/trazabilidad", label: "Trazabilidad por ID" },
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
