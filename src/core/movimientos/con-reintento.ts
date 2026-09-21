import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { conReintento, type OpcionesEspera } from "./reintentar";

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
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") return true;
  if (e instanceof Error && e.name === "DriverAdapterError") {
    const cause = (e as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "kind" in cause && cause.kind === "TransactionWriteConflict") return true;
  }
  return false;
}

/**
 * INVESTIGACIÓN temporal (2026-09-18, ver
 * docs/auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md — flake de
 * C2): no cambia ningún comportamiento, solo deja rastro en los logs de
 * producción (Vercel) para saber si esto ocurre alguna vez en el uso real y
 * con qué frecuencia — la única evidencia hoy es un test que fuerza
 * concurrencia perfecta en loop, no representativo de dos personas
 * clickeando. Buscar "[con-reintento][investigacion]" en los logs. Retirar
 * (o convertir en una métrica real) una vez que haya datos suficientes para
 * decidir si vale la pena subir `maxIntentos`/agregar backoff.
 */
export async function conTransaccionSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxIntentos = 5,
  /** Solo para tests: la espera entre reintentos y su aleatoriedad (ver reintentar.ts). */
  opcionesEspera: OpcionesEspera = {}
): Promise<T> {
  return conReintento(
    () =>
      prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Default de Prisma (maxWait 2s / timeout 5s) es corto para el caso
        // de latencia de red más alta de lo normal — esto da más margen sin
        // dejar una transacción SERIALIZABLE colgada minutos si algo se
        // cuelga de verdad (eso bloquearía filas para otros usuarios reales
        // más de lo necesario).
        maxWait: 5_000,
        timeout: 15_000,
      }),
    {
      ...opcionesEspera,
      maxIntentos,
      esReintentable: esConflictoDeEscritura,
      // console.log, no .warn: un solo reintento resuelto es el camino
      // sano de SERIALIZABLE ante dos escrituras genuinamente
      // simultáneas — esperable y frecuente, no un incidente. No
      // corresponde que dispare alertas en Vercel.
      alResolverPorReintento: ({ intento }) =>
        console.log("[con-reintento][investigacion] conflicto de escritura resuelto por reintento", { intento, maxIntentos }),
      alAgotar: (e) =>
        console.error("[con-reintento][investigacion] conflicto de escritura agotó los reintentos", {
          maxIntentos,
          code: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined,
        }),
    }
  );
}
