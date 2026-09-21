/**
 * Loop de reintento genérico, SIN dependencias (ni Prisma ni base de datos):
 * `con-reintento.ts` es el envoltorio que sabe de Prisma y de qué error cuenta
 * como conflicto de escritura; acá vive solo el ciclo. Separado a propósito:
 * `con-reintento.ts` importa `@/lib/db`, que construye el cliente al importarse,
 * y un test del ciclo no tiene por qué depender de eso.
 */

export interface InfoReintento {
  /** Número de intento que acaba de terminar (0 = el primero). */
  intento: number;
  maxIntentos: number;
}

export interface ConfigReintento {
  maxIntentos: number;
  /** ¿Este error vale la pena reintentarlo? Cualquier otro se propaga en el acto. */
  esReintentable: (e: unknown) => boolean;
  /** Se llama cuando la operación tuvo éxito DESPUÉS de haber fallado al menos una vez. */
  alResolverPorReintento?: (info: InfoReintento) => void;
  /** Se llama cuando se agotan los intentos, justo antes de relanzar el último error. */
  alAgotar?: (e: unknown, info: InfoReintento) => void;
}

export async function conReintento<T>(operacion: () => Promise<T>, config: ConfigReintento): Promise<T> {
  const { maxIntentos, esReintentable } = config;
  for (let intento = 0; intento < maxIntentos; intento++) {
    try {
      const resultado = await operacion();
      if (intento > 0) config.alResolverPorReintento?.({ intento, maxIntentos });
      return resultado;
    } catch (e) {
      if (esReintentable(e)) {
        if (intento < maxIntentos - 1) continue;
        config.alAgotar?.(e, { intento, maxIntentos });
      }
      throw e;
    }
  }
  throw new Error("No se pudo completar la operación tras varios intentos (conflicto de escritura concurrente).");
}
