"use client";

import { useId, useState } from "react";
import type { BoletaDeCuenta } from "@/core/pos/boleta";
import { formatearNumeroBoleta } from "@/core/pos/numeracion-boleta";
import { emitirBoletaCorregida } from "@/server/actions/pos/cuenta-cierre";
import { BOTON_CHICO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { formatearMonto } from "@/core/pos/formato";
import { useImpresion } from "./imprimir";
import { useAccionMesa } from "./usar-accion";

/**
 * «Emitir boleta corregida» en una fila de «Cuentas cerradas» (docs/plan-numeracion-boleta-2026-09-25.md, Fase 2): cuando después de
 * imprimir la boleta se anuló parte de la venta (una línea, desde Trazabilidad), la boleta quedó desactualizada. Diálogo con el motivo,
 * obligatorio (lo valida el servidor y su mensaje se muestra acá, `role="alert"`); el motivo queda en pantalla y en la auditoría, no se
 * imprime. Al salir bien pide imprimir el ejemplar que emitió el servidor (mismo número, letra siguiente).
 *
 * Habilitado solo con la boleta «desactualizada» y numerada, y con `pos_cerrar_cuenta` Editar; si no, deshabilitado con un `title` que
 * dice por qué.
 */
export function EmitirBoletaCorregida({ boleta, hora, puede }: { boleta: BoletaDeCuenta; hora: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const { pedir } = useImpresion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const base = useId();

  const numero = boleta.numero ? formatearNumeroBoleta(boleta.numero) : null;
  const bloqueo =
    boleta.estado === "anulada"
      ? "La venta se anuló entera: no hay boleta que corregir."
      : boleta.estado === "vigente"
        ? "La boleta ya refleja las anulaciones: no hay nada que corregir."
        : numero === null
          ? "Esta cuenta se cerró antes de la numeración de boletas: no tiene boleta que corregir."
          : puede
            ? null
            : "Emitir la boleta corregida requiere el permiso de cerrar cuentas, que tu rol no tiene.";

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
        aria-label={`Emitir la boleta corregida de la cuenta cerrada a las ${hora}`}
        onClick={abrir}
      >
        Emitir boleta corregida
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
              Emitir boleta corregida · N.º {numero}
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">
              Después de imprimir la boleta se anuló parte de la venta. La corregida sale con el mismo número y la letra siguiente, solo con lo
              que sigue vendido.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ejecutar(
                  () => emitirBoletaCorregida(boleta.cuentaId, motivo),
                  (r) => {
                    setAbierto(false);
                    pedir({ tipo: "boleta-correccion", cuentaId: boleta.cuentaId, ejemplar: r.ejemplar });
                  }
                );
              }}
              className="flex flex-col gap-3"
            >
              <div className="flex items-baseline justify-between rounded-lg bg-[var(--paper)] px-3 py-2">
                <span className="text-[13px] font-semibold">Total corregido</span>
                <span className="text-xl font-extrabold tabular-nums">{formatearMonto(boleta.total)}</span>
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
