import type { SelectorCartaPos } from "./selector-carta";

/**
 * Estado de «Agregar al pedido» con el selector por sección de carta (docs/plan-selector-carta-pos-2026-09-25.md, §2.4) y por
 * carpeta de género (docs/plan-genero-carta-2026-09-26.md, G3): un reductor PURO, testeable en Vitest sin DOM
 * (test/pos/selector-carta-estado.test.ts). El componente de cliente solo lo dibuja; el DOM se cubre con Playwright
 * (test/e2e/pos-carta-secciones.spec.ts).
 *
 * El buscador por texto (`SelectorProducto`) y la navegación por secciones son dos caminos al MISMO `productoId`:
 *  - elegir desde la carta sube `limpiarBuscador` (la señal `limpiarSenal` del combobox, para que no quede un texto que ya no
 *    corresponde a lo elegido);
 *  - elegir desde el buscador (o tipear, que lo deja en "") solo cambia `productoId`: el botón correspondiente de la carta se marca
 *    solo, porque su `aria-pressed` se deriva de `productoId`.
 *
 * GÉNERO (G3, decisión del dueño): `carpetaAbierta` y `agrupadoAbierto` son, a nivel de la sección, mutuamente excluyentes —
 * abrir una carpeta cierra el agrupado (suelto, sin género) que estuviera abierto, y viceversa. Un ítem agrupado que está DENTRO
 * de una carpeta abierta no tiene su propio disclosure: se muestra siempre desplegado mientras la carpeta esté abierta (así no
 * hay contradicción entre "abrir un agrupado cierra la carpeta" y "un agrupado adentro de la carpeta se puede abrir sin cerrarla"
 * — ver `selector-carta.tsx`). Tras agregar (`limpiarTrasAgregar`), la carpeta abierta QUEDA abierta (para pedir varias cervezas
 * seguidas sin reabrir, G3); el agrupado suelto desplegado sigue cerrándose, como siempre. Cambiar de sección cierra las dos cosas.
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
  /** El producto elegido para agregar ("" = ninguno). Nunca el id de un ítem agrupado. */
  productoId: string;
  /** Contador: cada vez que cambia, el buscador por texto se vacía. */
  limpiarBuscador: number;
}

export type AccionSelectorCarta =
  | { tipo: "elegirSeccion"; seccionId: string }
  | { tipo: "alternarAgrupado"; itemAgrupadoCartaId: string }
  | { tipo: "alternarCarpeta"; generoCartaId: string }
  | { tipo: "elegirProducto"; productoId: string; origen: "carta" | "buscador" }
  | { tipo: "limpiarTrasAgregar" };

/** Arranca en la primera sección de carta; si no hay ninguna, en «Fuera de carta» (si tiene algo). */
export function estadoInicialSelectorCarta(selector: SelectorCartaPos | null): EstadoSelectorCarta {
  const primera = selector?.seccionesCarta[0]?.seccionCartaId ?? (selector && selector.fueraDeCarta.length > 0 ? SECCION_FUERA_DE_CARTA : null);
  return { seccionActiva: primera, agrupadoAbierto: null, carpetaAbierta: null, productoId: "", limpiarBuscador: 0 };
}

export function reducirSelectorCarta(estado: EstadoSelectorCarta, accion: AccionSelectorCarta): EstadoSelectorCarta {
  switch (accion.tipo) {
    case "elegirSeccion":
      // Cambiar de sección cierra el agrupado y la carpeta desplegados; lo elegido se conserva (sigue a la vista en «Elegido: …»).
      return { ...estado, seccionActiva: accion.seccionId, agrupadoAbierto: null, carpetaAbierta: null };
    case "alternarAgrupado":
      // Abrir uno cierra el anterior; volver a tocar el abierto lo cierra. Abrir un agrupado suelto cierra la carpeta abierta.
      return { ...estado, agrupadoAbierto: estado.agrupadoAbierto === accion.itemAgrupadoCartaId ? null : accion.itemAgrupadoCartaId, carpetaAbierta: null };
    case "alternarCarpeta":
      // Misma regla que un agrupado: abrir una cierra la anterior, y cierra el agrupado suelto que estuviera abierto.
      return { ...estado, carpetaAbierta: estado.carpetaAbierta === accion.generoCartaId ? null : accion.generoCartaId, agrupadoAbierto: null };
    case "elegirProducto":
      return accion.origen === "carta"
        ? { ...estado, productoId: accion.productoId, limpiarBuscador: estado.limpiarBuscador + 1 }
        : { ...estado, productoId: accion.productoId };
    case "limpiarTrasAgregar":
      // G3: la carpeta abierta queda abierta (pedir varias cervezas seguidas sin reabrir). El agrupado suelto se sigue cerrando,
      // como siempre. Se queda en la sección activa: el mozo suele pedir varias cosas de la misma sección seguidas.
      return { ...estado, productoId: "", agrupadoAbierto: null, limpiarBuscador: estado.limpiarBuscador + 1 };
  }
}
