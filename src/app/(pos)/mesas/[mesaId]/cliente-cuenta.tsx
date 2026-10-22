"use client";

import { useId, useState } from "react";
import { asignarClienteACuenta } from "@/server/actions/pos/cuenta-apertura";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Selector } from "@/ui/primitivas/selector";
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
      <span className="inline-flex items-center gap-1.5 text-sm text-tinta-suave">
        {clienteNombre ? `Cliente: ${clienteNombre} (−${descuentoPorcentaje}%)` : "Sin cliente"}
        {puede && (
          <Boton variante="enlace" tamano="en-fila" onClick={abrir}>
            {clienteNombre ? "Cambiar" : "Asignar cliente"}
          </Boton>
        )}
      </span>
    );
  }

  return (
    <form onSubmit={guardar} className="inline-flex flex-wrap items-center gap-1.5">
      <Selector id={`${base}-cliente`} etiqueta="Cliente" etiquetaOculta tamano="compacto" autoFocus value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
        <option value="">Sin cliente</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre} (−{c.descuentoPorcentaje}%)
          </option>
        ))}
      </Selector>
      <Boton type="submit" variante="secundario" tamano="compacto" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Boton>
      <Boton variante="secundario" tamano="compacto" onClick={cancelar}>
        Cancelar
      </Boton>
      {error && (
        <Aviso variante="error" forma="en-linea">
          {error}
        </Aviso>
      )}
    </form>
  );
}
