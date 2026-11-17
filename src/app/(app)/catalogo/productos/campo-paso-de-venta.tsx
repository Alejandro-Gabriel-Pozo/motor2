"use client";

import { CampoNumero } from "@/components/campo-numero";
import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";

/**
 * «Paso de venta (opcional)» de un producto de venta. Se dibuja en la EDICIÓN y con el interruptor del alta como Pedernal apagado; el alta como Pedernal no lo pide (decisión del dueño, 2026-11-17).
 * Movido tal cual de `producto-form.tsx` (sin cambio de comportamiento).
 */
export function CampoPasoDeVenta({ pasoVenta }: { pasoVenta: number | null | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <CampoNumero tipo="cantidad" name="pasoVenta" placeholder="Paso de venta (opcional)" ariaLabel="Paso de venta" defaultValue={pasoVenta != null ? String(pasoVenta) : ""} />
      <AyudaDeFicha>
        Dejalo vacío para vender siempre de a una unidad entera (lo habitual). Con un paso (ej. 0,5), se puede vender esa fracción —
        0,5 vende media unidad al 50% del precio — y cualquier cantidad que no sea múltiplo exacto del paso se rechaza al cargarla.
      </AyudaDeFicha>
    </div>
  );
}
