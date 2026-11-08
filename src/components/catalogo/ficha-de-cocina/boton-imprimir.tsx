"use client";

import { Boton } from "@/ui/primitivas/boton";

/**
 * «Imprimir» de la ficha de cocina: un `window.print()` directo (mismo patrón que la carta pública y el ticket del POS); el diseño del papel lo da el `@media print` de
 * `src/app/globals.css` (bloque «Ficha de cocina»). Es un botón de pantalla: al imprimir no sale (`data-ficha-solo-pantalla`).
 */
export function BotonImprimirFicha() {
  return (
    <Boton variante="primario" tamano="compacto" onClick={() => window.print()}>
      Imprimir
    </Boton>
  );
}
