import type { AccionClave } from "@/core/permisos/acciones";
import type { PanelNav } from "@/core/navegacion/panel";

/**
 * Fuente del módulo Catálogo en el menú y de sus filas de pestañas (Fase 7, DEC-13 del dueño; diseño en `docs/diseno-modulo-catalogo-2026-10-28.md` §8): CINCO entradas, «Productos» (pestañas Productos ·
 * Precio local · Recetas), «Biblioteca de opciones», «Maestros» (pestañas Insumos · Categorías · Unidades · Margen objetivo), «Proveedores» y «Clientes con descuento». Mismo molde que
 * `core/stock/ui-config.ts`: las URL de las pantallas NO cambian (se mudan las entradas, no las pantallas); `estructura.ts` arma con esto el grupo del menú y las rutas de una entrada.
 *
 * Cada pantalla lleva la clave de «Ver» que pide su página (`accion`), o la lista de la que alcanza con una (`algunaDe`, solo la entrada «Maestros»): un test comprueba que coincidan con la guarda de cada
 * página. Quién ve cada pestaña lo decide el servidor con esas claves; este archivo es puro.
 */
type ClavesDeVer = { accion: AccionClave; algunaDe?: never } | { algunaDe: readonly [AccionClave, ...AccionClave[]]; accion?: never };

/** Una pantalla del módulo: su ruta, cómo se nombra (pestaña o buscador), su panel y la clave de «Ver» que la protege. */
export type PantallaDeCatalogo = { href: string; texto: string; panel: PanelNav } & ClavesDeVer;

export const RUTA_PRODUCTOS = "/catalogo/productos";
export const RUTA_MAESTROS = "/catalogo/insumos-grupos";

/**
 * Las pestañas de «Productos». La primera es la entrada del menú (la lista, con la clave de siempre: los enlaces al espacio de cada producto conservan su clave exacta, P-1 del diseño). «Precio local» es el
 * precio de venta propio de la sucursal ACTIVA (antes en Movimientos; la URL no cambia). «Recetas» es la lista de recetas armadas (el editor es el paso 3 del espacio del producto).
 */
export const PESTANAS_DE_PRODUCTOS: readonly PantallaDeCatalogo[] = [
  { href: RUTA_PRODUCTOS, texto: "Productos", accion: "producto_ver_catalogo", panel: "ambos" },
  { href: "/movimientos/precio-local", texto: "Precio local", accion: "precio_local", panel: "sucursal" },
  { href: "/catalogo/recetas", texto: "Recetas", accion: "guardar_receta", panel: "empresa" },
];

/** Las pestañas de «Maestros»: las tablas de base de la empresa. La primera («Insumos») es la entrada del menú. */
export const PESTANAS_DE_MAESTROS: readonly PantallaDeCatalogo[] = [
  { href: RUTA_MAESTROS, texto: "Insumos", accion: "grupos_familia", panel: "empresa" },
  { href: "/catalogo/categorias", texto: "Categorías", accion: "categorias", panel: "empresa" },
  { href: "/catalogo/unidades", texto: "Unidades", accion: "unidades", panel: "empresa" },
  { href: "/catalogo/margen-objetivo", texto: "Margen objetivo", accion: "margen_objetivo_editar", panel: "empresa" },
];

/** Las claves de «Ver» de las pestañas de Maestros, como lista no vacía: el `algunaDe` de la entrada (la página de la entrada usa las mismas, un test lo comprueba). */
const CLAVES_DE_MAESTROS = PESTANAS_DE_MAESTROS.map((p) => p.accion as AccionClave) as [AccionClave, ...AccionClave[]];

/** Un ítem del grupo Catálogo del menú (mismo molde que `ItemNav` de `core/navegacion/estructura.ts`). */
export type ItemNavDeCatalogo = { href: string; label: string; panel: PanelNav } & ClavesDeVer;

/**
 * El grupo Catálogo del menú (DEC-13). «Productos» es de los dos paneles (el catálogo es de la empresa, pero cada sucursal mira lo suyo); «Maestros» se ve si el rol puede ver alguna de sus pestañas.
 */
export const NAV_CATALOGO: ItemNavDeCatalogo[] = [
  { href: RUTA_PRODUCTOS, label: "Productos", accion: "producto_ver_catalogo", panel: "ambos" },
  // GO-2d (ADR-030): los grupos de opciones de venta (tamaños, variantes, incluidas y adicionales), reutilizables entre productos.
  { href: "/catalogo/opciones", label: "Biblioteca de opciones", accion: "opciones_definir", panel: "empresa" },
  { href: RUTA_MAESTROS, label: "Maestros", algunaDe: CLAVES_DE_MAESTROS, panel: "empresa" },
  { href: "/catalogo/proveedores", label: "Proveedores", accion: "proveedores", panel: "empresa" },
  { href: "/catalogo/clientes", label: "Clientes con descuento", accion: "clientes", panel: "empresa" },
];

/** Una ruta que cuelga de una entrada de Catálogo (para `RUTAS_DE_UNA_ENTRADA` del menú): toda pestaña que no es la entrada misma, con UNA clave de «Ver». */
export interface RutaDeCatalogo {
  href: string;
  texto: string;
  accion: AccionClave;
  panel: PanelNav;
  entrada: string;
}

/** La ruta como `RutaDeCatalogo`, si tiene UNA clave de «Ver» (las listas `algunaDe` son solo de las entradas: una ruta con lista falla al importar). */
function comoRuta(p: PantallaDeCatalogo, entrada: string): RutaDeCatalogo {
  if (!p.accion) throw new Error(`RUTAS_DE_LAS_ENTRADAS_DE_CATALOGO: "${p.href}" no tiene una clave de «Ver» propia.`);
  return { href: p.href, texto: p.texto, accion: p.accion, panel: p.panel, entrada };
}

/** Las rutas que cuelgan de «Productos» y de «Maestros» (sin las entradas): las pestañas restantes. */
export const RUTAS_DE_LAS_ENTRADAS_DE_CATALOGO: readonly RutaDeCatalogo[] = [
  ...PESTANAS_DE_PRODUCTOS.filter((p) => p.href !== RUTA_PRODUCTOS).map((p) => comoRuta(p, RUTA_PRODUCTOS)),
  ...PESTANAS_DE_MAESTROS.filter((p) => p.href !== RUTA_MAESTROS).map((p) => comoRuta(p, RUTA_MAESTROS)),
];
