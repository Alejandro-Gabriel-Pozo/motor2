import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo que la sincronización del IPC lee y escribe de `IndicePrecio` (Pureza Fase 4, tramo C). `IndicePrecio` es GLOBAL (sin empresa): un dato de una fuente externa (INDEC) que
 * sincroniza un cron; nadie lo edita a mano. Mudadas TAL CUAL desde `core/reportes/indices-economicos.ts`.
 */

/** Los meses ya guardados (la fecha de cada fila), para no volver a insertarlos. */
export async function cargarMesesDelIPC(db: Db): Promise<Date[]> {
  return (await db.indicePrecio.findMany({ select: { mes: true } })).map((f) => f.mes);
}

/** Inserta UN mes nuevo. NUNCA se reescribe un mes ya guardado: el IPC de un mes cerrado no cambia, y si alguna vez el INDEC revisa un dato, que sea una decisión explícita. */
export async function insertarMesDelIPC(db: Db, fila: { mes: Date; valor: number }): Promise<void> {
  await db.indicePrecio.create({ data: { mes: fila.mes, valor: fila.valor } });
}
