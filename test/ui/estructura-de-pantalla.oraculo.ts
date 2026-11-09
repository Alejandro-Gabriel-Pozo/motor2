/**
 * ORÁCULO de la estructura de pantalla (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, §7): la tabla de reglas esperadas, escrita APARTE del código. Cada fila
 * dice, para un ancho de ventana y el estado del menú, qué tiene que pasar. `estructura-de-pantalla.test.tsx` recorre TODAS las combinaciones contra
 * `src/ui/componentes/estructura/reglas.ts`; `test/e2e/estructura-de-pantalla.spec.ts` las comprueba en el navegador real. Si se cambia una regla del diseño, se cambia ACÁ primero.
 *
 * Dimensiones: ancho de ventana × menú (abierto/colapsado; en celular no hay lateral) × la pantalla usa barra de acciones/encabezado fijo (no cambia dónde se desplaza: se verifica
 * que no lo cambie) × contenido más alto o más bajo que la ventana (solo decide si HAY barra de scroll, no quién se desplaza).
 */
export interface FilaDelOraculo {
  ancho: number;
  menu: "abierto" | "colapsado" | "sin-lateral";
  seDesplaza: "documento" | "contenido";
  encabezadoDelShellFijo: boolean;
  columnasDeLaRejilla: 1 | 2;
  rellenoPx: number;
  /** Ancho útil del contenido, ya con el tope de 1280. */
  anchoDelContenidoPx: number;
}

export const ORACULO: readonly FilaDelOraculo[] = [
  { ancho: 390, menu: "sin-lateral", seDesplaza: "documento", encabezadoDelShellFijo: false, columnasDeLaRejilla: 1, rellenoPx: 16, anchoDelContenidoPx: 358 },
  { ancho: 767, menu: "sin-lateral", seDesplaza: "documento", encabezadoDelShellFijo: false, columnasDeLaRejilla: 1, rellenoPx: 16, anchoDelContenidoPx: 735 },
  { ancho: 768, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 1, rellenoPx: 24, anchoDelContenidoPx: 476 },
  { ancho: 768, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 1, rellenoPx: 24, anchoDelContenidoPx: 700 },
  { ancho: 1093, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 1, rellenoPx: 24, anchoDelContenidoPx: 801 }, // 1366 al 125 % de zoom
  { ancho: 1279, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 1, rellenoPx: 24, anchoDelContenidoPx: 1211 },
  { ancho: 1280, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 988 },
  { ancho: 1280, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1212 },
  { ancho: 1366, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1074 },
  { ancho: 1366, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1280 },
  { ancho: 1440, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1148 },
  { ancho: 1440, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1280 },
  { ancho: 1920, menu: "abierto", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1280 },
  { ancho: 1920, menu: "colapsado", seDesplaza: "contenido", encabezadoDelShellFijo: true, columnasDeLaRejilla: 2, rellenoPx: 24, anchoDelContenidoPx: 1280 },
];

/** Las dimensiones de la regla de combinaciones: la lista de lo declarado (un guardián compara con las clases de las piezas). */
export const PUNTOS_DE_CORTE_DECLARADOS = ["md", "xl"] as const;
