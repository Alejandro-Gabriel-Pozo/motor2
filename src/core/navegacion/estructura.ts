import { NAV_MOVIMIENTOS } from "@/core/movimientos/public";
import type { AccionClave } from "@/core/permisos/acciones";
import type { PanelActivo, PanelNav } from "./panel";

export interface ItemNav {
  href: string;
  label: string;
  /** El ítem solo se muestra a quien puede VER esa acción (la misma que protege la página; un test lo comprueba para todos los ítems). */
  accion?: AccionClave;
  /** En qué panel del menú aparece (ADR-010). Se declara en CADA ítem a propósito: un ítem nuevo sin panel no compila. */
  panel: PanelNav;
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
      { href: "/administracion/usuarios", label: "Usuarios", accion: "gestion_usuarios", panel: "sucursal" },
      { href: "/administracion/roles", label: "Roles", accion: "gestion_roles", panel: "empresa" },
      { href: "/administracion/permisos", label: "Permisos", accion: "gestion_permisos", panel: "empresa" },
      { href: "/administracion/capacidades-sucursal", label: "Capacidades por sucursal", accion: "capacidades_sucursal", panel: "empresa" },
      { href: "/administracion/sucursales", label: "Sucursales", accion: "alta_sucursal", panel: "empresa" },
      { href: "/administracion/auditoria", label: "Auditoría", accion: "ver_auditoria", panel: "sucursal" },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    items: [
      { href: "/catalogo/productos", label: "Productos", accion: "producto_ver_catalogo", panel: "ambos" },
      { href: "/catalogo/proveedores", label: "Proveedores", accion: "proveedores", panel: "empresa" },
      { href: "/catalogo/clientes", label: "Clientes con descuento", accion: "clientes", panel: "empresa" },
      { href: "/catalogo/recetas", label: "Recetas", accion: "guardar_receta", panel: "empresa" },
      { href: "/catalogo/insumos-grupos", label: "Insumos / Grupos", accion: "grupos_familia", panel: "empresa" },
      { href: "/catalogo/categorias", label: "Categorías", accion: "categorias", panel: "empresa" },
      { href: "/catalogo/unidades", label: "Unidades", accion: "unidades", panel: "empresa" },
    ],
  },
  {
    // Módulo propio (ADR-006, docs/adr/ADR-006-carta-como-modulo-interno.md): antes anidado bajo Catálogo sin motivo claro,
    // aunque ya tenía su propio permiso (`carta_*`, distinto del de catálogo).
    id: "carta",
    label: "Carta",
    items: [
      { href: "/carta", label: "Carta pública", accion: "carta_ver", panel: "sucursal" },
      { href: "/carta/agrupados", label: "Ítems agrupados de la carta", accion: "carta_items_agrupados", panel: "empresa" },
      { href: "/carta/portal", label: "Portal de sucursales", accion: "carta_portal", panel: "empresa" },
      { href: "/carta/tema", label: "Tema de la carta", accion: "carta_tema", panel: "sucursal" },
    ],
  },
  {
    id: "movimientos",
    label: "Movimientos",
    items: NAV_MOVIMIENTOS,
  },
  {
    id: "stock",
    label: "Stock",
    items: [
      { href: "/stock/consolidado", label: "Consolidado", accion: "ver_stock", panel: "sucursal" },
      { href: "/stock/por-familia", label: "Por familia", accion: "ver_stock", panel: "sucursal" },
      { href: "/stock/alertas", label: "Alertas", accion: "ver_stock", panel: "sucursal" },
      { href: "/stock/minimo", label: "Stock mínimo", accion: "stock_minimo", panel: "sucursal" },
      { href: "/stock/seccion-habitual", label: "Sección habitual", accion: "stock_seccion_habitual", panel: "sucursal" },
      { href: "/stock/reclasificar", label: "Reclasificar", accion: "stock_reclasificar", panel: "sucursal" },
      { href: "/stock/conteo-frecuencia", label: "Frecuencia de conteo", accion: "conteo_frecuencia", panel: "sucursal" },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    items: [
      // Cada reporte se protege con la acción de «Ver» que lleva `accion` (la página usa la misma clave; un test lo comprueba).
      // Grupos: dinero (ventas, costos, márgenes, valuación), control (pérdidas, devoluciones, diferencias), operativos,
      // catálogo; y los que ya tenían acción propia (promociones, consignación, conteos, huecos de catálogo).
      { href: "/reportes", label: "Resumen", accion: "reporte_resumen", panel: "sucursal" },
      { href: "/reportes/consolidado", label: "Consolidado (mis sucursales)", accion: "reporte_consolidado", panel: "sucursal" },
      { href: "/reportes/periodo", label: "Período", accion: "reporte_periodo", panel: "sucursal" },
      { href: "/reportes/categorias", label: "Por categoría", accion: "reporte_categorias", panel: "sucursal" },
      { href: "/reportes/ventas-por-seccion", label: "Por sección de carta", accion: "reporte_ventas_por_seccion", panel: "sucursal" },
      { href: "/reportes/costos", label: "Costos y márgenes", accion: "reporte_costos", panel: "sucursal" },
      { href: "/reportes/compras", label: "Compras registradas", accion: "reporte_compras", panel: "sucursal" },
      { href: "/reportes/rendimiento-recetas", label: "Rendimiento real de recetas", accion: "reporte_rendimiento_recetas", panel: "sucursal" },
      { href: "/reportes/rendimiento-recetas/por-sucursal", label: "Rendimiento por sucursal", accion: "reporte_rendimiento_sucursal", panel: "sucursal" },
      { href: "/reportes/valuacion", label: "Valuación de inventario", accion: "reporte_valuacion", panel: "sucursal" },
      { href: "/reportes/perdidas", label: "Pérdidas", accion: "reporte_perdidas", panel: "sucursal" },
      { href: "/reportes/devoluciones", label: "Devoluciones", accion: "reporte_devoluciones", panel: "sucursal" },
      { href: "/reportes/vencimientos", label: "Vencimientos", accion: "reporte_vencimientos", panel: "sucursal" },
      { href: "/reportes/diferencias", label: "Diferencias de ajuste", accion: "reporte_diferencias", panel: "sucursal" },
      { href: "/reportes/sin-receta", label: "Ventas sin receta", accion: "reporte_sin_receta", panel: "sucursal" },
      { href: "/reportes/insumos-sin-receta", label: "Insumos sin receta", accion: "reporte_insumos_sin_receta", panel: "sucursal" },
      { href: "/reportes/consignacion", label: "Consignación", accion: "pagar_consignante", panel: "sucursal" },
      { href: "/reportes/salud", label: "Salud por producto", accion: "reporte_salud", panel: "sucursal" },
      { href: "/reportes/huecos-catalogo", label: "Huecos de catálogo", accion: "reporte_huecos_catalogo", panel: "empresa" },
      { href: "/reportes/conteos", label: "Conteos físicos", accion: "reporte_conteos", panel: "sucursal" },
      { href: "/reportes/historial", label: "Historial de un producto", accion: "reporte_historial", panel: "sucursal" },
      { href: "/reportes/trazabilidad", label: "Trazabilidad por ID", accion: "reporte_trazabilidad", panel: "sucursal" },
      { href: "/reportes/rotacion-mesas", label: "Rotación de mesas", accion: "reporte_rotacion_mesas", panel: "sucursal" },
      { href: "/reportes/boletas", label: "Boletas emitidas", accion: "reporte_boletas", panel: "sucursal" },
      { href: "/reportes/descuentos-clientes", label: "Descuentos por cliente", accion: "reporte_descuentos_clientes", panel: "sucursal" },
      { href: "/reportes/descuentos-productos", label: "Descuentos de productos", accion: "reporte_descuentos_productos", panel: "sucursal" },
      { href: "/reportes/margen-promociones", label: "Margen de promociones", accion: "reporte_margen_promociones", panel: "sucursal" },
    ],
  },
  {
    id: "traspasos",
    label: "Traspasos",
    items: [
      { href: "/traspasos", label: "Bandeja", accion: "traspaso_ver_bandeja", panel: "sucursal" },
      { href: "/traspasos/solicitar", label: "Solicitar (a otra sucursal)", accion: "traspaso_solicitar", panel: "sucursal" },
      { href: "/traspasos/enviar", label: "Enviar directo", accion: "traspaso_enviar_directo", panel: "sucursal" },
    ],
  },
  {
    // Módulo POS (docs/plan-mapa-de-mesas-2026-09-24.md): la pantalla vive en el route group `(pos)`, con su propio shell y sin
    // este menú. A quien solo tiene salón (el rol «mozo» armado desde la matriz) la
    // pantalla de inicio lo manda directo a /mesas (`elegirPantallaDeInicio`); el resto lo ve como una tarjeta más de `/inicio`.
    id: "pos",
    label: "Salón",
    items: [{ href: "/mesas", label: "Mapa de mesas", accion: "pos_mesas", panel: "sucursal" }],
  },
];

