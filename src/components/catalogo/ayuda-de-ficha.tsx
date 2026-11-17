import { FICHA_AYUDAS_VISIBLES } from "@/core/catalogo/public";
import { AyudaCampo } from "@/components/ayuda-campo";

/**
 * Una ayuda de campo de la ficha del producto que se oculta con `FICHA_AYUDAS_VISIBLES` (`src/core/catalogo/ficha-ayudas-visibles.ts`). Con el interruptor apagado no dibuja nada; encendido, es `AyudaCampo` tal cual.
 */
export function AyudaDeFicha({ children }: { children: React.ReactNode }) {
  return FICHA_AYUDAS_VISIBLES ? <AyudaCampo>{children}</AyudaCampo> : null;
}
