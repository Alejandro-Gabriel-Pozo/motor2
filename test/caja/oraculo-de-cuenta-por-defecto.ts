/**
 * ORÁCULO DE LA CUENTA POR DEFECTO DEL COBRO (etapa P-C3, docs/diseno-caja-c3c-cuenta-activa-por-defecto-2026-11-17.md; regla del dueño del 2026-10-28, «Combinaciones»): lo esperado, escrito APARTE del código y legible.
 * Decisiones del dueño (2026-11-17, chat, registradas en motor2-docs): «RESPUESTA: b» y «A (aceptar sin cuenta): el cobro se registra igual, queda “sin cuenta” y después lo ordenás. La venta nunca se frena.»
 * Este archivo NO importa nada de `src/` a propósito: si el código y este archivo discrepan, uno de los dos está mal.
 *
 * DIMENSIONES cuyas combinaciones cambian dinero, permisos, visibilidad o stock (declaralas acá o el guardián falla):
 *   1. tipo de medio                                  (6) EFECTIVO, TARJETA_DEBITO, TARJETA_CREDITO, TRANSFERENCIA, QR, OTRO
 *   2. cuentas ACTIVAS COMPATIBLES en la sucursal     (3) 0, 1, 2   (compatible = de un tipo de cuenta que el medio admite)
 *   3. la cuenta que trae el renglón                  (5) NINGUNA, COMPATIBLE, INCOMPATIBLE, OTRA_SUCURSAL, INACTIVA
 *   4. el alcance de lectura de quien cobra           (2) NORMAL (solo su sucursal: la RLS por sucursal oculta las cuentas de otras) y ANCHA (ve también otras sucursales)
 *   (no son dimensiones: el tipo de cuenta, que solo entra por la compatibilidad de la dimensión 1; y los «distractores»: cuentas inactivas, de otra sucursal o incompatibles que el recorrido deja SIEMPRE en la base y que
 *   no deben contar.)
 *
 * REGLAS (la cuenta con que queda el renglón):
 *   P1. Efectivo: nunca lleva cuenta. Sin cuenta → queda sin cuenta; con cuenta → CUENTA_DE_COBRO_NO_ADMITIDA.
 *   P2. Medio que admite cuenta, el renglón NO trae cuenta: 0 compatibles → OK y queda SIN cuenta (la venta nunca se frena); 1 → OK con esa cuenta; 2 o más → CUENTA_DE_COBRO_A_ELEGIR (no se escribe nada).
 *   P3. El renglón SÍ trae cuenta: se valida como siempre y no se reemplaza: de otra sucursal → CUENTA_DE_COBRO_NO_ENCONTRADA con el alcance NORMAL (la RLS la oculta: no existe para quien cobra) y CUENTA_DE_COBRO_DE_OTRA_SUCURSAL con el alcance ANCHA; inactiva → CUENTA_DE_COBRO_INACTIVA; de un tipo que el medio no admite →
 *       CUENTA_DE_COBRO_INCOMPATIBLE; activa, de la sucursal y compatible → OK con esa misma cuenta (haya 0, 1 o 2 compatibles activas).
 *   P4. «Compatible» es la tabla de CUENTAS_QUE_ADMITE (espejo de `CuentaDeCobro_admitida_por_medio`).
 */

export const TIPOS_DE_MEDIO = ["EFECTIVO", "TARJETA_DEBITO", "TARJETA_CREDITO", "TRANSFERENCIA", "QR", "OTRO"] as const;
export type Tipo = (typeof TIPOS_DE_MEDIO)[number];
export const TIPOS_DE_CUENTA = ["TERMINAL", "QR", "CUENTA_BANCARIA"] as const;
export type TipoCuenta = (typeof TIPOS_DE_CUENTA)[number];
export const CANTIDADES_DE_COMPATIBLES = [0, 1, 2] as const;
export type Cantidad = (typeof CANTIDADES_DE_COMPATIBLES)[number];
export const ALCANCES = ["NORMAL", "ANCHA"] as const;
export type Alcance = (typeof ALCANCES)[number];
export const LO_QUE_TRAE = ["NINGUNA", "COMPATIBLE", "INCOMPATIBLE", "OTRA_SUCURSAL", "INACTIVA"] as const;
export type LoQueTrae = (typeof LO_QUE_TRAE)[number];

