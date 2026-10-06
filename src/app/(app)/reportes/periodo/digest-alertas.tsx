import { EnlaceInterno } from "@/components/enlace-interno";
import type { FilaAlertaDigest } from "@/core/reportes/periodo";

/**
 * Paso 3 del grounding (segunda pasada, docs/grounding-reportes-compras-
 * 2026-09-18.md §5): siempre visible, sin configuración — "un dueño de
 * pizzería chica no lee mails de su ERP". Server Component puro (los
 * textos ya vienen armados de `generarDigestAlertas`), no necesita
 * interactividad.
 */
/** `puedeVerCostos`: la alerta de margen objetivo lleva a Costos solo si quien mira tiene ese reporte. */
export function DigestAlertas({ alertas, puedeVerCostos }: { alertas: FilaAlertaDigest[]; puedeVerCostos: boolean }) {
  if (!alertas.length) return null;

  return (
    <ul className="flex flex-col gap-1.5 rounded border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
      {alertas.map((a, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={a.severidad === "alta" ? "text-red-600" : "text-amber-700 dark:text-amber-600"}>{a.severidad === "alta" ? "●" : "○"}</span>
          <span className="text-neutral-700 dark:text-neutral-300">
            {a.texto}
            {a.destino === "costos" && puedeVerCostos && (
              <>
                {" "}
                <EnlaceInterno href="/reportes/costos" className="underline">
                  Ver en Costos
                </EnlaceInterno>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
