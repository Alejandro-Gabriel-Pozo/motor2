import type { SelectorCartaPos } from "./selector-carta";

/**
 * Estado de «Agregar al pedido» con el selector por sección de carta (docs/plan-selector-carta-pos-2026-09-25.md, §2.4): un
 * reductor PURO, testeable en Vitest sin DOM (test/pos/selector-carta-estado.test.ts). El componente de cliente solo lo dibuja; el
 * DOM se cubre con Playwright (test/e2e/pos-carta-secciones.spec.ts).
 *
 * El buscador por texto (`SelectorProducto`) y la navegación por secciones son dos caminos al MISMO `productoId`:
 *  - elegir desde la carta sube `limpiarBuscador` (la señal `limpiarSenal` del combobox, para que no quede un texto que ya no
 *    corresponde a lo elegido);
 *  - elegir desde el buscador (o tipear, que lo deja en "") solo cambia `productoId`: el botón correspondiente de la carta se marca
 *    solo, porque su `aria-pressed` se deriva de `productoId`.
 */

/** La sección de «Fuera de carta» (DP2: nunca «Otros», que podría ser el nombre de una sección de carta real). */
export const SECCION_FUERA_DE_CARTA = "fuera-de-carta";

export interface EstadoSelectorCarta {
  /** La sección de carta a la vista (su `seccionCartaId` o `SECCION_FUERA_DE_CARTA`); null = no hay nada que navegar. */
  seccionActiva: string | null;
  /** El ítem agrupado desplegado (su `itemAgrupadoCartaId`); a lo sumo uno. */
  agrupadoAbierto: string | null;
  /** El producto elegido para agregar ("" = ninguno). Nunca el id de un ítem agrupado. */
  productoId: string;
  /** Contador: cada vez que cambia, el buscador por texto se vacía. */
  limpiarBuscador: number;
}

export type AccionSelectorCarta =
  | { tipo: "elegirSeccion"; seccionId: string }
  | { tipo: "alternarAgrupado"; itemAgrupadoCartaId: string }
  | { tipo: "elegirProducto"; productoId: string; origen: "carta" | "buscador" }
  | { tipo: "limpiarTrasAgregar" };

/** Arranca en la primera sección de carta; si no hay ninguna, en «Fuera de carta» (si tiene algo). */
export function estadoInicialSelectorCarta(selector: SelectorCartaPos | null): EstadoSelectorCarta {
  const primera = selector?.seccionesCarta[0]?.seccionCartaId ?? (selector && selector.fueraDeCarta.length > 0 ? SECCION_FUERA_DE_CARTA : null);
  return { seccionActiva: primera, agrupadoAbierto: null, productoId: "", limpiarBuscador: 0 };
}

export function reducirSelectorCarta(estado: EstadoSelectorCarta, accion: AccionSelectorCarta): EstadoSelectorCarta {
  switch (accion.tipo) {
    case "elegirSeccion":
      // Cambiar de sección cierra el agrupado desplegado; lo elegido se conserva (sigue a la vista en «Elegido: …»).
      return { ...estado, seccionActiva: accion.seccionId, agrupadoAbierto: null };
    case "alternarAgrupado":
      // Abrir uno cierra el anterior; volver a tocar el abierto lo cierra.
      return { ...estado, agrupadoAbierto: estado.agrupadoAbierto === accion.itemAgrupadoCartaId ? null : accion.itemAgrupadoCartaId };
    case "elegirProducto":
      return accion.origen === "carta"
        ? { ...estado, productoId: accion.productoId, limpiarBuscador: estado.limpiarBuscador + 1 }
        : { ...estado, productoId: accion.productoId };
    case "limpiarTrasAgregar":
      // Se queda en la sección activa: el mozo suele pedir varias cosas de la misma sección seguidas.
      return { ...estado, productoId: "", agrupadoAbierto: null, limpiarBuscador: estado.limpiarBuscador + 1 };
  }
}
