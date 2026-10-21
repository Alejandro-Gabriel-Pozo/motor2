import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Aviso» (Fase 6, paso 6.6f): la fuente es `Aviso` de `src/ui/primitivas/aviso.tsx` (el mensaje de éxito, advertencia, error o información; el rol sale de la variante).
 * Quien dibuja `<Aviso …>` en una pantalla o en una prueba de la capa lo importa de ahí; una `function Aviso` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_AVISO: Contrato = contratoDePrimitiva({
  id: "primitiva-aviso",
  archivo: "src/ui/primitivas/aviso.tsx",
  ancla: "Aviso",
  etiquetaJsx: "Aviso",
  nombresPropios: ["Aviso"],
  porQue: "un aviso dibujado a mano o copiado de la primitiva pierde el rol que sale de la variante (un error que no se anuncia como alert no lo oye un lector de pantalla) y los tonos del sistema",
});
