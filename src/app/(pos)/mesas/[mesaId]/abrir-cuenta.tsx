"use client";

import { useId, useState } from "react";
import { abrirCuenta } from "@/server/actions/pos/cuenta";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/** Botones rápidos del diálogo de comensales: 1 a 6, el rango más común (docs/plan-comensales-y-limite-mesas-2026-09-26.md). */
const RAPIDOS = [1, 2, 3, 4, 5, 6] as const;

/**
 * «Abrir cuenta» de una mesa libre: pide primero la cantidad de comensales (obligatoria, SIN sugerir ningún valor — un default
 * sesgaría la métrica de rotación de mesas que existe para medir, ver el docstring de `Cuenta.comensales`). Botones rápidos 1-6 más
 * un campo "Otro" (1..99); la validación real es del servidor (`validarComensales`), este diálogo solo ordena el 1-99 en el campo
 * numérico. Si se llegó al límite de mesas abiertas de la sucursal, el servidor lo rechaza con el mensaje de negocio y el diálogo
 * queda abierto mostrándolo. Sin `pos_tomar_pedido` el botón queda deshabilitado (el servidor lo vuelve a verificar igual).
 */
export function AbrirCuenta({ mesaId, puede }: { mesaId: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [abierto, setAbierto] = useState(false);
  const [comensales, setComensales] = useState<number | null>(null);
  const [otro, setOtro] = useState("");
  const base = useId();

  const abrirDialogo = () => {
    setComensales(null);
    setOtro("");
    setError(null);
    setAbierto(true);
  };
  const cerrarDialogo = () => {
    if (!pending) setAbierto(false);
  };

  const elegirRapido = (n: number) => {
    setComensales(n);
    setOtro("");
  };
  const elegirOtro = (texto: string) => {
    setOtro(texto);
    const n = Number(texto.trim());
    setComensales(texto.trim() !== "" && Number.isInteger(n) ? n : null);
  };

  const confirmar = (e: React.FormEvent) => {
    e.preventDefault();
    if (comensales === null) {
      setError("Elegí cuántos comensales son.");
      return;
    }
    ejecutar(
      () => abrirCuenta(mesaId, comensales),
      () => setAbierto(false)
    );
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={BOTON_PRIMARIO} disabled={!puede} title={puede ? undefined : "Tu rol puede ver la mesa pero no tomar pedidos."} onClick={abrirDialogo}>
        Abrir cuenta
      </button>
      {error && !abierto && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cerrarDialogo}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${base}-titulo`}
            className="w-full max-w-sm rounded-[14px] bg-white p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") cerrarDialogo();
            }}
          >
            <h2 id={`${base}-titulo`} className="mb-1 text-lg font-extrabold tracking-tight">
              ¿Cuántos comensales?
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">Es solo para medir la rotación de la mesa: no divide la cuenta por persona.</p>
            <form onSubmit={confirmar} className="flex flex-col gap-3">
              <div role="group" aria-label="Comensales" className="flex flex-wrap gap-1.5">
                {RAPIDOS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={comensales === n}
                    onClick={() => elegirRapido(n)}
                    className={`size-9 rounded-lg border text-[14px] font-semibold tabular-nums transition-colors ${
                      comensales === n ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border)] bg-white hover:bg-[#F1EFEA]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <label htmlFor={`${base}-otro`} className="text-[13px] font-semibold">
                Otro
              </label>
              <input
                id={`${base}-otro`}
                inputMode="numeric"
                autoComplete="off"
                min={1}
                max={99}
                value={otro}
                onChange={(e) => elegirOtro(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="Cantidad"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${base}-error` : undefined}
                className={`${CAMPO} tabular-nums`}
              />
              {error && (
                <p id={`${base}-error`} role="alert" className="text-[13px] text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={cerrarDialogo} className={BOTON_SECUNDARIO}>
                  Cancelar
                </button>
                <button type="submit" disabled={pending} className={BOTON_PRIMARIO}>
                  {pending ? "Abriendo…" : "Confirmar apertura"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
