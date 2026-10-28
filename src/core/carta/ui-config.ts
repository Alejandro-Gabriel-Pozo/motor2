import type { AccionClave } from "@/core/permisos/acciones";
import type { PanelNav } from "@/core/navegacion/panel";
import { MENU_DEL_DIA_VISIBLE } from "./menu-del-dia";

/**
 * Fuente del módulo Carta en el menú y de sus filas de pestañas (Fase 7, DEC-24 del dueño; diseño en `docs/diseno-modulo-carta-2026-10-28.md` §8): TRES entradas, «Carta» (pestañas Hoy · Secciones y
 * géneros · Ítems agrupados), «Promociones» (con el menú del día, solo con su interruptor prendido) y «Apariencia y publicación» (Tema · Portal). Mismo molde que `core/stock/ui-config.ts`: las URL de
 * las pantallas NO cambian (se mudan las entradas, no las pantallas); `estructura.ts` arma con esto el grupo del menú y las rutas de una entrada.
 *
 * Una pestaña puede reunir VARIAS pantallas (por ejemplo «Hoy»: los platos de `/carta` y las opciones agotadas de `/movimientos/opciones-agotadas`): la pestaña lleva a la PRIMERA que el rol puede abrir y
 * queda marcada en cualquiera de ellas. Cada pantalla lleva la clave de «Ver» que pide su página (un test lo comprueba). Quién ve cada pestaña lo decide el servidor con esas claves; este archivo es puro.
 */

/** Una pantalla del módulo: su ruta, cómo se nombra en el buscador, su panel y la clave de «Ver» que pide su página. */
export interface PantallaDeCarta {
  href: string;
  texto: string;
  accion: AccionClave;
  panel: PanelNav;
}

/** Una pestaña: su texto y las pantallas que reúne (la primera es la principal). */
export interface PestanaDeCarta {
  texto: string;
  pantallas: readonly [PantallaDeCarta, ...PantallaDeCarta[]];
}

const RUTA_CARTA = "/carta";
const RUTA_PROMOCIONES = "/carta/parametrizacion/promociones";
/** La entrada «Apariencia y publicación»: una página que redirige a la primera pestaña que el rol puede abrir. */
export const RUTA_APARIENCIA = "/carta/parametrizacion/apariencia";
/** El viejo tablero de «Parametrización» (CARTA-MANT): redirige a «Secciones y géneros». Cuelga de la entrada «Carta». */
export const RUTA_TABLERO_VIEJO = "/carta/parametrizacion";
/** La pestaña «Secciones y géneros» (a donde redirige el tablero viejo). */
export const RUTA_SECCIONES = "/carta/parametrizacion/secciones";

/** Las pestañas de «Carta». La primera pantalla de «Hoy» es la entrada del menú. */
export const PESTANAS_DE_CARTA: readonly PestanaDeCarta[] = [
  {
    texto: "Hoy",
    pantallas: [
      { href: RUTA_CARTA, texto: "Carta · Hoy", accion: "carta_ver", panel: "sucursal" },
      { href: "/movimientos/opciones-agotadas", texto: "Opciones agotadas", accion: "opcion_apagar_en_sucursal", panel: "sucursal" },
    ],
  },
  {
    texto: "Secciones y géneros",
    pantallas: [
      { href: RUTA_SECCIONES, texto: "Secciones de la carta", accion: "carta_ver", panel: "sucursal" },
      { href: "/carta/parametrizacion/generos", texto: "Géneros", accion: "carta_ver", panel: "sucursal" },
    ],
  },
  { texto: "Ítems agrupados", pantallas: [{ href: "/carta/agrupados", texto: "Ítems agrupados", accion: "carta_items_agrupados", panel: "sucursal" }] },
];

const PESTANA_MENU_DEL_DIA: PestanaDeCarta = {
  texto: "Menú del día",
  pantallas: [{ href: "/movimientos/menu-del-dia", texto: "Menú del día", accion: "promo_menu_del_dia", panel: "sucursal" }],
};

/** Las pestañas de «Promociones». «Menú del día» solo existe con el interruptor prendido (`MENU_DEL_DIA_VISIBLE`; apagado, su página responde 404). */
export const PESTANAS_DE_PROMOCIONES: readonly PestanaDeCarta[] = [
  { texto: "Promociones", pantallas: [{ href: RUTA_PROMOCIONES, texto: "Promociones", accion: "carta_ver", panel: "ambos" }] },
  ...(MENU_DEL_DIA_VISIBLE ? [PESTANA_MENU_DEL_DIA] : []),
];

/** Las pestañas de «Apariencia y publicación»: el tema es de la sucursal y el portal, de la empresa. */
export const PESTANAS_DE_APARIENCIA: readonly PestanaDeCarta[] = [
  { texto: "Tema", pantallas: [{ href: "/carta/tema", texto: "Tema de la carta", accion: "carta_tema", panel: "sucursal" }] },
  { texto: "Portal", pantallas: [{ href: "/carta/portal", texto: "Portal de sucursales", accion: "carta_portal", panel: "empresa" }] },
];

