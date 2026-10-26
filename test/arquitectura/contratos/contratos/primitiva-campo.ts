import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Campo» (Fase 6, paso 6.6b): la fuente es `Campo` de `src/ui/primitivas/campo.tsx` (que también define `EnvolturaDeCampo`, la envoltura que comparten el selector y el área de
 * texto). Quien dibuja `<Campo …>` en una pantalla o en una prueba de la capa lo importa de ahí; una `function Campo` o `function EnvolturaDeCampo` fuera de `src/ui` es una copia. Ver `primitivas.ts`.
 */
export const PRIMITIVA_CAMPO: Contrato = contratoDePrimitiva({
  id: "primitiva-campo",
  archivo: "src/ui/primitivas/campo.tsx",
  ancla: "Campo",
  etiquetaJsx: "Campo",
  nombresPropios: ["Campo", "EnvolturaDeCampo"],
  porQue: "un campo de formulario dibujado a mano o copiado de la primitiva pierde la etiqueta atada, el error anunciado una sola vez con role=alert y la zona táctil de 44 px",
});
