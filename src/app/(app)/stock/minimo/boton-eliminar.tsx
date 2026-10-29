"use client";

import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { eliminarStockMinimo } from "@/server/actions/stock/stock-minimo";

/**
 * "Eliminar" acá es la única acción de borrado duro de toda la app (no es
 * un movimiento de Kardex reversible — borra la fila) y antes actuaba al
 * instante, sin ningún paso intermedio. Pide confirmación en el mismo lugar
 * con `BotonConConfirmacion` (nunca window.confirm).
 */
export function BotonEliminarStockMinimo({ id, etiqueta }: { id: string; etiqueta: string }) {
  return (
    <BotonConConfirmacion
      etiqueta="Eliminar"
      aviso={`¿Eliminar el mínimo de ${etiqueta}? Deja de alertar sobre este insumo en ese depósito.`}
      etiquetaConfirmar="Sí, eliminar"
      etiquetaEnCurso="Eliminando…"
      etiquetaVolver="Volver"
      accion={() => eliminarStockMinimo(id)}
    />
  );
}
