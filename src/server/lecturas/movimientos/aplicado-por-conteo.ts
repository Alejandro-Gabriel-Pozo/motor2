import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo que un conteo físico APLICÓ de verdad al stock (S-04 del plan de endurecimiento de seguridad, tanda T5): la suma con signo de las líneas del Kardex que ese conteo
 * generó (`MovimientoStock.conteoFisicoId`). Es la única fuente de la verdad de «lo aplicado»: `ConteoFisico.diferencia` es lo que el conteo REGISTRÓ (contado menos el
 * saldo del sistema ese día), y no coincide con lo aplicado cuando el conteo quedó pendiente y se cerró como «resuelto» (no se aplicó nada) o con «ajustar» (se aplicó la
 * diferencia contra el saldo de HOY, que `diferencia` no recuerda). La llama `cancelar-conteo-fisico.ts` DENTRO de su transacción (con el `tx`), para que la suma y la
 * reversión vean el mismo estado. 0 si el conteo no generó ninguna línea.
 */
export async function sumaAplicadaPorConteo(db: Db, conteoId: string): Promise<number> {
  const r = await db.movimientoStock.aggregate({ where: { conteoFisicoId: conteoId }, _sum: { cantidad: true } });
  return Number(r._sum.cantidad ?? 0);
}
