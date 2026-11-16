/**
 * Arqueo de la caja (docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, nivel 4): al cerrar la sesión el efectivo se CUENTA por billetes y monedas; la diferencia es `contado − esperado`, se CALCULA y
 * nadie la escribe. Cerrar con diferencia se permite siempre (igual que Pedernal): la diferencia queda anotada y auditada.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */

/**
 * Las denominaciones que se cuentan, en pesos. SUPUESTO declarado en el PR (no es una decisión del dueño): son las 7 de Pedernal (`arqueo_billete_denominacion_ck`); la planilla de papel del 04/11 listaba 10
 * (desde 10 y 20). La pregunta «¿cuáles cuenta la caja?» (Q-DENOM) está abierta; cambiar la lista es cambiar esta constante y el CHECK de la migración.
 */
export const DENOMINACIONES_DE_BILLETE = [20000, 10000, 2000, 1000, 500, 200, 100] as const;
export type DenominacionDeBillete = (typeof DENOMINACIONES_DE_BILLETE)[number];

/** Cuántos billetes de una denominación se aceptan por conteo (como Pedernal: 0 a 99999). */
export const MAXIMO_DE_BILLETES_POR_DENOMINACION = 99999;

export interface ConteoDeBilletes {
  /** Cantidad por denominación; las que faltan valen 0. */
  readonly billetes: Readonly<Partial<Record<DenominacionDeBillete, number>>>;
  /** Las monedas, en centavos enteros (un solo importe, como Pedernal). */
  readonly monedasEnCentavos: bigint;
}

export type ErrorDeConteo = "CANTIDAD_DE_BILLETES_INVALIDA" | "DENOMINACION_DESCONOCIDA" | "MONEDAS_INVALIDAS";

/** Lo contado en efectivo, en centavos, o el motivo por el que el conteo no vale. */
export function totalContadoEnCentavos(conteo: ConteoDeBilletes): { ok: true; centavos: bigint } | { ok: false; error: ErrorDeConteo } {
  if (conteo.monedasEnCentavos < BigInt(0)) return { ok: false, error: "MONEDAS_INVALIDAS" };
  let total = conteo.monedasEnCentavos;
  for (const [clave, cantidad] of Object.entries(conteo.billetes)) {
    const denominacion = Number(clave);
    if (!(DENOMINACIONES_DE_BILLETE as readonly number[]).includes(denominacion)) return { ok: false, error: "DENOMINACION_DESCONOCIDA" };
    if (cantidad === undefined) continue;
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAXIMO_DE_BILLETES_POR_DENOMINACION) return { ok: false, error: "CANTIDAD_DE_BILLETES_INVALIDA" };
    total += BigInt(denominacion) * BigInt(100) * BigInt(cantidad);
  }
  return { ok: true, centavos: total };
}

/** `contado − esperado` en centavos: positiva sobra, negativa falta. */
export function diferenciaDeArqueo(contadoEnCentavos: bigint, esperadoEnCentavos: bigint): bigint {
  return contadoEnCentavos - esperadoEnCentavos;
}