/**
 * Pantallas a las que se llega con un enlace desde otra pantalla pero que no tienen ítem en el menú, con la acción de «Ver» que las
 * protege (la misma que pide su página; un test lo comprueba). Las rutas hijas de un ítem del menú (`/catalogo/recetas/[id]`,
 * `/catalogo/recetas/[id]/historial`, `/movimientos/compra?…`) no van acá: `accionDeRuta` las resuelve por el ítem del que cuelgan.
 */
export const RUTAS_FUERA_DEL_MENU: ItemNav[] = [
  { href: "/catalogo/proveedores/comparativa", label: "Comparativa de precios", accion: "comparar_precios", panel: "empresa" },
  { href: "/catalogo/productos/nuevo", label: "Nuevo producto", accion: "alta_producto", panel: "ambos" },
];

/**
 * La acción de «Ver» que protege la pantalla a la que apunta un enlace interno, o `null` si no se conoce (la raíz, una ruta
 * desconocida). Se resuelve por el ítem del menú (o de `RUTAS_FUERA_DEL_MENU`) cuya ruta es la más larga que es prefijo de la del
 * enlace: la consulta (`?…`) y el ancla (`#…`) se ignoran. Es lo que permite mostrar un enlace solo a quien puede abrir su destino.
 */
export function accionDeRuta(href: string, grupos: GrupoNav[] = GRUPOS_NAV): AccionClave | null {
  return itemDeRuta(href, grupos)?.accion ?? null;
}

