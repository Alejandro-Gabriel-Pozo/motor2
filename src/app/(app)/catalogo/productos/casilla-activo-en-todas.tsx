"use client";

import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { AvisoAltaSinPrecio } from "@/components/catalogo/campos-sensibles-solo-lectura";
import { Casilla } from "@/ui/primitivas/casilla";

/**
 * «Activo en todas las sucursales» del alta (§4.1, `docs/plan-disponibilidad-por-sucursal-2026-09-23.md`; tildada por defecto, decisión 2 del dueño). Con el alta como Pedernal
 * (`ALTA_DE_PRODUCTO_COMO_PEDERNAL`, `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md`) esta casilla ya no se dibuja y el producto nace disponible en todas las sucursales (el valor de hoy);
 * sin quitar la pantalla anterior: con el interruptor apagado se ve igual que antes. Movida tal cual desde `producto-form.tsx`, sin cambio de comportamiento.
 */
export function CasillaActivoEnTodas({
  activoEnTodas,
  alCambiar,
  naceSinPoderVenderse,
  cantidadSucursales,
  nombreSucursalActual,
}: {
  activoEnTodas: boolean;
  alCambiar: (valor: boolean) => void;
  naceSinPoderVenderse: boolean;
  cantidadSucursales?: number;
  nombreSucursalActual?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Casilla checked={activoEnTodas && !naceSinPoderVenderse} disabled={naceSinPoderVenderse} onChange={(e) => alCambiar(e.target.checked)} etiqueta="Activo en todas las sucursales" />
      {naceSinPoderVenderse ? (
        <AvisoAltaSinPrecio />
      ) : (
        <AyudaDeFicha>
          {activoEnTodas
            ? `Tildado (lo habitual, para insumos y platos compartidos como harina o sal): queda disponible en las ${cantidadSucursales ?? "?"} sucursales que existen hoy.`
            : `Sin tildar: solo queda disponible en "${nombreSucursalActual ?? "esta sucursal"}" — en las demás no va a aparecer hasta que un admin de esa sucursal lo active ahí.`}
        </AyudaDeFicha>
      )}
    </div>
  );
}
