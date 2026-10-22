import type { Contrato } from "../tipos";
import { contratoDePrimitiva } from "./primitivas";

/**
 * Contrato «primitiva Boton» (Fase 6, paso 6.6a): la fuente es `Boton` de `src/ui/primitivas/boton.tsx`. Quien dibuja `<Boton …>` en una pantalla o en una prueba de la capa lo importa de ahí;
 * una `function Boton` fuera de `src/ui` es una copia. Ver `primitivas.ts` para qué vigila y por qué el alcance es ese.
 */
export const PRIMITIVA_BOTON: Contrato = contratoDePrimitiva({
  id: "primitiva-boton",
  archivo: "src/ui/primitivas/boton.tsx",
  ancla: "Boton",
  etiquetaJsx: "Boton",
  nombresPropios: ["Boton"],
  porQue: "un botón dibujado a mano o copiado de la primitiva se desvía de las variantes, los tamaños y la zona táctil de 44 px del sistema, y pierde el guardado contra el doble clic de `cargando`",
});
