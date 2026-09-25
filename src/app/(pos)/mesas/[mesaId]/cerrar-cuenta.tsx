"use client";

import { useId, useState } from "react";
import { cerrarCuenta } from "@/server/actions/pos/cuenta";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./estilos";
import { formatearMonto } from "./formato";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Cerrar cuenta»: registra la venta de lo consumido (al precio congelado de cada ítem) y libera la mesa, en un solo paso (no hay caja
 * ni cobro aparte). La sección de la que sale la mercadería NO se elige: el servidor la resuelve insumo por insumo
 * (docs/plan-seccion-habitual-stock-2026-09-25.md); sin ninguna sección activa en la sucursal el cierre no se puede confirmar. Con ítems
 * sin enviar el botón queda deshabilitado y se dice por qué; sin `pos_cerrar_cuenta`, también. Si el cierre dejó algún insumo en
 * negativo, el mensaje de éxito lo nombra, con su sección (aviso de la pantalla, en ámbar).
 *
 * Con total > 0, al salir bien pide imprimir la boleta para el cliente: la de esta cuenta, en cuanto el refresco la trae en «Cuentas
 * cerradas» (docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B6). Sin navegar a otra pantalla, para no perder el aviso. Con total
 * 0 (todo anulado) no hay venta ni boleta.
 */
export function CerrarCuenta({
  cuentaId,
  titulo,
  total,
  sinEnviar,
  haySecciones,
  puede,
}: {
  cuentaId: string;
  titulo: string;
  total: number;
  sinEnviar: number;
  /** ¿La sucursal tiene alguna sección activa? Sin ninguna, no hay de dónde descontar la mercadería. */
  haySecciones: boolean;
  puede: boolean;
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
      <button
        type="button"
        className={BOTON_PRIMARIO}
        disabled={!puede || bloqueo !== null}
        title={puede ? undefined : "Cerrar la cuenta (registrar la venta) requiere un permiso que tu rol no tiene."}
        aria-describedby={bloqueo ? `${base}-bloqueo` : undefined}
        onClick={abrir}
      >
        Cerrar cuenta
      </button>
      {bloqueo && (
        <p id={`${base}-bloqueo`} className="text-[12.5px] text-[var(--ink-soft)]">
          {bloqueo}
        </p>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cerrar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${base}-titulo`}
            className="w-full max-w-md rounded-[14px] bg-white p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") cerrar();
            }}
          >
            <h2 id={`${base}-titulo`} className="mb-1 text-lg font-extrabold tracking-tight">
              Cerrar cuenta · {titulo}
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">Se registra la venta y la mesa queda libre.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ejecutar(
                  () => cerrarCuenta(cuentaId),
                  () => {
                    setAbierto(false);
                    if (total > 0) pedir({ tipo: "boleta", cuentaId });
                  }
                );
              }}
              className="flex flex-col gap-3"
            >
              <div className="flex items-baseline justify-between rounded-lg bg-[var(--paper)] px-3 py-2">
                <span className="text-[13px] font-semibold">Total</span>
                <span data-total-cierre className="text-xl font-extrabold tabular-nums">
                  {formatearMonto(total)}
                </span>
              </div>
              {haySecciones ? (
                <p className="text-[13px] text-[var(--ink-soft)]">Cada insumo se descuenta de una sección con stock: primero de la que vence antes.</p>
              ) : (
                <p className="text-[13px] text-red-700">
                  Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.
                </p>
              )}
              {error && (
                <p role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button type="submit" autoFocus disabled={pending || !haySecciones} className={BOTON_PRIMARIO}>
                  {pending ? "Cerrando…" : "Cerrar y registrar la venta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
