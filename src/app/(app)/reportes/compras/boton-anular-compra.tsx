"use client";

import { BotonConConfirmacion } from "@/components/boton-con-confirmacion";
import { anularCompra } from "@/server/actions/movimientos/compras";

/**
 * «Anular compra» del detalle de una compra registrada (K1c). Anular revierte el stock y saca la compra del gasto, así que pide confirmación en el
 * mismo lugar («Anular compra» → «Sí, anular» / «Cancelar») con `BotonConConfirmacion` (src/components/boton-con-confirmacion.tsx), que se extrajo de
 * este mismo componente: foco a «Cancelar» al abrir, aviso con `role="alert"`, Escape cancela y devuelve el foco a «Anular compra».
 *
 * La clave de idempotencia (un UUID) se genera al abrir la confirmación y se reenvía tal cual si se reintenta desde esa misma confirmación: si la respuesta
 * se perdió, un reenvío devuelve el mensaje original en vez de «ya está anulada».
 *
 * Si el servidor la rechaza (típicamente porque lo comprado ya se consumió), el mensaje queda a la vista con `role="alert"` y el botón vuelve a estar
 * disponible. Si se anula, la página se refresca (`router.refresh()`) y la fila pasa a mostrarse marcada como anulada; este componente sigue montado
 * (recibe `anulada`) para dejar el aviso de éxito en pantalla, con el foco puesto en él.
 */
/** `resumen` completa la frase «la compra …» (ej. «del 2026-09-21 a Molino SA, factura A-1»): identifica de cuál se trata cuando hay muchos botones iguales en la página. */
export function BotonAnularCompra({ idOperacion, resumen, anulada }: { idOperacion: string; resumen: string; anulada: boolean }) {
  return (
    <BotonConConfirmacion
      etiqueta="Anular compra"
      etiquetaAccesible={`Anular compra ${resumen}`}
      aviso={`¿Anular la compra ${resumen}? Revierte el stock de lo que se compró y la saca del gasto. No se puede deshacer.`}
      etiquetaConfirmar="Sí, anular"
      etiquetaEnCurso="Anulando…"
      accion={(claveIdempotencia) => anularCompra(idOperacion, claveIdempotencia)}
      hecho={anulada}
    />
  );
}
