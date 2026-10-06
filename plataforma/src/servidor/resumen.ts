import type { Instalacion } from "../entorno";
import { conTiempoLimite, TOPE_DE_LECTURA_DE_OTRA_BASE_MS } from "./tiempo-limite";

/**
 * El resumen del inicio de la consola, instalación por instalación (ADR-025). Cada una se lee por separado y con un tope de tiempo: una base caída o lenta no puede dejar sin inicio
 * a las demás (la tarjeta de la que falla dice que no se pudo leer y el resto anda). PURO: la lectura entra por parámetro, así que se prueba sin base.
 */
export interface LecturaDeInstalacion {
  pendientes: number;
  /** Las migraciones aplicadas en esa base, o `null` si no se pudieron leer (sin el GRANT todavía, o la tabla no existe): ver `migraciones.ts`. */
  migraciones: readonly string[] | null;
}

/** Atrasada respecto de OTRA instalación: le faltan migraciones que esa otra ya tiene. Puramente informativo (ADR-025). */
export interface AtrasoDeMigraciones {
  respectoDe: string;
  faltan: number;
  masNueva: string;
}

export type ResumenDeInstalacion =
  | { instalacion: Instalacion; estado: "ok"; pendientes: number; atraso: AtrasoDeMigraciones | null }
  | { instalacion: Instalacion; estado: "caida" };

/**
 * Para cada instalación con migraciones leídas, si le falta alguna que otra instalación (también leída) ya tiene, marca el atraso respecto de la que
 * más le falta. Una instalación caída o sin lectura de migraciones (`null`) no participa ni como referencia ni como atrasada.
 */
export function marcarAtrasos(lecturas: ReadonlyArray<{ instalacion: Instalacion; migraciones: readonly string[] | null }>): Map<string, AtrasoDeMigraciones | null> {
  const conMigraciones = lecturas.filter((l): l is { instalacion: Instalacion; migraciones: readonly string[] } => l.migraciones !== null);
  const resultado = new Map<string, AtrasoDeMigraciones | null>(lecturas.map((l) => [l.instalacion.id, null]));

  for (const actual of conMigraciones) {
    const aplicadas = new Set(actual.migraciones);
    let peorContraste: { respectoDe: string; faltantes: string[] } | null = null;
    for (const otra of conMigraciones) {
      if (otra.instalacion.id === actual.instalacion.id) continue;
      const faltantes = otra.migraciones.filter((m) => !aplicadas.has(m));
      if (faltantes.length > 0 && (!peorContraste || faltantes.length > peorContraste.faltantes.length)) {
        peorContraste = { respectoDe: otra.instalacion.nombre, faltantes };
      }
    }
    if (peorContraste) {
      const masNueva = [...peorContraste.faltantes].sort().at(-1)!;
      resultado.set(actual.instalacion.id, { respectoDe: peorContraste.respectoDe, faltan: peorContraste.faltantes.length, masNueva });
    }
  }
  return resultado;
}

export async function resumenDeInstalaciones(
  instalaciones: readonly Instalacion[],
  leer: (instalacion: Instalacion) => Promise<LecturaDeInstalacion>,
  tope = TOPE_DE_LECTURA_DE_OTRA_BASE_MS,
): Promise<ResumenDeInstalacion[]> {
  const resultados = await Promise.allSettled(instalaciones.map((i) => conTiempoLimite(leer(i), tope)));
  const lecturas = instalaciones.map((instalacion, n) => ({ instalacion, resultado: resultados[n] }));
  const atrasos = marcarAtrasos(
    lecturas.flatMap(({ instalacion, resultado }) => (resultado.status === "fulfilled" ? [{ instalacion, migraciones: resultado.value.migraciones }] : [])),
  );
  return lecturas.map(({ instalacion, resultado }): ResumenDeInstalacion =>
    resultado.status === "fulfilled"
      ? { instalacion, estado: "ok", pendientes: resultado.value.pendientes, atraso: atrasos.get(instalacion.id) ?? null }
      : { instalacion, estado: "caida" },
  );
}
