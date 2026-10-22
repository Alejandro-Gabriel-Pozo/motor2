"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { EventoHistorialProducto } from "@/core/reportes/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

interface PuntoSaldo {
  fecha: string;
  saldo: number;
}

/** Solo los eventos de movimiento tienen saldoCorriente (ver docstring en historial-producto.ts) — un conteo no mueve el saldo real. */
function armarSerie(eventos: EventoHistorialProducto[], zona: string): PuntoSaldo[] {
  return eventos
    .filter((ev) => ev.tipo === "movimiento" && ev.saldoCorriente != null)
    .map((ev) => ({ fecha: diaDeCalendario(ev.fecha, zona), saldo: ev.saldoCorriente! }));
}

/** `zona`: la de la empresa (la página pasa `ctx.empresaZonaHoraria`), para el día de cada punto; sin ella, la argentina. */
export function GraficoSaldoCorriente({ eventos, unidadStockNombre, zona = ZONA_ARGENTINA }: { eventos: EventoHistorialProducto[]; unidadStockNombre: string; zona?: string }) {
  const serie = armarSerie(eventos, zona);

  if (serie.length < 2) {
    return <p className="text-sm text-tinta-tenue">Sin suficientes movimientos en el rango para graficar la evolución del saldo.</p>;
  }

  return (
    <div className="h-64 w-full max-w-4xl text-xs text-tinta-tenue">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} />
          <XAxis dataKey="fecha" stroke="currentColor" tick={{ fill: "currentColor" }} />
          <YAxis stroke="currentColor" tick={{ fill: "currentColor" }} width={60} />
          <Tooltip
            formatter={(value) => [`${value} ${unidadStockNombre}`, "Saldo"]}
            contentStyle={{ background: "var(--background)", color: "var(--foreground)", border: "1px solid currentColor" }}
          />
          <Line type="stepAfter" dataKey="saldo" stroke="var(--color-marca)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
