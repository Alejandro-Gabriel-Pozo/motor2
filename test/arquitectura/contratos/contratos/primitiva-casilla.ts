import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Casilla» (Fase 6, paso 6.6e): la fuente es `Casilla` de `src/ui/primitivas/casilla.tsx` (el checkbox con su etiqueta atada, ayuda y error). Quien dibuja
 * `<Casilla …>` en una pantalla o en una prueba de la capa lo importa de ahí; una `function Casilla` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_CASILLA: Contrato = contratoDePrimitiva({
  id: "primitiva-casilla",
  archivo: "src/ui/primitivas/casilla.tsx",
  ancla: "Casilla",
  etiquetaJsx: "Casilla",
  nombresPropios: ["Casilla"],
  porQue: "un checkbox dibujado a mano o copiado de la primitiva pierde la etiqueta atada (tocar el texto no tilda), el error anunciado una sola vez con role=alert y la zona táctil de 44 px",
});
