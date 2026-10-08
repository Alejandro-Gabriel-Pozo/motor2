import "server-only";
import type { CotizacionDia } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo que la sincronización del dólar lee y escribe de `CotizacionDia` (Pureza Fase 4, tramo C). `CotizacionDolar` es GLOBAL (sin empresa): un dato de una fuente externa que
 * sincroniza un cron, una fila por día y fuente; nadie lo edita a mano. Mudadas TAL CUAL desde `core/reportes/cotizacion-dolar.ts`; la orquestación (cuándo rellenar, qué
 * fuente probar, qué descartar) es del caso de uso `sincronizar-dolar.ts`.
 */

/** La última cotización de BNA guardada, para decidir si hay que rellenar el historial y para comparar contra ella el primer día que se rellena (S-30). `null` si no hay ninguna. */
export async function cargarUltimaCotizacionBna(db: Db): Promise<{ fecha: Date; venta: number } | null> {
  const fila = await db.cotizacionDolar.findFirst({ where: { fuente: "BNA" }, orderBy: { fecha: "desc" }, select: { fecha: true, venta: true } });
  return fila ? { fecha: fila.fecha, venta: Number(fila.venta) } : null;
}

/** La cotización guardada inmediatamente ANTERIOR al día dado (la de BNA gana el empate de fecha), para comparar un salto. `null` si no hay. */
export async function cargarCotizacionAnterior(db: Db, fechaISO: string): Promise<{ fecha: Date; venta: number } | null> {
  const fila = await db.cotizacionDolar.findFirst({ where: { fecha: { lt: new Date(fechaISO) } }, orderBy: [{ fecha: "desc" }, { fuente: "desc" }] });
  return fila ? { fecha: fila.fecha, venta: Number(fila.venta) } : null;
}

/** Guarda (o actualiza) la cotización de un día: un `upsert` por (día, fuente), así que repetir la corrida no ensucia nada. */
export async function guardarDiaDeCotizacion(db: Db, dia: CotizacionDia): Promise<void> {
  const fecha = new Date(dia.fecha); // medianoche UTC del día: mismo criterio que el resto del proyecto
  await db.cotizacionDolar.upsert({
    where: { fecha_fuente: { fecha, fuente: dia.fuente } },
    create: { fecha, fuente: dia.fuente, compra: dia.compra, venta: dia.venta },
    update: { compra: dia.compra, venta: dia.venta },
  });
}
