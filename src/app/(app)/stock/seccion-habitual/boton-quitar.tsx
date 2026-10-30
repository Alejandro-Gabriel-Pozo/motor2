"use client";

import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { eliminarSeccionHabitual } from "@/server/actions/stock/seccion-habitual";

/** Confirmación en el mismo lugar con `BotonConConfirmacion` — nunca window.confirm. */
export function BotonQuitarSeccionHabitual({ id, producto }: { id: string; producto: string }) {
  return (
    <BotonConConfirmacion
      etiqueta="Quitar"
      etiquetaAccesible={`Quitar el depósito habitual de ${producto}`}
      aviso={`¿Quitar el depósito habitual de «${producto}»? Va a salir de donde haya stock.`}
      etiquetaConfirmar="Sí, quitar"
      etiquetaEnCurso="Quitando…"
      etiquetaVolver="Volver"
      accion={() => eliminarSeccionHabitual(id)}
    />
  );
}
