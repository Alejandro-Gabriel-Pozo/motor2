import { armarSerieIPC, type SerieIPC } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lee la serie del IPC guardada (Pureza Fase 4, tramo C): mudada TAL CUAL desde `core/reportes/indices-economicos.ts` (`cargarSerieIPC`, mismo nombre y misma firma). La usan las
 * consultas de período (margen y precios) y el caso de uso de la sincronización, que releen la serie guardada. Sin `import "server-only"`: la importa un script.
 *
 * Una sola consulta — se llama UNA vez por reporte, nunca por línea (ver `resolverCoeficienteIPC`, que es puro/en memoria).
 */
export async function cargarSerieIPC(db: Db): Promise<SerieIPC> {
  const filas = await db.indicePrecio.findMany({ orderBy: { mes: "desc" } });
  return armarSerieIPC(filas.map((f) => ({ mes: f.mes, valor: Number(f.valor) })));
}
