"use client";

import { useId, useState } from "react";
import { corregirComensales } from "@/server/actions/pos/cuenta-apertura";
import { BOTON_CHICO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

/**
 * Comensales de la cuenta ABIERTA, con «Editar» para corregirlos (docs/plan-comensales-y-limite-mesas-2026-09-26.md: llega gente
 * después, o se cargó mal al abrir). `comensales: null` = cuenta abierta antes de este campo (sin backfill); se muestra «sin
 * datos» hasta que se corrija. Una vez cerrada la cuenta, este componente no se dibuja: el dato queda congelado.
 */
export function ComensalesCuenta({ cuentaId, comensales, puede }: { cuentaId: string; comensales: number | null; puede: boolean }) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const base = useId();

  const abrir = () => {
    setValor(comensales !== null ? String(comensales) : "");
    setError(null);
    setEditando(true);
  };
  const cancelar = () => {
    if (!pending) setEditando(false);
  };
  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(valor.trim());
    if (valor.trim() === "" || !Number.isInteger(n)) {
      setError("Elegí un número entero de comensales.");
      return;
    }
    ejecutar(
      () => corregirComensales(cuentaId, n),
      () => setEditando(false)
    );
  };

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--ink-soft)]">
        {comensales !== null ? `${comensales} comensal${comensales === 1 ? "" : "es"}` : "Comensales: sin datos"}
        {puede && (
          <button type="button" onClick={abrir} className="text-[12.5px] font-semibold underline hover:text-[var(--ink)]">
            Editar
          </button>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <label htmlFor={`${base}-comensales`} className="sr-only">
        Comensales
      </label>
      <input
        id={`${base}-comensales`}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        min={1}
        max={99}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${base}-error` : undefined}
        className={`${CAMPO} w-16 py-1 text-[13px] tabular-nums`}
      />
      <button type="submit" disabled={pending} className={BOTON_CHICO}>
        {pending ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" onClick={cancelar} className={BOTON_SECUNDARIO}>
        Cancelar
      </button>
      {error && (
        <p id={`${base}-error`} role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