/** Las claves de «Ver» de las pantallas de una fila, sin repetir, como lista no vacía (el `algunaDe` de su entrada). */
function clavesDe(pestanas: readonly PestanaDeCarta[]): [AccionClave, ...AccionClave[]] {
  return [...new Set(pestanas.flatMap((p) => p.pantallas.map((x) => x.accion)))] as [AccionClave, ...AccionClave[]];
}

type ClavesDeVer = { accion: AccionClave; algunaDe?: never } | { algunaDe: readonly [AccionClave, ...AccionClave[]]; accion?: never };

/** Un ítem del grupo Carta del menú (mismo molde que `ItemNav` de `core/navegacion/estructura.ts`). */
export type ItemNavDeCarta = { href: string; label: string; panel: PanelNav } & ClavesDeVer;

/**
 * El grupo Carta del menú (DEC-24). «Carta» se ve si el rol puede abrir alguna de sus pestañas (el operario que solo agota opciones la sigue encontrando); «Promociones» con `carta_ver` (la guarda de su
 * página; el menú del día, cuando se prenda, sigue la decisión de su rediseño); «Apariencia y publicación» si ve el tema o el portal (los dos contextos: es de los dos paneles).
 */
export const NAV_CARTA: ItemNavDeCarta[] = [
  { href: RUTA_CARTA, label: "Carta", algunaDe: clavesDe(PESTANAS_DE_CARTA), panel: "sucursal" },
  { href: RUTA_PROMOCIONES, label: "Promociones", accion: "carta_ver", panel: "ambos" },
  { href: RUTA_APARIENCIA, label: "Apariencia y publicación", algunaDe: clavesDe(PESTANAS_DE_APARIENCIA), panel: "ambos" },
];

/** Una ruta que cuelga de una entrada de Carta (para `RUTAS_DE_UNA_ENTRADA` del menú): toda pantalla del módulo que no es la entrada misma. */
export interface RutaDeCarta {
  href: string;
  texto: string;
  accion: AccionClave;
  panel: PanelNav;
  entrada: string;
}

const deLaEntrada = (pestanas: readonly PestanaDeCarta[], entrada: string): RutaDeCarta[] =>
  pestanas.flatMap((p) => p.pantallas.filter((x) => x.href !== entrada).map((x) => ({ href: x.href, texto: x.texto, accion: x.accion, panel: x.panel, entrada })));

/** Las rutas que cuelgan de las tres entradas (sin las entradas): las pestañas y pantallas restantes, más el tablero viejo de «Parametrización» (redirige a Secciones y géneros). */
export const RUTAS_DE_LAS_ENTRADAS_DE_CARTA: readonly RutaDeCarta[] = [
  ...deLaEntrada(PESTANAS_DE_CARTA, RUTA_CARTA),
  { href: RUTA_TABLERO_VIEJO, texto: "Parametrización de la carta", accion: "carta_ver", panel: "sucursal", entrada: RUTA_CARTA },
  ...deLaEntrada(PESTANAS_DE_PROMOCIONES, RUTA_PROMOCIONES),
  ...deLaEntrada(PESTANAS_DE_APARIENCIA, RUTA_APARIENCIA),
];

/** Una pestaña lista para dibujar (`PestanasDeRuta`): a dónde lleva, su texto y si es la de la pantalla abierta. */
export interface PestanaArmada {
  href: string;
  texto: string;
  actual: boolean;
}

/**
 * La fila de pestañas que se le ofrece al rol: cada pestaña lleva a la PRIMERA de sus pantallas que el rol puede ver (`puedeVer`); una pestaña sin ninguna no se dibuja. Se marca la que reúne la ruta abierta
 * (`ruta`, sin consulta). Pura: el servidor calcula `puedeVer` con el mismo cálculo del menú.
 */
export function armarPestanasDeCarta(pestanas: readonly PestanaDeCarta[], puedeVer: ReadonlySet<AccionClave>, ruta: string): PestanaArmada[] {
  return pestanas.flatMap((p) => {
    const primera = p.pantallas.find((x) => puedeVer.has(x.accion));
    if (!primera) return [];
    return [{ href: primera.href, texto: p.texto, actual: p.pantallas.some((x) => x.href === ruta) }];
  });
}

/** La primera pantalla de una fila que el rol puede ver (a donde redirige la entrada si el rol no ve la principal), o `null`. */
export function primeraPantallaVisible(pestanas: readonly PestanaDeCarta[], puedeVer: ReadonlySet<AccionClave>): string | null {
  return armarPestanasDeCarta(pestanas, puedeVer, "")[0]?.href ?? null;
}
