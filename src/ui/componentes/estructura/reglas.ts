/**
 * Reglas de la ESTRUCTURA DE PANTALLA del sistema (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, etapa E-A).
 *
 * Es la FUENTE de los números que usan las piezas de esta carpeta, el oráculo de combinaciones (`test/ui/estructura-de-pantalla.oraculo.ts`) y el guardián: los puntos de corte
 * son los de Tailwind (el proyecto no redefine ninguno) y se nombran acá UNA vez. Funciones puras, sin DOM: el test las recorre contra la tabla escrita aparte.
 *
 * Mobile first: los estilos base son los del celular (390 px) y las mejoras entran con `min-width` (`md:`, `xl:`). Debajo de `md` se desplaza el DOCUMENTO (como siempre);
 * desde `md` el shell ocupa la ventana y se desplaza solo el área de contenido.
 */
export const PUNTOS_DE_CORTE = { md: 768, xl: 1280 } as const;

/** Ancho del menú lateral abierto (`w-56`) y colapsado (la lengüeta de `SidebarColapsable`, `w-5`), en px. */
export const ANCHO_DEL_MENU = { abierto: 224 + 20, colapsado: 20 } as const;

/** Ancho máximo del contenido (80 rem = 1280 px): lo que pide el diseño para 1366 y pantallas anchas. */
const ANCHO_MAXIMO_DEL_CONTENIDO = 1280;

/** Relleno del contenido en px: 16 en celular, 24 desde `md`. */
const RELLENO_DEL_CONTENIDO = { celular: 16, escritorio: 24 } as const;

export type EstadoDelMenu = "abierto" | "colapsado";

/** ¿Quién se desplaza? Debajo de `md` el documento; desde `md` el área de contenido (el encabezado y el menú quedan fijos). */
export function dondeSeDesplaza(anchoDeVentana: number): "documento" | "contenido" {
  return anchoDeVentana >= PUNTOS_DE_CORTE.md ? "contenido" : "documento";
}

/** Columnas de `RejillaDeSecciones`: 2 desde `xl`. NO depende del menú (la pantalla no «salta» al plegarlo). */
export function columnasDeLaRejilla(anchoDeVentana: number): 1 | 2 {
  return anchoDeVentana >= PUNTOS_DE_CORTE.xl ? 2 : 1;
}

export function rellenoDelContenido(anchoDeVentana: number): number {
  return anchoDeVentana >= PUNTOS_DE_CORTE.md ? RELLENO_DEL_CONTENIDO.escritorio : RELLENO_DEL_CONTENIDO.celular;
}

/** ¿El encabezado del shell se queda fijo al desplazar? Sí desde `md` (porque lo que se desplaza es el contenido); en celular se va con el documento. */
export function encabezadoFijo(anchoDeVentana: number): boolean {
  return dondeSeDesplaza(anchoDeVentana) === "contenido";
}

/** Ancho útil del contenido: ventana − menú (solo desde `md`; en celular el menú es un cajón) − relleno, con el tope de ancho máximo. */
export function anchoDelContenido(anchoDeVentana: number, menu: EstadoDelMenu): number {
  const sinMenu = anchoDeVentana >= PUNTOS_DE_CORTE.md ? anchoDeVentana - ANCHO_DEL_MENU[menu] : anchoDeVentana;
  return Math.min(ANCHO_MAXIMO_DEL_CONTENIDO, sinMenu - 2 * rellenoDelContenido(anchoDeVentana));
}