/** El ítem (con acción) del que cuelga la ruta: el de la ruta más larga que es prefijo de la de `href`. Ver `accionDeRuta`. */
export function itemDeRuta(href: string, grupos: GrupoNav[] = GRUPOS_NAV): (ItemNav & { accion: AccionClave }) | null {
  const ruta = href.split(/[?#]/)[0].replace(/\/+$/, "");
  const candidatos = [...grupos.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU].filter(
    (i): i is ItemNav & { accion: AccionClave } => !!i.accion && (ruta === i.href || ruta.startsWith(`${i.href}/`))
  );
  candidatos.sort((a, b) => b.href.length - a.href.length);
  return candidatos[0] ?? null;
}

/** Las rutas de todos los ítems del menú completo, sin filtrar por permiso (no son datos sensibles: son las rutas de la aplicación). */
export function hrefsDelMenu(grupos: GrupoNav[] = GRUPOS_NAV): string[] {
  return grupos.flatMap((g) => g.items.map((i) => i.href));
}

/**
 * El ítem del menú que corresponde a la pantalla abierta: UNO solo, el de la ruta más larga que es prefijo de `pathname` (así
 * `/carta/tema` es «Tema de la carta» y no también «Carta pública», y una pantalla hija como `/catalogo/recetas/[id]/historial`
 * resalta «Recetas»). Se busca entre los ítems del menú COMPLETO y recién después se mira si el usuario lo ve: si gana uno que no ve,
 * no se resalta ninguno (en vez de resaltar un ítem más corto que no es esta pantalla). La consulta (`?…`) y el ancla (`#…`) se ignoran.
 */
export function hrefActivoDelMenu(pathname: string, hrefsDelMenuCompleto: readonly string[], hrefsVisibles: ReadonlySet<string>): string | null {
  const ruta = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  let mejor: string | null = null;
  for (const href of hrefsDelMenuCompleto) {
    if ((ruta === href || ruta.startsWith(`${href}/`)) && (mejor === null || href.length > mejor.length)) mejor = href;
  }
  return mejor !== null && hrefsVisibles.has(mejor) ? mejor : null;
}

/**
 * El panel al que pertenece la pantalla abierta, o `null` si no se puede decir (es una pantalla de ambos paneles —`/catalogo/productos`—,
 * el inicio, o una ruta que no es del menú): en ese caso el menú se queda en el último panel que eligió la persona. Usa la MISMA
 * coincidencia que el ítem activo (`hrefActivoDelMenu`: la ruta más larga que es prefijo), sobre el menú completo y las pantallas fuera
 * del menú (`/catalogo/proveedores/comparativa` es de Empresa como Proveedores), sin mirar permisos.
 */
export function panelDeRuta(pathname: string, grupos: GrupoNav[] = GRUPOS_NAV): PanelActivo | null {
  const items = [...grupos.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU];
  const hrefs = items.map((i) => i.href);
  const href = hrefActivoDelMenu(pathname, hrefs, new Set(hrefs));
  const panel = items.find((i) => i.href === href)?.panel;
  return panel === "empresa" || panel === "sucursal" ? panel : null;
}

/** El menú partido en sus dos paneles: un ítem `ambos` está en los dos; un grupo que se queda sin ítems en un panel no aparece en él. */
export function particionarMenu(grupos: GrupoNav[]): Record<PanelActivo, GrupoNav[]> {
  const de = (panel: PanelActivo) =>
    grupos.map((g) => ({ ...g, items: g.items.filter((i) => i.panel === panel || i.panel === "ambos") })).filter((g) => g.items.length > 0);
  return { empresa: de("empresa"), sucursal: de("sucursal") };
}

/**
 * Si el menú de este usuario se muestra en dos paneles: solo cuando ve al menos una pantalla EXCLUSIVA de Empresa (si no, no hay nada que
 * separar y el menú es uno solo, como antes) y el panel Sucursal no queda vacío (con un menú de pura Empresa, el selector sería un botón
 * que lleva a la nada). `grupos` es el menú ya filtrado por permiso.
 */
export function mostrarSelectorDePaneles(grupos: GrupoNav[]): boolean {
  return grupos.some((g) => g.items.some((i) => i.panel === "empresa")) && particionarMenu(grupos).sucursal.length > 0;
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

/** La pantalla de inicio: el panel con una tarjeta por módulo que el usuario puede abrir (ver `elegirPantallaDeInicio`). */
export const RUTA_INICIO = "/inicio";

/**
 * A dónde mandar a alguien al entrar (o al cambiar de sucursal): al panel `/inicio`, salvo quien solo tiene el salón (el rol «mozo»
 * armado desde la matriz), que va directo al mapa de mesas porque para esa persona no hay nada más que elegir. Quien tiene un solo
 * módulo que no es el salón también pasa por `/inicio` (con una sola tarjeta). `menuVisible` es el menú ya filtrado
 * (`filtrarMenuPorPermiso`).
 */
export function elegirPantallaDeInicio(menuVisible: GrupoNav[]): string {
  if (menuVisible.length === 1 && menuVisible[0].id === "pos") return menuVisible[0].items[0].href;
  return RUTA_INICIO;
}
