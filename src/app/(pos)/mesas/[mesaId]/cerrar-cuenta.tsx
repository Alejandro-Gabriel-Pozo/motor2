"use client";

import { useId, useState } from "react";
import { cerrarCuenta } from "@/server/actions/pos/cuenta-cierre";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { formatearMonto } from "@/core/pos/public";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Cerrar cuenta»: registra la venta de lo consumido (al precio congelado de cada ítem) y libera la mesa, en un solo paso (no hay caja
 * ni cobro aparte). La sección de la que sale la mercadería NO se elige: el servidor la resuelve insumo por insumo
 * (docs/plan-seccion-habitual-stock-2026-09-25.md); sin ninguna sección activa en la sucursal el cierre no se puede confirmar. Con ítems
 * sin enviar el botón queda deshabilitado y se dice por qué; sin `pos_cerrar_cuenta`, también. Si el cierre dejó algún insumo en
 * negativo, el mensaje de éxito lo nombra, con su sección (aviso de la pantalla, en ámbar).
 *
 * Con total > 0, al salir bien pide imprimir el ticket para el cliente: la de esta cuenta, en cuanto el refresco la trae en «Cuentas
 * cerradas» (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md, B6). Sin navegar a otra pantalla, para no perder el aviso. Con total
 * 0 (todo anulado) no hay venta ni ticket.
 */
export function CerrarCuenta({
  cuentaId,
  titulo,
  total,
  sinEnviar,
  haySecciones,
  puede,
  delMostrador,
}: {
  cuentaId: string;
  titulo: string;
  total: number;
  sinEnviar: number;
  /** ¿La sucursal tiene alguna sección activa? Sin ninguna, no hay de dónde descontar la mercadería. */
  haySecciones: boolean;
  puede: boolean;
  /** ADR-039: el cierre del mostrador no «libera la mesa»: la cuenta queda cerrada y se puede abrir otra. */
  delMostrador: boolean;
}) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const base = useId();

  const bloqueo = sinEnviar > 0 ? `Hay ${sinEnviar === 1 ? "1 ítem sin enviar: envialo o quitalo" : `${sinEnviar} ítems sin enviar: envialos o quitalos`} antes de cerrar la cuenta.` : null;
  const abrir = () => {
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Boton
        variante="acento"
        disabled={!puede || bloqueo !== null}
        title={puede ? undefined : "Cerrar la cuenta (registrar la venta) requiere un permiso que tu rol no tiene."}
        aria-describedby={bloqueo ? `${base}-bloqueo` : undefined}
        onClick={abrir}
      >
        Cerrar cuenta
      </Boton>
      {bloqueo && (
        <p id={`${base}-bloqueo`} className="text-sm text-tinta-suave">
          {bloqueo}
        </p>
      )}

      <Dialogo abierto={abierto} titulo={`Cerrar cuenta · ${titulo}`} onCerrar={cerrar} cerrable={!pending}>
        <p className="mb-4 text-sm text-tinta-suave">{delMostrador ? "Se registra la venta y la cuenta queda cerrada." : "Se registra la venta y la mesa queda libre."}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ejecutar(
              () => cerrarCuenta(cuentaId),
              () => {
                setAbierto(false);
                if (total > 0) pedir({ tipo: "ticket", cuentaId });
              }
            );
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between rounded-lg bg-papel px-3 py-2">
            <span className="text-sm font-semibold">Total</span>
            <span data-total-cierre className="text-xl font-extrabold tabular-nums">
              {formatearMonto(total)}
            </span>
          </div>
          {haySecciones ? (
            <p className="text-sm text-tinta-suave">Cada producto se descuenta de su sección habitual; si ahí no alcanza, de otra sección con stock.</p>
          ) : (
            <p className="text-sm text-error">Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.</p>
          )}
          {error && (
            <Aviso variante="error" forma="en-linea">
              {error}
            </Aviso>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            {/* El foco inicial es «Cerrar y registrar la venta» (como antes con `autoFocus`): `Dialogo` lo enfoca con `data-foco-inicial`. */}
            <Boton type="submit" variante="acento" data-foco-inicial="" disabled={pending || !haySecciones}>
              {pending ? "Cerrando…" : "Cerrar y registrar la venta"}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </div>
  );
}
