import type { Instalacion } from "../entorno";

/**
 * El resumen del inicio de la consola, instalación por instalación (ADR-025). Cada una se lee por separado y con un tope de tiempo: una base caída o lenta no puede dejar sin inicio
 * a las demás (la tarjeta de la que falla dice que no se pudo leer y el resto anda). PURO: la lectura entra por parámetro, así que se prueba sin base.
 */
const TOPE_DE_LECTURA_MS = 5_000;

export type ResumenDeInstalacion = { instalacion: Instalacion; estado: "ok"; pendientes: number } | { instalacion: Instalacion; estado: "caida" };

/** Rechaza si la promesa no termina antes de `ms`. El temporizador se limpia siempre (no deja el proceso colgado). */
export function conTiempoLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new Error("tiempo agotado")), ms);
    promesa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolver(valor);
      },
      (error) => {
        clearTimeout(temporizador);
        rechazar(error);
      },
    );
  });
}

export async function resumenDeInstalaciones(instalaciones: readonly Instalacion[], leerPendientes: (instalacion: Instalacion) => Promise<number>, tope = TOPE_DE_LECTURA_MS): Promise<ResumenDeInstalacion[]> {
  const resultados = await Promise.allSettled(instalaciones.map((i) => conTiempoLimite(leerPendientes(i), tope)));
  return instalaciones.map((instalacion, n): ResumenDeInstalacion => {
    const r = resultados[n];
    return r.status === "fulfilled" ? { instalacion, estado: "ok", pendientes: r.value } : { instalacion, estado: "caida" };
  });
}
