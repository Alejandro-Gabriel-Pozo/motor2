"use client";

import { useId, useState } from "react";
import { anularItemEnviado } from "@/server/actions/pos/cuenta";
import { BOTON_CHICO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { formatearCantidad } from "./formato";
import { useAccionMesa } from "./usar-accion";

/**
 * «Anular» un ítem que YA SALIÓ a cocina: diálogo con la cantidad (por defecto, todo lo que queda) y el motivo, obligatorio. Manda
 * además lo que quedaba al abrir el diálogo (`restanteVisto`): si otro lo anuló mientras tanto, el servidor rechaza en vez de anular
 * sobre un número viejo. El motivo no lleva `required` nativo a propósito: el que valida es el servidor, y su mensaje se muestra acá
 * (`role="alert"`). Sin `pos_anular_item`, el botón queda deshabilitado.
 */
export function AnularItem({ item, puede }: { item: { id: string; productoNombre: string; restante: number }; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [abierto, setAbierto] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [restanteVisto, setRestanteVisto] = useState(item.restante);
  const base = useId();

  const abrir = () => {
    setCantidad(String(item.restante).replace(".", ","));
    setMotivo("");
    setRestanteVisto(item.restante);
    setError(null);
    setAbierto(true);
  };
  const cerrar = () => {
    if (!pending) setAbierto(false);
  };
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(cantidad.trim().replace(",", ".") || Number.NaN);
    ejecutar(() => anularItemEnviado(item.id, n, motivo, restanteVisto), () => setAbierto(false));
  };

  return (
    <>
      <button
        type="button"
        className={BOTON_CHICO}
        disabled={!puede}
        title={puede ? undefined : "Anular algo que ya salió a cocina requiere un permiso que tu rol no tiene."}
        aria-label={`Anular ${item.productoNombre}`}
        onClick={abrir}
      >
        Anular
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
              Anular «{item.productoNombre}»
            </h2>
            <p className="mb-4 text-[13px] text-[var(--ink-soft)]">Ya salió a cocina: queda registrado quién lo anuló y por qué. Quedan {formatearCantidad(item.restante)}.</p>
            <form onSubmit={enviar} className="flex flex-col gap-3">
              <label htmlFor={`${base}-cantidad`} className="text-[13px] font-semibold">
                Cantidad a anular
              </label>
              <input
                id={`${base}-cantidad`}
                inputMode="decimal"
                autoComplete="off"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className={`${CAMPO} tabular-nums`}
              />
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
                  {pending ? "Anulando…" : "Anular"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
