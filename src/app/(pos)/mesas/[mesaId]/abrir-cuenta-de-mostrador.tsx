"use client";

import { abrirCuentaDeMostrador } from "@/server/actions/pos/cuenta-apertura";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { useAccionMesa } from "./usar-accion";

/**
 * «Nueva cuenta» del mostrador (ADR-039): abre la cuenta del puesto sin pedir comensales (el mostrador no los lleva). Mientras corre no se vuelve a pulsar; si de todos modos se mandaran dos pedidos
 * (doble clic, otro cajero), el servidor devuelve la MISMA cuenta y la pantalla muestra una sola. Sin `pos_abrir_cuenta` el botón queda deshabilitado con su motivo.
 */
export function AbrirCuentaDeMostrador({ puede }: { puede: boolean }) {
  const { ejecutar, pending, error } = useAccionMesa();
  return (
    <div className="flex flex-col items-start gap-2">
      <Boton variante="acento" disabled={!puede || pending} title={puede ? undefined : "Tu rol puede ver el mostrador pero no abrir cuentas."} onClick={() => ejecutar(() => abrirCuentaDeMostrador())}>
        {pending ? "Abriendo…" : "Nueva cuenta"}
      </Boton>
      {error && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </div>
  );
}
