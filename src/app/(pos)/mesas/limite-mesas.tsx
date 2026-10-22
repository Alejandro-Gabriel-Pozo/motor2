"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { actualizarMaxMesasAbiertas } from "@/server/actions/pos/mesas";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

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
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-sm text-tinta-tenue">
        {texto}
        {puedeEditar && (
          <Boton variante="enlace" tamano="en-fila" onClick={abrir}>
            Editar límite
          </Boton>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <label htmlFor={`${base}-limite`} className="text-xs font-semibold text-tinta-tenue">
        Máx. mesas abiertas
      </label>
      <div className="w-24">
        <Campo
          id={`${base}-limite`}
          nombradoPorFuera
          tamano="compacto"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="Sin límite"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onFocus={(e) => e.target.select()}
          invalido={Boolean(error)}
        />
      </div>
      <Boton type="submit" variante="secundario" tamano="compacto" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Boton>
      <Boton variante="enlace" tamano="en-fila" onClick={cancelar}>
        Cancelar
      </Boton>
      {error && (
        <Aviso id={`${base}-error`} variante="error" forma="en-linea" className="w-full">
          {error}
        </Aviso>
      )}
    </form>
  );
}
