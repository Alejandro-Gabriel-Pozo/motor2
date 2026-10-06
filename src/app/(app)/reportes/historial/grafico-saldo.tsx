"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { EventoHistorialProducto } from "@/core/reportes/public";

interface PuntoSaldo {
  fecha: string;
  saldo: number;
}

/** Solo los eventos de movimiento tienen saldoCorriente (ver docstring en historial-producto.ts) — un conteo no mueve el saldo real. */
function armarSerie(eventos: EventoHistorialProducto[]): PuntoSaldo[] {
  return eventos
    .filter((ev) => ev.tipo === "movimiento" && ev.saldoCorriente != null)
    .map((ev) => ({ fecha: ev.fecha.toISOString().slice(0, 10), saldo: ev.saldoCorriente! }));
}

export function GraficoSaldoCorriente({ eventos, unidadStockNombre }: { eventos: EventoHistorialProducto[]; unidadStockNombre: string }) {
  const serie = armarSerie(eventos);

  if (serie.length < 2) {
    return <p className="text-sm text-neutral-500">Sin suficientes movimientos en el rango para graficar la evolución del saldo.</p>;
  }

  return (
    <div className="h-64 w-full max-w-4xl text-neutral-500 dark:text-neutral-400">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} />
          <XAxis dataKey="fecha" stroke="currentColor" tick={{ fill: "currentColor", fontSize: 12 }} />
          <YAxis stroke="currentColor" tick={{ fill: "currentColor", fontSize: 12 }} width={60} />
          <Tooltip
            formatter={(value) => [`${value} ${unidadStockNombre}`, "Saldo"]}
            contentStyle={{ background: "var(--background)", color: "var(--foreground)", border: "1px solid currentColor", fontSize: 12 }}
          />
          <Line type="stepAfter" dataKey="saldo" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
