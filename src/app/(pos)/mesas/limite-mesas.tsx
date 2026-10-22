"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { actualizarMaxMesasAbiertas } from "@/server/actions/pos/mesas";

/**
 * Límite de mesas ABIERTAS a la vez en la sucursal (`Sucursal.maxMesasAbiertas`, docs/plan-comensales-y-limite-mesas-2026-09-26.md):
 * mismo permiso que dar de alta mesas (`pos_mesas`, Editar — igual que `NuevaMesa`). Vacío = sin límite. Al llegar al límite,
 * `abrirCuenta` bloquea en seco (sin ninguna excepción de permiso especial, D6 del plan): este control solo edita el número, el
 * bloqueo real vive en el servidor.
 */
export function LimiteMesasAbiertas({ abiertas, limite, puedeEditar }: { abiertas: number; limite: number | null; puedeEditar: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const base = useId();

  const abrir = () => {
    setValor(limite !== null ? String(limite) : "");
    setError(null);
    setEditando(true);
  };
  const cancelar = () => {
    if (!pending) setEditando(false);
  };
  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const texto = valor.trim();
    const n = texto === "" ? null : Number(texto);
    if (n !== null && !Number.isInteger(n)) {
      setError("El límite tiene que ser un número entero, o vacío para no tener límite.");
      return;
    }
    startTransition(async () => {
      const r = await actualizarMaxMesasAbiertas(n);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setEditando(false);
      router.refresh();
    });
  };

  const texto = limite !== null ? `Máx. ${limite} mesas abiertas (${abiertas}/${limite})` : `Sin límite de mesas abiertas (${abiertas} abiertas)`;

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tinta-tenue">
        {texto}
        {puedeEditar && (
          <button type="button" onClick={abrir} className="font-semibold underline hover:text-tinta">
            Editar límite
          </button>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <label htmlFor={`${base}-limite`} className="text-[12.5px] font-semibold text-tinta-tenue">
        Máx. mesas abiertas
      </label>
      <input
        id={`${base}-limite`}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        placeholder="Sin límite"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${base}-error` : undefined}
        className="w-24 rounded-lg border border-borde px-2 py-1 text-[13px] tabular-nums outline-none focus:border-tinta-suave"
      />
      <button type="submit" disabled={pending} className="rounded-md border border-borde bg-superficie px-2.5 py-1 text-[12.5px] font-semibold enabled:hover:bg-superficie-suave disabled:opacity-50">
        {pending ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" onClick={cancelar} className="text-[12.5px] font-semibold text-tinta-suave underline">
        Cancelar
      </button>
      {error && (
        <p id={`${base}-error`} role="alert" className="w-full text-[12.5px] text-error">
          {error}
        </p>
      )}
    </form>
  );
}
