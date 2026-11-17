"use client";

import { AsistenteHermanar } from "@/components/catalogo/asistente-hermanar";
import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { QuickCrear } from "@/components/catalogo/quick-crear";
import { crearInsumo } from "@/server/actions/catalogo/insumos";
import { Selector } from "@/ui/primitivas/selector";

interface Opcion {
  id: string;
  nombre: string;
}

/**
 * Insumo (el agrupador de materias primas «iguales en la práctica») de una materia prima: selector, «+ Nuevo insumo» y el asistente de hermanar. Se dibuja en la EDICIÓN y con el interruptor del alta como Pedernal
 * apagado; el alta como Pedernal no lo pide (decisión del dueño, 2026-11-17: el agrupador sigue en la edición y en `/catalogo/insumos-grupos`). Movido tal cual de `producto-form.tsx` (sin cambio de comportamiento).
 */
export function CampoInsumo({
  insumos,
  insumoId,
  unidadStockId,
  alElegir,
  alCrear,
  alResolver,
  puedeCrear,
}: {
  insumos: Opcion[];
  insumoId: string;
  unidadStockId: string;
  alElegir: (id: string) => void;
  alCrear: (item: Opcion) => void;
  alResolver: (item: Opcion) => void;
  puedeCrear: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Selector etiqueta="Insumo" etiquetaOculta value={insumoId} onChange={(e) => alElegir(e.target.value)}>
            <option value="">Sin insumo</option>
            {insumos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
              </option>
            ))}
          </Selector>
        </div>
        {puedeCrear && <QuickCrear triggerLabel="+ Nuevo insumo" title="Nuevo insumo" campoLabel="Nombre" accion={crearInsumo} onCreado={alCrear} />}
      </div>
      <AsistenteHermanar unidadStockId={unidadStockId} onResuelto={(id, nombre) => alResolver({ id, nombre })} />
      <AyudaDeFicha>
        Agrupa esta materia prima con otras que sean, en la práctica, la misma (ej. comprada a proveedores distintos) — comparten stock
        automáticamente si una se queda sin stock, y se comparan sus precios entre sí.
      </AyudaDeFicha>
    </div>
  );
}
