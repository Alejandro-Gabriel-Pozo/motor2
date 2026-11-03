"use client";

import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { eliminarFrecuenciaConteo } from "@/server/actions/stock/frecuencia-conteo";

/** Confirmación en el mismo lugar con `BotonConConfirmacion` — nunca window.confirm. */
export function BotonEliminarFrecuenciaConteo({ id, etiqueta }: { id: string; etiqueta: string }) {
  return (
    <BotonConConfirmacion
      etiqueta="Eliminar"
      aviso={`¿Eliminar la agenda de conteo de ${etiqueta}? Deja de sugerirse como pendiente de contar.`}
      etiquetaConfirmar="Sí, eliminar"
      etiquetaEnCurso="Eliminando…"
      etiquetaVolver="Volver"
      accion={() => eliminarFrecuenciaConteo(id)}
    />
  );
}
