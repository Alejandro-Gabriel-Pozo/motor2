/**
 * Clases de movimiento de la caja y su signo (docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, I-5 e I-6). La sesión nace ABIERTA y termina CERRADA (una cerrada no se reabre): ese estado lo hace cumplir la base.
 * La sesión no tiene «en cierre»: el cierre es un solo paso (todo o nada). La jornada (etapa C2) es de la sucursal y su fecha: la sesión solo sella la fecha, la zona y la hora de corte al abrir.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */
/** Las clases de movimiento de caja y su signo (igual que Pedernal; `AJUSTE` llegó con C2). */
export const CLASES_DE_MOVIMIENTO = ["FONDO_INICIAL", "COBRO", "INGRESO_MANUAL", "EGRESO_MANUAL", "AJUSTE", "ANULACION"] as const;
export type ClaseDeMovimiento = (typeof CLASES_DE_MOVIMIENTO)[number];

/** El signo que tiene que tener el importe de cada clase (+1 entra plata, -1 sale, 0 = cualquiera distinto de cero: un ajuste suma o resta, una anulación es el espejo de lo que anula). */
export function signoDeClase(clase: ClaseDeMovimiento): 1 | -1 | 0 {
  switch (clase) {
    case "FONDO_INICIAL":
    case "COBRO":
    case "INGRESO_MANUAL":
      return 1;
    case "EGRESO_MANUAL":
      return -1;
    case "AJUSTE":
    case "ANULACION":
      return 0;
  }
}

/** ¿El importe con signo (en centavos) es válido para su clase? El fondo inicial admite 0; todo lo demás es distinto de cero. */
export function importeValidoParaClase(clase: ClaseDeMovimiento, centavosConSigno: bigint): boolean {
  const signo = signoDeClase(clase);
  if (clase === "FONDO_INICIAL") return centavosConSigno >= BigInt(0);
  if (signo === 1) return centavosConSigno > BigInt(0);
  if (signo === -1) return centavosConSigno < BigInt(0);
  return centavosConSigno !== BigInt(0);
}
