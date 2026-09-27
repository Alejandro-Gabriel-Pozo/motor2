"use client";

import { useId, useState } from "react";
import { anularPromoEnviada } from "@/server/actions/pos/cuenta";
import { BOTON_CHICO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/**
 * «Anular» una promo que YA SALIÓ a cocina (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11, D4): siempre TODOS sus
 * componentes juntos, nunca uno solo — por eso no pide cantidad (a diferencia de `AnularItem`), solo el motivo, obligatorio.
 * Mismo patrón de diálogo que `AnularItem` (backdrop, `role="dialog"`, Escape cierra). Sin `pos_anular_item`, deshabilitado.
 *
 * No imprime un aviso de cocina propio: cada componente anulado sigue viéndose (tachado) en su línea de envío de siempre, con
 * el mismo motivo — no hace falta un ticket aparte por promo.
 */
export function AnularPromo({ promoCuentaId, titulo, puede }: { promoCuentaId: string; titulo: string; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const base = useId();

  const abrir = () => {
    setMotivo("");
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    ejecutar(
      () => anularPromoEnviada(promoCuentaId, motivo),
      () => setAbierto(false)
    );
  };

  return (
    <>
      <button
        type="button"
        className={BOTON_CHICO}
        disabled={!puede}
        title={puede ? undefined : "Anular algo que ya salió a cocina requiere un permiso que tu rol no tiene."}
        aria-label={`Anular promo ${titulo}`}
        onClick={abrir}
      >
        Anular promo
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
              Anular promo «{titulo}»
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">
              Ya salió a cocina: se anulan TODOS sus componentes juntos, nunca uno solo. Queda registrado quién lo anuló y por qué.
            </p>
            <form onSubmit={enviar} className="flex flex-col gap-3">
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
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-[var(--mesa-ocupada)] px-4 py-[9px] text-[13px] font-semibold text-white enabled:hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Anulando…" : "Anular promo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
