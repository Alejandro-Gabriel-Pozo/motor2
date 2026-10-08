import { causaDeErrorDeDriver, esErrorDeBaseConCodigo, esFalloDeSerializacionEnSqlCrudo } from "@/core/datos/errores-de-base";

// Los dos CLASIFICADORES de errores de la transacción serializable (puros: reciben un error y dicen qué es). `conTransaccionSerializable`, que abre la transacción (`Transaccion`, un tipo de Prisma)
// y escribe en la consola, salió a `src/lib/transaccion-serializable.ts` en el Hito 5 (pieza 5.3 de docs/plan-hito-5-pureza.md): este archivo quedó P0. Los clasificadores se quedan en `core`
// (y no van a `server/`) porque la consola de plataforma importa `esChoqueDeIndiceUnico` por la fachada y no puede importar `src/server`.

/**
 * Hallazgo de auditoría (Pivote 1, docs/auditoria-motor2-pivotes-2026-09-16.md
 * §11 Plan 2): no todos los conflictos de serialización reales de Postgres
 * llegan como Prisma.PrismaClientKnownRequestError con code "P2034". Con
 * @prisma/adapter-pg (Prisma 7), un conflicto detectado en un punto
 * distinto de la transacción (confirmado empíricamente: en el COMMIT, no
 * en una sentencia individual) se propaga como un DriverAdapterError
 * crudo — una clase de @prisma/driver-adapter-utils, NO instancia de
 * PrismaClientKnownRequestError — con `name === "DriverAdapterError"` y
 * `cause.kind === "TransactionWriteConflict"` (confirmado leyendo
 * node_modules/@prisma/adapter-pg/dist/index.mjs: ese `kind` es el único
 * mapeo de los SQLSTATE 40001 "serialization_failure" y 40P01
 * "deadlock_detected" — nunca de un error de conexión, timeout u otro
 * problema real). Reproducido de forma intermitente en registrarMovimiento
 * y registrarVenta (test/auditoria/concurrencia-idempotencia.test.ts,
 * concurrencia-casos-2-3.test.ts).
 *
 * No se usa `isDriverAdapterError`/`DriverAdapterError` de
 * @prisma/driver-adapter-utils (que expone exactamente este chequeo) para
 * no agregar ese paquete como dependencia directa — hoy es transitivo de
 * @prisma/adapter-pg. El chequeo por forma de abajo es equivalente: solo
 * reconoce el `kind` puntual del conflicto de escritura, nunca cualquier
 * DriverAdapterError (evita enmascarar un error real de infraestructura,
 * ej. una conexión caída, reintentándolo como si fuera un conflicto).
 */
export function esConflictoDeEscritura(e: unknown): boolean {
  if (esErrorDeBaseConCodigo(e, "P2034")) return true;
  if (esFalloDeSerializacionEnSqlCrudo(e)) return true; // un 40001/40P01 de un `$executeRaw` llega como P2010 (ver su docstring)
  return causaDeErrorDeDriver(e)?.kind === "TransactionWriteConflict";
}

/**
 * Un choque de índice ÚNICO (SQLSTATE 23505): `P2002` de Prisma, o el `DriverAdapterError` crudo con `cause.kind === "UniqueConstraintViolation"`.
 * Dentro de una transacción SERIALIZABLE, dos pedidos que leen el mismo estado y luego insertan la misma clave única no siempre reciben el 40001: si el
 * índice único no fue parte de lo que leyeron, el perdedor recibe directamente el 23505 (confirmado: `MovimientoStock_traspaso_paso_unico_key` en el reingreso
 * simultáneo de un traspaso). Para ese perdedor es lo mismo que un conflicto de serialización: al repetir ve el estado que dejó el ganador y responde el resultado
 * de negocio que corresponde. Ver el parámetro `tambienChoqueDeUnico` de `conTransaccionSerializable` (`src/lib/transaccion-serializable.ts`).
 */
export function esChoqueDeIndiceUnico(e: unknown): boolean {
  if (esErrorDeBaseConCodigo(e, "P2002")) return true;
  return causaDeErrorDeDriver(e)?.kind === "UniqueConstraintViolation";
}
