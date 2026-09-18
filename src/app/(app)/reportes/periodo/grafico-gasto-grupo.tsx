"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import type { FilaGastoPorGrupo } from "@/core/reportes/periodo";

/**
 * "¿En qué se me va la plata?" (Grocy "Spendings", ver docs/grounding-
 * reportes-compras-2026-09-18.md) — barras horizontales, no torta: con
 * más de 4-5 categorías una torta deja de ser legible, un ranking de
 * barras sigue siendo comparable. Un solo color (magnitud, no identidad)
 * — mismo azul que ya usa GraficoSaldoCorriente, para no introducir una
 * segunda paleta en la misma app.
 */
export function GraficoGastoPorGrupo({ filas }: { filas: FilaGastoPorGrupo[] }) {
  if (filas.length < 2) return null; // con 0-1 categoría el gráfico no aporta nada sobre la tabla

  const datos = filas.slice(0, 10).map((f) => ({ grupo: f.grupo, importe: f.importe }));

  return (
    <div className="h-64 w-full max-w-2xl text-neutral-500 dark:text-neutral-400">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ top: 8, right: 32, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} horizontal={false} />
          <XAxis type="number" stroke="currentColor" tick={{ fill: "currentColor", fontSize: 12 }} />
          <YAxis type="category" dataKey="grupo" stroke="currentColor" tick={{ fill: "currentColor", fontSize: 12 }} width={110} />
          <Tooltip
            formatter={(value) => [`$${Number(value).toLocaleString("es-AR")}`, "Gastado"]}
            contentStyle={{ background: "var(--background)", color: "var(--foreground)", border: "1px solid currentColor", fontSize: 12 }}
          />
          <Bar dataKey="importe" fill="#3b82f6" radius={[0, 4, 4, 0]}>
            <LabelList dataKey="importe" position="right" formatter={(v: React.ReactNode) => `$${Number(v).toLocaleString("es-AR")}`} fill="currentColor" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
