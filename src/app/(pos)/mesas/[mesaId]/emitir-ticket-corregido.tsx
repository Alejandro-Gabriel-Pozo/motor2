"use client";

import { useId, useState } from "react";
import { type TicketDeCuenta, formatearNumeroTicket, formatearMonto } from "@/core/pos/public";
import { emitirTicketCorregido } from "@/server/actions/pos/cuenta-cierre";
import { BOTON_CHICO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Emitir ticket corregido» en una fila de «Cuentas cerradas» (docs/plan-numeracion-ticket-2026-09-25.md, Fase 2): cuando después de
 * imprimir el ticket se anuló parte de la venta (una línea, desde Trazabilidad), el ticket quedó desactualizado. Diálogo con el motivo,
 * obligatorio (lo valida el servidor y su mensaje se muestra acá, `role="alert"`); el motivo queda en pantalla y en la auditoría, no se
 * imprime. Al salir bien pide imprimir el ejemplar que emitió el servidor (mismo número, letra siguiente).
 *
 * Habilitado solo con el ticket «desactualizada» y numerado, y con `pos_cerrar_cuenta` Editar; si no, deshabilitado con un `title` que
 * dice por qué.
 */
export function EmitirTicketCorregido({ ticket, hora, puede }: { ticket: TicketDeCuenta; hora: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const base = useId();

  const numero = ticket.numero ? formatearNumeroTicket(ticket.numero) : null;
  const bloqueo =
    ticket.estado === "anulada"
      ? "La venta se anuló entera: no hay ticket que corregir."
      : ticket.estado === "vigente"
        ? "El ticket ya refleja las anulaciones: no hay nada que corregir."
        : numero === null
          ? "Esta cuenta se cerró antes de la numeración de tickets: no tiene ticket que corregir."
          : puede
            ? null
            : "Emitir el ticket corregido requiere un permiso propio, que tu rol no tiene.";

  const abrir = () => {
    setMotivo("");
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };

  return (
    <>
      <button
        type="button"
        className={BOTON_CHICO}
        disabled={bloqueo !== null}
        title={bloqueo ?? undefined}
        aria-label={`Emitir el ticket corregido de la cuenta cerrada a las ${hora}`}
        onClick={abrir}
      >
        Emitir ticket corregido
      </button>

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
              Emitir ticket corregido · N.º {numero}
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">
              Después de imprimir el ticket se anuló parte de la venta. La corregida sale con el mismo número y la letra siguiente, solo con lo
              que sigue vendido.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ejecutar(
                  () => emitirTicketCorregido(ticket.cuentaId, motivo),
                  (r) => {
                    setAbierto(false);
                    pedir({ tipo: "ticket-correccion", cuentaId: ticket.cuentaId, ejemplar: r.ejemplar });
                  }
                );
              }}
              className="flex flex-col gap-3"
            >
              <div className="flex items-baseline justify-between rounded-lg bg-[var(--paper)] px-3 py-2">
                <span className="text-[13px] font-semibold">Total corregido</span>
                <span className="text-xl font-extrabold tabular-nums">{formatearMonto(ticket.total)}</span>
              </div>
              <label htmlFor={`${base}-motivo`} className="text-[13px] font-semibold">
                Motivo (obligatorio)
              </label>
              <textarea
                id={`${base}-motivo`}
                autoFocus
                rows={3}
                maxLength={200}
                aria-required="true"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${base}-error` : undefined}
                className={CAMPO}
              />
              {error && (
                <p id={`${base}-error`} role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button type="submit" disabled={pending} className={BOTON_PRIMARIO}>
                  {pending ? "Emitiendo…" : "Emitir e imprimir"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
