"use client";

import { useId, useState } from "react";
import { corregirComensales } from "@/server/actions/pos/cuenta-apertura";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
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
      <span className="inline-flex items-center gap-1.5 text-sm text-tinta-suave">
        {comensales !== null ? `${comensales} comensal${comensales === 1 ? "" : "es"}` : "Comensales: sin datos"}
        {puede && (
          <Boton variante="enlace" tamano="en-fila" onClick={abrir}>
            Editar
          </Boton>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <div className="w-16">
        <Campo
          id={`${base}-comensales`}
          etiqueta="Comensales"
          etiquetaOculta
          tamano="compacto"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          min={1}
          max={99}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onFocus={(e) => e.target.select()}
          invalido={Boolean(error)}
        />
      </div>
      <Boton type="submit" variante="secundario" tamano="compacto" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Boton>
      <Boton variante="secundario" tamano="compacto" onClick={cancelar}>
        Cancelar
      </Boton>
      {error && (
        <Aviso id={`${base}-error`} variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </form>
  );
}
