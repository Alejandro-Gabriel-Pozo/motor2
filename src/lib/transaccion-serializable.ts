import type { Prisma } from "@prisma/client";
import { errorConocidoDeBase } from "@/core/datos/errores-de-base";
import { conReintento, esChoqueDeIndiceUnico, esConflictoDeEscritura, type OpcionesEspera } from "@/core/movimientos/public-servidor";
import type { Transaccion } from "@/lib/db-tipos";

// `conTransaccionSerializable` salió de `core/movimientos/con-reintento.ts` (Hito 5, pieza 5.3 de docs/plan-hito-5-pureza.md; O.32 de `movimientos`): abre la transacción (`Transaccion`, un tipo de Prisma) y
// escribe en la consola, y eso no es dominio. Mudanza pura: mismo nombre, firma, opciones y logs. En `core/movimientos/con-reintento.ts` quedaron solo los dos CLASIFICADORES de errores
// (`esConflictoDeEscritura`, `esChoqueDeIndiceUnico`), que son puros y que la consola de plataforma también importa por la fachada; el ciclo de reintento sigue en `core/movimientos/reintentar.ts`.
// Como `lib/correo`, `lib/azar` y `lib/db-tipos`: infraestructura transversal que usan los casos de uso. Una Server Action ya migrada NO la importa (regla `accion-migrada-sin-orquestacion`): pasa por su caso de uso.
// Sin `import "server-only"`, como el resto de la orquestación que venía de `core` (la cargan tests y scripts con `tsx` fuera de Next).

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
 * Reintenta, con backoff y jitter entre intentos (ver reintentar.ts), un
 * conflicto de escritura de una transacción SERIALIZABLE. El backoff se agregó
 * el 2026-09-21: la causa del flake de C2 estaba confirmada (5 intentos sin
 * ninguna espera, docs/auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md).
 *
 * Los logs "[con-reintento][investigacion]" quedan como la forma de medir si
 * alcanzó: `esperaTotalMs` dice cuánto se esperó en total. El criterio de cierre
 * real NO es que la suite pase (el flake era de ~0,3 %): es que "agotó los
 * reintentos" deje de aparecer en los logs de producción.
 *
 * POR QUÉ 8 INTENTOS Y NO 5 (2026-10-13). Con 5, el CI de GitHub (job «Integración
 * parte 2 de 4», dos corridas del mismo commit) agotó los reintentos en
 * `test/pos/cuenta-concurrencia.test.ts` («3 cierres de mesas distintas de la misma
 * sucursal a la vez»): P2034 con `esperaTotalMs` de solo 47 y 54 ms. Esos son los datos
 * que este comentario pedía. Medición local (Postgres 16, 3 procesos quemando CPU, el
 * mismo cierre de mesas con K cierres a la vez, 20-30 iteraciones por celda): bajo
 * SERIALIZABLE los K contendientes se resuelven de a UNO por ronda (K = 3: un reintento
 * y dos reintentos; K = 6: hasta cuatro), así que la cantidad de intentos que hace falta
 * crece con la cantidad de cierres simultáneos y 5 no alcanza apenas son 6 o más (con 5:
 * 18 de 30 iteraciones con K = 6 y 20 de 20 con K = 8 terminaban en error; con 8: 0 de
 * 30 y 0 de 20, y el peor caso usó 6 intentos). El jitter, en cambio, NO conviene
 * tocarlo: darle un piso a la espera (`techo * (0,5 + 0,5 * azar)`) empeoró la medición
 * (24 y 29 de 30 con K = 6) porque estrecha el rango y vuelve a sincronizar a los
 * contendientes. Peor caso acumulado de espera con 8 intentos: 25 + 50 + 100 + 200 + 3 × 250 =
 * 1125 ms (esperado ~560 ms), muy por debajo del `timeout` de 15 s de cada transacción.
 * El único llamador que pasa un `maxIntentos` propio (la receta, que usa `conReintento` directo) no cambia.
 */
export async function conTransaccionSerializable<T>(
  transaccion: Transaccion,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxIntentos = 8,
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
      // La fuente de azar del jitter: la que se pidió (tests) o la que trae la transacción del borde que la creó.
      aleatorio: opcionesEspera.aleatorio ?? transaccion.aleatorio,
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
