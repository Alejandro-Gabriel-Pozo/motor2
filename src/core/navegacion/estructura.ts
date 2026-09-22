import { NAV_MOVIMIENTOS } from "@/core/movimientos/ui-config";
import type { AccionClave } from "@/core/permisos/acciones";

export interface ItemNav {
  href: string;
  label: string;
  /** El ítem solo se muestra a quien puede VER esa acción (la misma que protege la página; un test lo comprueba para todos los ítems). */
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
      { href: "/administracion/usuarios", label: "Usuarios", accion: "gestion_usuarios" },
      { href: "/administracion/roles", label: "Roles", accion: "gestion_permisos" },
      { href: "/administracion/permisos", label: "Permisos", accion: "gestion_permisos" },
      { href: "/administracion/capacidades-sucursal", label: "Capacidades por sucursal", accion: "capacidades_sucursal" },
      { href: "/administracion/sucursales", label: "Sucursales", accion: "alta_sucursal" },
      { href: "/administracion/auditoria", label: "Auditoría", accion: "ver_auditoria" },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    items: [
      { href: "/catalogo/productos", label: "Productos", accion: "alta_producto" },
      { href: "/catalogo/proveedores", label: "Proveedores", accion: "proveedores" },
      { href: "/catalogo/recetas", label: "Recetas", accion: "guardar_receta" },
      { href: "/catalogo/insumos-grupos", label: "Insumos / Grupos", accion: "grupos_familia" },
      { href: "/catalogo/categorias", label: "Categorías", accion: "categorias" },
      { href: "/catalogo/unidades", label: "Unidades", accion: "unidades" },
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
      { href: "/stock/consolidado", label: "Consolidado", accion: "ver_stock" },
      { href: "/stock/por-familia", label: "Por familia", accion: "ver_stock" },
      { href: "/stock/alertas", label: "Alertas", accion: "ver_stock" },
      { href: "/stock/minimo", label: "Stock mínimo", accion: "stock_minimo" },
      { href: "/stock/reclasificar", label: "Reclasificar", accion: "proceso_control" },
      { href: "/stock/conteo-frecuencia", label: "Frecuencia de conteo", accion: "proceso_control" },
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
      { href: "/reportes/compras", label: "Compras registradas", accion: "ver_reportes_dinero" },
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
      { href: "/traspasos", label: "Bandeja", accion: "proceso_transferencia_sucursal" },
      { href: "/traspasos/solicitar", label: "Solicitar (a otra sucursal)", accion: "proceso_transferencia_sucursal" },
      { href: "/traspasos/enviar", label: "Enviar directo", accion: "proceso_transferencia_sucursal" },
    ],
  },
];

/**
 * Pantallas a las que se llega con un enlace desde otra pantalla pero que no tienen ítem en el menú, con la acción de «Ver» que las
 * protege (la misma que pide su página; un test lo comprueba). Las rutas hijas de un ítem del menú (`/catalogo/recetas/[id]`,
 * `/catalogo/recetas/[id]/historial`, `/movimientos/compra?…`) no van acá: `accionDeRuta` las resuelve por el ítem del que cuelgan.
 */
export const RUTAS_FUERA_DEL_MENU: ItemNav[] = [{ href: "/catalogo/proveedores/comparativa", label: "Comparativa de precios", accion: "comparar_precios" }];

/**
 * La acción de «Ver» que protege la pantalla a la que apunta un enlace interno, o `null` si no se conoce (la raíz, una ruta
 * desconocida). Se resuelve por el ítem del menú (o de `RUTAS_FUERA_DEL_MENU`) cuya ruta es la más larga que es prefijo de la del
 * enlace: la consulta (`?…`) y el ancla (`#…`) se ignoran. Es lo que permite mostrar un enlace solo a quien puede abrir su destino.
 */
export function accionDeRuta(href: string, grupos: GrupoNav[] = GRUPOS_NAV): AccionClave | null {
  const ruta = href.split(/[?#]/)[0].replace(/\/+$/, "");
  const candidatos = [...grupos.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU].filter((i) => i.accion && (ruta === i.href || ruta.startsWith(`${i.href}/`)));
  candidatos.sort((a, b) => b.href.length - a.href.length);
  return candidatos[0]?.accion ?? null;
}

/** Las acciones del menú más las de las pantallas fuera del menú: todo lo que hay que consultar para decidir qué enlaces mostrar. */
export function accionesDeNavegacion(grupos: GrupoNav[] = GRUPOS_NAV): AccionClave[] {
  return [...new Set([...accionesDelMenu(grupos), ...RUTAS_FUERA_DEL_MENU.flatMap((i) => (i.accion ? [i.accion] : []))])];
}

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

/** Pantalla que se abre al entrar cuando el usuario no tiene ninguna habilitada en el menú (ver `elegirPantallaDeInicio`). */
export const RUTA_SIN_PANTALLAS = "/inicio";

/**
 * A dónde mandar a alguien al entrar (o al cambiar de sucursal): `/reportes` si puede verlo (lo de siempre), y si no la primera
 * pantalla del menú que sí puede abrir. Antes se mandaba siempre a `/reportes`, que ahora exige un permiso: quien no lo tiene
 * habría aterrizado en un mensaje de «no tenés permiso». `menuVisible` es el menú ya filtrado (`filtrarMenuPorPermiso`).
 */
export function elegirPantallaDeInicio(menuVisible: GrupoNav[]): string {
  const items = menuVisible.flatMap((g) => g.items);
  return items.find((i) => i.href === "/reportes")?.href ?? items[0]?.href ?? RUTA_SIN_PANTALLAS;
}
