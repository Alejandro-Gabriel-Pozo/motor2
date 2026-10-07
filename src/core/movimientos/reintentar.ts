/**
 * Loop de reintento genérico, SIN dependencias (ni Prisma ni base de datos):
 * `con-reintento.ts` es el envoltorio que sabe de Prisma y de qué error cuenta
 * como conflicto de escritura; acá vive solo el ciclo. Separado a propósito:
 * `con-reintento.ts` importa `@/lib/db`, que construye el cliente al importarse,
 * y un test del ciclo no tiene por qué depender de eso.
 *
 * BACKOFF CON JITTER (entre intentos, nunca antes del primero ni después del
 * último). Causa confirmada del flake de C2 (docs/auditoria-motor2-deuda-tecnica-
 * flake-eslint-2026-09-17.md, "causa confirmada: rama P2034"): dos transacciones
 * SERIALIZABLE que chocan reintentaban de inmediato, casi en el mismo instante,
 * y volvían a chocar en los 5 de 5 intentos. Esperar lo MISMO no lo arregla (dos
 * contendientes que esperan igual vuelven a sincronizarse): hace falta que cada
 * uno espere un tiempo distinto. Por eso es jitter COMPLETO —
 * `aleatorio() * min(tope, base * 2^intento)` — y no un backoff puro.
 *
 * Con base 25 ms y tope 250 ms el techo de espera antes de cada reintento es
 * 25, 50, 100 y 200 ms (peor caso acumulado 375 ms; esperado ~187 ms). Es del
 * orden de lo que tarda una de estas transacciones, que es lo que hace falta
 * para decorrelar a los dos contendientes, y queda muy por debajo del
 * `timeout` de 15 s de la propia transacción.
 */

const ESPERA_BASE_MS = 25;
const ESPERA_TOPE_MS = 250;
/**
 * Sin una fuente de azar inyectada, la espera usa la MITAD del techo (determinista). El núcleo no lee el azar por su cuenta (Pureza 1.5): en producción la fuente la pone el borde que
 * crea la transacción (`Transaccion.aleatorio`, `core/auth/base.ts`); sin ella solo quedan los tests con transacciones armadas a mano.
 */
const ESPERA_A_LA_MITAD = () => 0.5;

export interface InfoReintento {
  /** Número de intento que acaba de terminar (0 = el primero). */
  intento: number;
  maxIntentos: number;
  /** Suma de lo esperado entre intentos, en ms: el dato que faltaba para decidir si `maxIntentos` alcanza. */
  esperaTotalMs: number;
}

export interface OpcionesEspera {
  /** Techo de la espera antes del primer reintento; se duplica en cada uno. */
  baseEsperaMs?: number;
  /** Techo absoluto de una espera individual. */
  topeEsperaMs?: number;
  /** Fuente de aleatoriedad en [0, 1). Inyectable para poder probar valores exactos. */
  aleatorio?: () => number;
  /** Cómo esperar. Inyectable: los tests no usan temporizadores reales. */
  dormir?: (ms: number) => Promise<void>;
}

export interface ConfigReintento extends OpcionesEspera {
  maxIntentos: number;
  /** ¿Este error vale la pena reintentarlo? Cualquier otro se propaga en el acto. */
  esReintentable: (e: unknown) => boolean;
  /** Se llama cuando la operación tuvo éxito DESPUÉS de haber fallado al menos una vez. */
  alResolverPorReintento?: (info: InfoReintento) => void;
  /** Se llama cuando se agotan los intentos, justo antes de relanzar el último error. */
  alAgotar?: (e: unknown, info: InfoReintento) => void;
}

/**
 * Cuánto esperar después de que falló el intento número `intento` (0 = el
 * primero) y antes del siguiente. Pura: recibe todo lo que usa.
 */
export function calcularEsperaBackoffMs(
  intento: number,
  { baseMs = ESPERA_BASE_MS, topeMs = ESPERA_TOPE_MS, aleatorio = ESPERA_A_LA_MITAD }: { baseMs?: number; topeMs?: number; aleatorio?: () => number } = {}
): number {
  return aleatorio() * Math.min(topeMs, baseMs * 2 ** intento);
}

const dormirDeVerdad = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

export async function conReintento<T>(operacion: () => Promise<T>, config: ConfigReintento): Promise<T> {
  const { maxIntentos, esReintentable, baseEsperaMs, topeEsperaMs, aleatorio, dormir = dormirDeVerdad } = config;
  let esperaTotalMs = 0;
  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      const resultado = await operacion();
      if (intento > 0) config.alResolverPorReintento?.({ intento, maxIntentos, esperaTotalMs });
      return resultado;
    } catch (e) {
      if (esReintentable(e)) {
        if (intento < maxIntentos - 1) {
          // La espera vive DENTRO del catch: el camino feliz (el 99,99 % de los
          // casos, sin conflicto) no toca ningún temporizador.
          const espera = calcularEsperaBackoffMs(intento, { baseMs: baseEsperaMs, topeMs: topeEsperaMs, aleatorio });
          esperaTotalMs += espera;
          await dormir(espera);
          continue;
        }
        config.alAgotar?.(e, { intento, maxIntentos, esperaTotalMs });
      }
      throw e;
    }
  }
  throw new Error("No se pudo completar la operación tras varios intentos (conflicto de escritura concurrente).");
}
