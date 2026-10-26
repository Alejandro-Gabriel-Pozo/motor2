import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Insignia» (Fase 6, paso 6.6g): la fuente es `Insignia` de `src/ui/primitivas/insignia.tsx` (la etiqueta corta de estado, con tono y texto obligatorio). Quien dibuja
 * `<Insignia …>` en una pantalla o en una prueba de la capa lo importa de ahí; una `function Insignia` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_INSIGNIA: Contrato = contratoDePrimitiva({
  id: "primitiva-insignia",
  archivo: "src/ui/primitivas/insignia.tsx",
  ancla: "Insignia",
  etiquetaJsx: "Insignia",
  nombresPropios: ["Insignia"],
  porQue: "una insignia dibujada a mano o copiada de la primitiva puede quedar sin texto (el estado solo en color no lo lee un daltónico ni un lector de pantalla) y se sale de los tonos del sistema",
});
