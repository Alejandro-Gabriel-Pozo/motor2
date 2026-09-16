import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Toda escritura de esta porción (registrarMovimiento/registrarVenta/
 * registrarConteoFisico/...) suma el Kardex para validar stock y recién
 * después escribe, DENTRO de la misma transacción — el equivalente real de
 * `conLock_`/`LockService` (Apps Script: un lock global de script que
 * serializaba TODA escritura, ver Movimientos.js). Acá no hay un lock de
 * aplicación: se usa aislamiento SERIALIZABLE (Postgres aborta la
 * transacción — código P2034 — si detecta que el resultado no sería
 * serializable frente a otra transacción concurrente) + reintento, mismo
 * criterio que ya usa este proyecto para P2002 (crearConCodigoAutogenerado,
 * porción Catálogo) y el choque de versión de receta (guardarReceta): dejar
 * que Postgres sea el árbitro final en vez de un lock de aplicación, que
 * solo protege dentro de un mismo proceso Node.
 */
export async function conTransaccionSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxIntentos = 5
): Promise<T> {
  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Default de Prisma (maxWait 2s / timeout 5s) es corto para el caso
        // de latencia de red más alta de lo normal — esto da más margen sin
        // dejar una transacción SERIALIZABLE colgada minutos si algo se
        // cuelga de verdad (eso bloquearía filas para otros usuarios reales
        // más de lo necesario).
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (e) {
      const esConflicto = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (esConflicto && intento < maxIntentos - 1) continue;
      throw e;
    }
  }
  throw new Error("No se pudo completar la operación tras varios intentos (conflicto de escritura concurrente).");
}
