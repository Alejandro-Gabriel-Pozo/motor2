"use client";

import { CampoNumero } from "@/components/campo-numero";
import { ValorSoloLectura } from "@/components/catalogo/campos-sensibles-solo-lectura";
import { formatearMonto } from "@/core/formato-de-numero";

/**
 * «El precio de venta» de un producto de venta directo (no «por opción»). Frente 2 (`docs/diseno-precio-fuera-del-alta-2026-11-17.md`; pedido del dueño, 2026-11-17: «No, el precio donde lo pide... Donde lo pide
 * Pedernal.»): con el alta «como Pedernal» el ALTA no pide precio (se carga después, en la pestaña «Precios» de la ficha, o en la edición con `producto_campos_sensibles`): no dibuja nada y el formulario manda precio 0.
 * La EDICIÓN y la pantalla anterior (interruptor apagado) no cambian: campo con la clave, valor guardado en solo lectura sin ella.
 */
export function CampoPrecioDeVenta({
  editando,
  altaComoPedernal,
  puedeEditarCamposSensibles,
  precioGuardado,
}: {
  editando: boolean;
  altaComoPedernal: boolean;
  puedeEditarCamposSensibles: boolean;
  precioGuardado: number;
}) {
  if (!editando && altaComoPedernal) return null;
  if (!puedeEditarCamposSensibles) {
    return (
      <ValorSoloLectura campo="precioVenta" etiqueta="Precio de venta">
        {formatearMonto(precioGuardado)}
      </ValorSoloLectura>
    );
  }
  return (
    <CampoNumero
      name="precioVenta"
      prefijo="$"
      placeholder="Precio de venta"
      ariaLabel="Precio de venta"
      defaultValue={String(precioGuardado)}
      tipo="importe"
      etiqueta="El precio de venta"
    />
  );
}
