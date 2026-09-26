import type { SelectorCartaPos } from "./selector-carta";

/**
 * Estado de «Agregar al pedido» con el selector por sección de carta (docs/plan-selector-carta-pos-2026-09-25.md, §2.4), por
 * carpeta de género (docs/plan-genero-carta-2026-09-26.md, G3) y la lista «Por agregar» (docs/plan-pos-agregar-varios-2026-09-26.md):
 * un reductor PURO, testeable en Vitest sin DOM (test/pos/selector-carta-estado.test.ts). El componente de cliente solo lo
 * dibuja; el DOM se cubre con Playwright (test/e2e/pos-carta-secciones.spec.ts).
 *
 * Qué NAVEGA (sección a la vista, agrupado/carpeta desplegados) vive ACÁ; qué está EN LA LISTA para agregar vive aparte
 * (`agregar-lista-estado.ts`) — son dos reductores independientes que `AgregarItems` combina, no uno solo.
 *
 * Tocar un producto —en la carta o en el buscador— lo SUMA a la lista (ver `agregar-lista-estado.ts`) y dispara acá
 * `productoSumado`, el mismo efecto que antes disparaba «agregar y limpiar» pero ahora en el momento del toque, no después de un
 * viaje al servidor (la lista es del cliente hasta que se confirma todo junto): vacía el buscador (`limpiarBuscador`) y cierra el
 * agrupado SUELTO desplegado, si había uno.
 *
 * GÉNERO (G3, decisión del dueño): `carpetaAbierta` y `agrupadoAbierto` son, a nivel de la sección, mutuamente excluyentes —
 * abrir una carpeta cierra el agrupado (suelto, sin género) que estuviera abierto, y viceversa. Un ítem agrupado que está DENTRO
 * de una carpeta abierta no tiene su propio disclosure: se muestra siempre desplegado mientras la carpeta esté abierta (así no
 * hay contradicción entre "abrir un agrupado cierra la carpeta" y "un agrupado adentro de la carpeta se puede abrir sin cerrarla"
 * — ver `selector-carta.tsx`). Tras sumar un producto (`productoSumado`), la carpeta abierta QUEDA abierta (para pedir varias
 * cervezas seguidas sin reabrir, G3); el agrupado suelto desplegado sigue cerrándose, como siempre. Cambiar de sección cierra
 * las dos cosas.
 */

/** La sección de «Fuera de carta» (DP2: nunca «Otros», que podría ser el nombre de una sección de carta real). */
export const SECCION_FUERA_DE_CARTA = "fuera-de-carta";

export interface EstadoSelectorCarta {
  /** La sección de carta a la vista (su `seccionCartaId` o `SECCION_FUERA_DE_CARTA`); null = no hay nada que navegar. */
  seccionActiva: string | null;
  /** El ítem agrupado SUELTO (sin género) desplegado (su `itemAgrupadoCartaId`); a lo sumo uno. */
  agrupadoAbierto: string | null;
  /** La carpeta de género desplegada (su `generoCartaId`); a lo sumo una. */
  carpetaAbierta: string | null;
  /** Contador: cada vez que cambia, el buscador por texto se vacía (tras sumar un producto a la lista). */
  limpiarBuscador: number;
}

export type AccionSelectorCarta =
  | { tipo: "elegirSeccion"; seccionId: string }
  | { tipo: "alternarAgrupado"; itemAgrupadoCartaId: string }
  | { tipo: "alternarCarpeta"; generoCartaId: string }
  | { tipo: "productoSumado" };

/** Arranca en la primera sección de carta; si no hay ninguna, en «Fuera de carta» (si tiene algo). */
export function estadoInicialSelectorCarta(selector: SelectorCartaPos | null): EstadoSelectorCarta {
  const primera = selector?.seccionesCarta[0]?.seccionCartaId ?? (selector && selector.fueraDeCarta.length > 0 ? SECCION_FUERA_DE_CARTA : null);
  return { seccionActiva: primera, agrupadoAbierto: null, carpetaAbierta: null, limpiarBuscador: 0 };
}

export function reducirSelectorCarta(estado: EstadoSelectorCarta, accion: AccionSelectorCarta): EstadoSelectorCarta {
  switch (accion.tipo) {
    case "elegirSeccion":
      // Cambiar de sección cierra el agrupado y la carpeta desplegados.
      return { ...estado, seccionActiva: accion.seccionId, agrupadoAbierto: null, carpetaAbierta: null };
    case "alternarAgrupado":
      // Abrir uno cierra el anterior; volver a tocar el abierto lo cierra. Abrir un agrupado suelto cierra la carpeta abierta.
      return { ...estado, agrupadoAbierto: estado.agrupadoAbierto === accion.itemAgrupadoCartaId ? null : accion.itemAgrupadoCartaId, carpetaAbierta: null };
    case "alternarCarpeta":
      // Misma regla que un agrupado: abrir una cierra la anterior, y cierra el agrupado suelto que estuviera abierto.
      return { ...estado, carpetaAbierta: estado.carpetaAbierta === accion.generoCartaId ? null : accion.generoCartaId, agrupadoAbierto: null };
    case "productoSumado":
      // G3: la carpeta abierta queda abierta (pedir varias cervezas seguidas sin reabrir). El agrupado suelto se cierra, como
      // siempre. Se queda en la sección activa: el mozo suele pedir varias cosas de la misma sección seguidas.
      return { ...estado, agrupadoAbierto: null, limpiarBuscador: estado.limpiarBuscador + 1 };
  }
}
