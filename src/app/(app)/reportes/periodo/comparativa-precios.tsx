import type { ComparativaPreciosDelPeriodo } from "@/core/reportes/periodo";
import { AyudaIcono } from "@/components/ayuda-campo";

function formatoPct(v: number | null): string {
  if (v === null) return "sin datos";
  return `${v > 0 ? "+" : ""}${v}%`;
}

/**
 * Paso 5 del grounding (segunda pasada, docs/grounding-reportes-compras-
 * 2026-09-18.md §5): 3 números uno al lado del otro en vez de una tabla —
 * es una comparación de 3 puntos, no una lista de filas.
 */
export function ComparativaPrecios({ datos }: { datos: ComparativaPreciosDelPeriodo }) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded border p-4 sm:grid-cols-3">
      <div>
        <p className="text-xs text-neutral-500">Tus insumos</p>
        <p className="text-lg font-semibold">{formatoPct(datos.variacionInsumosPct)}</p>
      </div>
      <div>
        <p className="flex items-center text-xs text-neutral-500">
          Tu carta
          <AyudaIcono texto={datos.avisoCarta} />
        </p>
        <p className="text-lg font-semibold">{formatoPct(datos.variacionCartaPropiaPct)}</p>
      </div>
      <div>
        <p className="flex items-center text-xs text-neutral-500">
          Inflación general (IPC)
          <AyudaIcono texto={datos.avisoIPC} />
        </p>
        <p className="text-lg font-semibold">{formatoPct(datos.variacionIPCPct)}</p>
      </div>
    </div>
  );
}
