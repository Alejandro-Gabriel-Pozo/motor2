import type { Prisma } from "@prisma/client";
import { causaDeErrorDeDriver, errorConocidoDeBase, esErrorDeBaseConCodigo } from "@/core/datos/errores-de-base";
import type { Transaccion } from "@/lib/db-tipos";
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
  if (esErrorDeBaseConCodigo(e, "P2034")) return true;
  return causaDeErrorDeDriver(e)?.kind === "TransactionWriteConflict";
}

/**
 * Un choque de índice ÚNICO (SQLSTATE 23505): `P2002` de Prisma, o el `DriverAdapterError` crudo con `cause.kind === "UniqueConstraintViolation"`.
 * Dentro de una transacción SERIALIZABLE, dos pedidos que leen el mismo estado y luego insertan la misma clave única no siempre reciben el 40001: si el
 * índice único no fue parte de lo que leyeron, el perdedor recibe directamente el 23505 (confirmado: `MovimientoStock_traspaso_paso_unico_key` en el reingreso
 * simultáneo de un traspaso). Para ese perdedor es lo mismo que un conflicto de serialización: al repetir ve el estado que dejó el ganador y responde el resultado
 * de negocio que corresponde. Ver el parámetro `tambienChoqueDeUnico` de `conTransaccionSerializable`.
 */
export function esChoqueDeIndiceUnico(e: unknown): boolean {
  if (esErrorDeBaseConCodigo(e, "P2002")) return true;
  return causaDeErrorDeDriver(e)?.kind === "UniqueConstraintViolation";
}

/**
 * Reintenta, con backoff y jitter entre intentos (ver reintentar.ts), un
 * conflicto de escritura de una transacción SERIALIZABLE. El backoff se agregó
 * el 2026-09-21: la causa del flake de C2 estaba confirmada (5 intentos sin
 * ninguna espera, docs/auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md).
 *
 * Los logs "[con-reintento][investigacion]" quedan como la forma de medir si
 * alcanzó: `esperaTotalMs` dice cuánto se esperó en total. El criterio de cierre
 * real NO es que la suite pase (el flake era de ~0,3 %): es que "agotó los
 * reintentos" deje de aparecer en los logs de producción. Si vuelve a aparecer,
 * recién ahí se decide subir `maxIntentos` — aparte, y con esos datos.
 */
export async function conTransaccionSerializable<T>(
  transaccion: Transaccion,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxIntentos = 5,
  /** Solo para tests: la espera entre reintentos y su aleatoriedad (ver reintentar.ts). */
  opcionesEspera: OpcionesEspera = {},
  /**
   * `true` SOLO para un caso de uso del tipo «leo el estado, valido y recién después inserto una clave única» (el reingreso de un traspaso, el ticket corregido):
   * ahí un choque de índice único es la carrera perdida y repetir da el resultado de negocio. NO se enciende donde el choque de unicidad es una regla de negocio
   * que el caso de uso traduce a su mensaje (factura única, código duplicado): repetir solo demoraría el mismo rechazo.
   */
  tambienChoqueDeUnico = false
): Promise<T> {
  return conReintento(
    () =>
      transaccion(fn, {
        isolationLevel: "Serializable",
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
      esReintentable: tambienChoqueDeUnico ? (e) => esConflictoDeEscritura(e) || esChoqueDeIndiceUnico(e) : esConflictoDeEscritura,
      // console.log, no .warn: un solo reintento resuelto es el camino
      // sano de SERIALIZABLE ante dos escrituras genuinamente
      // simultáneas — esperable y frecuente, no un incidente. No
      // corresponde que dispare alertas en Vercel.
      alResolverPorReintento: ({ intento, esperaTotalMs }) =>
        console.log("[con-reintento][investigacion] conflicto de escritura resuelto por reintento", {
          intento,
          maxIntentos,
          esperaTotalMs: Math.round(esperaTotalMs),
        }),
      alAgotar: (e, { esperaTotalMs }) =>
        console.error("[con-reintento][investigacion] conflicto de escritura agotó los reintentos", {
          maxIntentos,
          esperaTotalMs: Math.round(esperaTotalMs),
          code: errorConocidoDeBase(e)?.code,
        }),
    }
  );
}
