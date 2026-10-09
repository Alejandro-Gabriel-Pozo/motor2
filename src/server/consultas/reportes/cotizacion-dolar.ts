import "server-only";
import type { UltimaCotizacion } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

/**
 * La lectura del dólar para las pantallas (Pureza Fase 4, tramo C): mudada TAL CUAL desde `core/reportes/cotizacion-dolar.ts`. Quien lo ESCRIBE es el caso de uso
 * `sincronizar-dolar.ts`; el cálculo (pesos → dólares, si está vencida) es puro y vive en `core/reportes/cotizacion-dolar.ts`.
 */

/** La cotización más reciente guardada (la de BNA si hay; si no, la del BCRA), o `null` si todavía no hay ninguna. */
export async function obtenerUltimaCotizacion(db: Db): Promise<UltimaCotizacion | null> {
  const fila = await db.cotizacionDolar.findFirst({ orderBy: [{ fecha: "desc" }, { fuente: "desc" }] });
  if (!fila) return null;
  return { fecha: fila.fecha, compra: fila.compra !== null ? Number(fila.compra) : null, venta: Number(fila.venta), fuente: fila.fuente };
}

/**
 * Para las pantallas: el dólar es un extra (la equivalencia en US$), así que si la lectura falla la pantalla sigue sin él. Pero un fallo
 * NO se traga en silencio: queda en Sentry (una vez por arranque, para no gastar la cuota si la base está caída y todas las pantallas lo piden).
 */
export async function obtenerUltimaCotizacionSinRomper(db: Db): Promise<UltimaCotizacion | null> {
  try {
    return await obtenerUltimaCotizacion(db);
  } catch (e) {
    await reportarErrorUnaVez("cotizacion-lectura", e, "dolar-lectura");
    return null;
  }
}
