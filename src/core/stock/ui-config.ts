import type { AccionClave } from "@/core/permisos/acciones";
import type { PanelNav } from "@/core/navegacion/panel";

/**
 * Fuente del módulo Stock en el menú y de sus filas de pestañas (Fase 7, DEC-27 del dueño; diseño en `docs/diseno-modulo-stock-2026-10-27.md` §8): DOS entradas, «Existencias» (pestañas Consolidado · Por
 * familia · Alertas) y «Configuración» (pestañas Parámetros por insumo · Depósitos · Motivos de merma · Destinos de consumo, más los editores de cada parámetro, que se abren desde la tabla). Mismo molde que
 * `core/movimientos/ui-config.ts`: las URL de las pantallas NO cambian (se mudan las entradas, no las pantallas); `estructura.ts` arma con esto el grupo del menú y las rutas de una entrada.
 *
 * Cada pantalla lleva la clave de «Ver» que pide su página (`accion`), o la lista de la que alcanza con una (`algunaDe`, solo la entrada «Configuración» y su pestaña «Parámetros por insumo»): un test
 * comprueba que coincidan con la guarda de cada página. Quién ve cada pestaña lo decide el servidor con esas claves; este archivo es puro.
 */
type ClavesDeVer = { accion: AccionClave; algunaDe?: never } | { algunaDe: readonly [AccionClave, ...AccionClave[]]; accion?: never };

/** Una pantalla del módulo: su ruta, cómo se nombra (pestaña o buscador), su panel y la clave de «Ver» que la protege. */
export type PantallaDeStock = { href: string; texto: string; panel: PanelNav } & ClavesDeVer;

/** Las claves de los tres parámetros por insumo de la sucursal: la pestaña «Parámetros por insumo» se ve con el «Ver» de alguna (cada columna, con el suyo). */
export const CLAVES_DE_PARAMETROS = ["stock_minimo", "stock_seccion_habitual", "conteo_frecuencia"] as const satisfies readonly AccionClave[];

const RUTA_EXISTENCIAS = "/stock/consolidado";
export const RUTA_CONFIGURACION = "/stock/configuracion";

/** Las pestañas de «Existencias»: las tres se ven con `ver_stock`. La primera es la entrada del menú. */
export const PESTANAS_DE_EXISTENCIAS: readonly PantallaDeStock[] = [
  { href: RUTA_EXISTENCIAS, texto: "Consolidado", accion: "ver_stock", panel: "sucursal" },
  { href: "/stock/por-familia", texto: "Por familia", accion: "ver_stock", panel: "sucursal" },
  { href: "/stock/alertas", texto: "Alertas", accion: "ver_stock", panel: "sucursal" },
];

/** Las pestañas de «Configuración». La primera («Parámetros por insumo») es la entrada del menú. Motivos y destinos son catálogos de la EMPRESA (panel Empresa). */
export const PESTANAS_DE_CONFIGURACION: readonly PantallaDeStock[] = [
  { href: RUTA_CONFIGURACION, texto: "Parámetros por insumo", algunaDe: CLAVES_DE_PARAMETROS, panel: "sucursal" },
  { href: "/movimientos/secciones", texto: "Depósitos", accion: "secciones", panel: "sucursal" },
  { href: "/movimientos/motivos-merma", texto: "Motivos de merma", accion: "motivos_merma", panel: "empresa" },
  { href: "/movimientos/destinos-consumo", texto: "Destinos de consumo", accion: "motivos_destino_consumo", panel: "empresa" },
];

/** Los editores de cada parámetro: no son pestañas (se abren desde «Parámetros por insumo», que queda marcada mientras tanto), pero cuelgan de la entrada «Configuración». */
export const EDITORES_DE_PARAMETROS: readonly (PantallaDeStock & { accion: (typeof CLAVES_DE_PARAMETROS)[number] })[] = [
  { href: "/stock/minimo", texto: "Stock mínimo", accion: "stock_minimo", panel: "sucursal" },
  { href: "/stock/seccion-habitual", texto: "Depósito habitual", accion: "stock_seccion_habitual", panel: "sucursal" },
  { href: "/stock/conteo-frecuencia", texto: "Frecuencia de conteo", accion: "conteo_frecuencia", panel: "sucursal" },
];

