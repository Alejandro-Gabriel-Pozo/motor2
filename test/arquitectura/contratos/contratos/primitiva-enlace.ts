import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Enlace» (Fase 6, paso 6.6h): la fuente es `Enlace` de `src/ui/primitivas/enlace.tsx` (`next/link` con el aspecto del sistema). Quien dibuja `<Enlace …>` en una pantalla o en
 * una prueba de la capa lo importa de ahí; una `function Enlace` fuera de `src/ui` es una copia. Ver `primitivas.ts`. Los enlaces a otra pantalla con otro permiso no son de este contrato: los guarda
 * `test/arquitectura/enlaces-con-permiso.test.ts`, que mira `<Link>` y `<Enlace>` por igual.
 */
export const PRIMITIVA_ENLACE: Contrato = contratoDePrimitiva({
  id: "primitiva-enlace",
  archivo: "src/ui/primitivas/enlace.tsx",
  ancla: "Enlace",
  etiquetaJsx: "Enlace",
  nombresPropios: ["Enlace"],
  porQue: "un enlace con el aspecto copiado a mano se desvía de los tokens y del foco del sistema, y un <Enlace> local con el mismo nombre escapa de la guarda de enlaces con permiso",
});
