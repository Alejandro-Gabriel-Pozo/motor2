import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva AreaDeTexto» (Fase 6, paso 6.6d): la fuente es `AreaDeTexto` de `src/ui/primitivas/area-de-texto.tsx` (el `<textarea>` con la misma envoltura que `Campo`). Quien dibuja
 * `<AreaDeTexto …>` en una pantalla o en una prueba de la capa lo importa de ahí; una `function AreaDeTexto` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_AREA_DE_TEXTO: Contrato = contratoDePrimitiva({
  id: "primitiva-area-de-texto",
  archivo: "src/ui/primitivas/area-de-texto.tsx",
  ancla: "AreaDeTexto",
  etiquetaJsx: "AreaDeTexto",
  nombresPropios: ["AreaDeTexto"],
  porQue: "un <textarea> dibujado a mano o copiado de la primitiva pierde la etiqueta atada, el error anunciado una sola vez con role=alert y la zona táctil de 44 px",
});