/** Todas las claves de «Ver» de las pestañas de Configuración, como lista no vacía: el `algunaDe` de la entrada (la página `/stock/configuracion` usa las mismas, un test lo comprueba). */
const CLAVES_DE_CONFIGURACION = [...new Set(PESTANAS_DE_CONFIGURACION.flatMap((p) => (p.algunaDe ? [...p.algunaDe] : [p.accion])))] as [AccionClave, ...AccionClave[]];

/** Un ítem del grupo Stock del menú (mismo molde que `ItemNav` de `core/navegacion/estructura.ts`). */
export type ItemNavDeStock = { href: string; label: string; panel: PanelNav } & ClavesDeVer;

/**
 * El grupo Stock del menú (DEC-27): «Existencias» (la vista del stock: `ver_stock`) y «Configuración» (visible si el rol puede ver alguna de sus pestañas; tiene pestañas de los dos contextos, por eso es de
 * los dos paneles).
 */
export const NAV_STOCK: ItemNavDeStock[] = [
  { href: RUTA_EXISTENCIAS, label: "Existencias", accion: "ver_stock", panel: "sucursal" },
  { href: RUTA_CONFIGURACION, label: "Configuración", algunaDe: CLAVES_DE_CONFIGURACION, panel: "ambos" },
];

/** Una ruta que cuelga de una entrada de Stock (para `RUTAS_DE_UNA_ENTRADA` del menú): toda pantalla del módulo que no es la entrada misma, con UNA clave de «Ver». */
export interface RutaDeStock {
  href: string;
  texto: string;
  accion: AccionClave;
  panel: PanelNav;
  entrada: string;
}

/** La ruta como `RutaDeStock`, si tiene UNA clave de «Ver» (las listas `algunaDe` son solo de las entradas: una ruta con lista falla al importar). */
function comoRuta(p: PantallaDeStock, entrada: string): RutaDeStock {
  if (!p.accion) throw new Error(`RUTAS_DE_LAS_ENTRADAS_DE_STOCK: "${p.href}" no tiene una clave de «Ver» propia.`);
  return { href: p.href, texto: p.texto, accion: p.accion, panel: p.panel, entrada };
}

/** Las rutas que cuelgan de «Existencias» y de «Configuración» (sin las entradas): las pestañas restantes y los editores de parámetros. */
export const RUTAS_DE_LAS_ENTRADAS_DE_STOCK: readonly RutaDeStock[] = [
  ...PESTANAS_DE_EXISTENCIAS.filter((p) => p.href !== RUTA_EXISTENCIAS).map((p) => comoRuta(p, RUTA_EXISTENCIAS)),
  ...[...PESTANAS_DE_CONFIGURACION.filter((p) => p.href !== RUTA_CONFIGURACION), ...EDITORES_DE_PARAMETROS].map((p) => comoRuta(p, RUTA_CONFIGURACION)),
];

/**
 * Qué pestaña marcar en una fila de pestañas de Stock: la de la ruta abierta; en un editor de parámetros, «Parámetros por insumo» (de ahí se abre), si la fila la tiene. `null` si la ruta no es de esa fila.
 */
export function pestanaActualDeStock(pestanas: readonly Pick<PantallaDeStock, "href">[], ruta: string): string | null {
  if (pestanas.some((p) => p.href === ruta)) return ruta;
  if (EDITORES_DE_PARAMETROS.some((e) => e.href === ruta) && pestanas.some((p) => p.href === RUTA_CONFIGURACION)) return RUTA_CONFIGURACION;
  return null;
}