export const CUENTAS_QUE_ADMITE: Readonly<Record<Tipo, readonly TipoCuenta[]>> = {
  EFECTIVO: [],
  TARJETA_DEBITO: ["TERMINAL"],
  TARJETA_CREDITO: ["TERMINAL"],
  TRANSFERENCIA: ["CUENTA_BANCARIA"],
  QR: ["QR", "TERMINAL"],
  OTRO: ["TERMINAL", "QR", "CUENTA_BANCARIA"],
};

/** Un tipo de cuenta que el medio NO admite, o `null` si admite los tres (OTRO). Con el efectivo (no admite ninguna) es el primero. */
export function tipoDeCuentaIncompatible(tipo: Tipo): TipoCuenta | null {
  return TIPOS_DE_CUENTA.find((c) => !CUENTAS_QUE_ADMITE[tipo].includes(c)) ?? null;
}

/** El tipo con que se arman las cuentas «compatibles» de un medio (el efectivo no tiene: se usa TERMINAL, que sirve de distractor y de cuenta rechazada). */
export function tipoDeCuentaCompatible(tipo: Tipo): TipoCuenta {
  return CUENTAS_QUE_ADMITE[tipo][0] ?? "TERMINAL";
}

/** ¿Existe la combinación? «Incompatible» no existe donde el medio admite los tres tipos (OTRO); «COMPATIBLE» exige al menos una compatible activa (la que trae); con el efectivo no hay cuentas compatibles que contar: solo 0. */
export function existeLaCombinacion(tipo: Tipo, cantidad: Cantidad, trae: LoQueTrae): boolean {
  if (tipo === "EFECTIVO" && cantidad !== 0) return false;
  if (trae === "INCOMPATIBLE" && tipoDeCuentaIncompatible(tipo) === null) return false;
  if (trae === "COMPATIBLE" && tipo !== "EFECTIVO" && cantidad === 0) return false;
  return true;
}

export type Resultado = "OK" | "CUENTA_DE_COBRO_NO_ENCONTRADA" | "CUENTA_DE_COBRO_A_ELEGIR" | "CUENTA_DE_COBRO_NO_ADMITIDA" | "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL" | "CUENTA_DE_COBRO_INACTIVA" | "CUENTA_DE_COBRO_INCOMPATIBLE";
/** Con qué cuenta queda el renglón si el resultado es OK: ninguna, la única activa compatible de la sucursal, o la que trajo. */
export type CuentaFinal = "NINGUNA" | "LA_UNICA" | "LA_QUE_TRAJO";

export function esperado(tipo: Tipo, cantidad: Cantidad, trae: LoQueTrae, alcance: Alcance): { resultado: Resultado; cuenta: CuentaFinal } {
  if (trae === "NINGUNA") {
    if (tipo === "EFECTIVO" || cantidad === 0) return { resultado: "OK", cuenta: "NINGUNA" };
    if (cantidad === 1) return { resultado: "OK", cuenta: "LA_UNICA" };
    return { resultado: "CUENTA_DE_COBRO_A_ELEGIR", cuenta: "NINGUNA" };
  }
  if (tipo === "EFECTIVO") return { resultado: "CUENTA_DE_COBRO_NO_ADMITIDA", cuenta: "NINGUNA" };
  if (trae === "OTRA_SUCURSAL") return { resultado: alcance === "NORMAL" ? "CUENTA_DE_COBRO_NO_ENCONTRADA" : "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL", cuenta: "NINGUNA" };
  if (trae === "INACTIVA") return { resultado: "CUENTA_DE_COBRO_INACTIVA", cuenta: "NINGUNA" };
  if (trae === "INCOMPATIBLE") return { resultado: "CUENTA_DE_COBRO_INCOMPATIBLE", cuenta: "NINGUNA" };
  return { resultado: "OK", cuenta: "LA_QUE_TRAJO" };
}
