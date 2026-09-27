"use client";

import { useId, useState } from "react";
import { asignarClienteACuenta } from "@/server/actions/pos/cuenta-apertura";
import { BOTON_CHICO, BOTON_SECUNDARIO, CAMPO } from "./estilos";
import { useAccionMesa } from "./usar-accion";

export interface ClienteParaAsignar {
  id: string;
  nombre: string;
  descuentoPorcentaje: number;
}

/**
 * Cliente con descuento de la cuenta ABIERTA (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D3): CUALQUIER mozo con
 * `pos_asignar_cliente` (se semilla junto con `pos_tomar_pedido`) lo asigna, cambia o quita, en cualquier momento antes de
 * cerrarla — mismo patrón «Editar» inline que `ComensalesCuenta`. `clientes` son los ACTIVOS de la sucursal (server: `listarClientes
 * (true)`), ya con `descuentoPorcentaje` convertido a `number` (un `Decimal` de Prisma no se puede pasar a un Client Component).
 */
export function ClienteCuenta({
  cuentaId,
  clienteId,
  clienteNombre,
  descuentoPorcentaje,
  clientes,
  puede,
}: {
  cuentaId: string;
  clienteId: string | null;
  clienteNombre: string | null;
  descuentoPorcentaje: number | null;
  clientes: readonly ClienteParaAsignar[];
  puede: boolean;
}) {
  const { ejecutar, pending, error, setError } = useAccionMesa();
  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState("");
  const base = useId();

  const abrir = () => {
    setSeleccion(clienteId ?? "");
    setError(null);
    setEditando(true);
  };
  const cancelar = () => {
    if (!pending) setEditando(false);
  };
  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    ejecutar(
      () => asignarClienteACuenta(cuentaId, seleccion || null),
      () => setEditando(false)
    );
  };

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--ink-soft)]">
        {clienteNombre ? `Cliente: ${clienteNombre} (−${descuentoPorcentaje}%)` : "Sin cliente"}
        {puede && (
          <button type="button" onClick={abrir} className="text-[12.5px] font-semibold underline hover:text-[var(--ink)]">
            {clienteNombre ? "Cambiar" : "Asignar cliente"}
          </button>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <label htmlFor={`${base}-cliente`} className="sr-only">
        Cliente
      </label>
      <select id={`${base}-cliente`} autoFocus value={seleccion} onChange={(e) => setSeleccion(e.target.value)} className={`${CAMPO} py-1 text-[13px]`}>
        <option value="">Sin cliente</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre} (−{c.descuentoPorcentaje}%)
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={BOTON_CHICO}>
        {pending ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" onClick={cancelar} className={BOTON_SECUNDARIO}>
        Cancelar
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
