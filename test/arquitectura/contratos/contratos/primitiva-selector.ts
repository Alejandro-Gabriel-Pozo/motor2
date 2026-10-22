import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Selector» (Fase 6, paso 6.6c): la fuente es `Selector` de `src/ui/primitivas/selector.tsx` (el `<select>` con la misma envoltura que `Campo`). Quien dibuja `<Selector …>`
 * en una pantalla o en una prueba de la capa lo importa de ahí; una `function Selector` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_SELECTOR: Contrato = contratoDePrimitiva({
  id: "primitiva-selector",
  archivo: "src/ui/primitivas/selector.tsx",
  ancla: "Selector",
  etiquetaJsx: "Selector",
  nombresPropios: ["Selector"],
  porQue: "un <select> dibujado a mano o copiado de la primitiva pierde la etiqueta atada, el error anunciado una sola vez con role=alert y la zona táctil de 44 px",
});
