/**
 * Límites contra adivinar los factores de ingreso de la consola de plataforma (ADR-019). Puro: el tiempo y los contadores entran por parámetro.
 */
export const VIDA_DEL_CODIGO_DE_INGRESO_MS = 10 * 60 * 1000;
export const MAXIMO_DE_INTENTOS_POR_CODIGO = 5;
export const MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR = 5;
export const BLOQUEO_POR_FALLOS_MS = 15 * 60 * 1000;
/**
 * Pedir códigos nuevos también se limita: sin tope, alguien podría llenar el buzón de un administrador. Es un techo de CORREO, no una defensa de adivinación
 * (S-08, B8): desde que cada código es del navegador que lo pidió y un pedido nuevo no invalida los anteriores (`core/plataforma/pedido-de-ingreso.ts`), el
 * tope subió de 5 a 20 para que un anónimo que pide en bucle tarde más en agotarlo; los intentos por código siguen en 5, y las adivinanzas de un atacante
 * caen sobre códigos que son suyos, no sobre el del administrador. Se cuenta bajo el cerrojo de la fila del administrador (nunca fuera de la transacción).
 */
export const MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA = 20;
/** Por ORIGEN (IP de `x-forwarded-for`), en memoria y por instancia (best effort, como el limitador de mutaciones): cuántos pedidos de código acepta la consola. */
export const MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN = 6;
export const VENTANA_DE_PEDIDOS_POR_ORIGEN_MS = 10 * 60 * 1000;
export const VENTANA_DE_PEDIDOS_MS = 60 * 60 * 1000;

export function codigoVencido(creadoEn: Date, ahora: Date): boolean {
  return ahora.getTime() - creadoEn.getTime() >= VIDA_DEL_CODIGO_DE_INGRESO_MS;
}

/** Un código se agota al llegar al máximo de intentos fallidos: el siguiente intento, aunque acierte, ya no sirve. */
export function codigoAgotado(intentosFallidos: number): boolean {
  return intentosFallidos >= MAXIMO_DE_INTENTOS_POR_CODIGO;
}

export function bloqueoVigente(bloqueadoHasta: Date | null, ahora: Date): boolean {
  return bloqueadoHasta !== null && ahora.getTime() < bloqueadoHasta.getTime();
}

export interface EstadoDeFallos {
  fallos: number;
  bloqueadoHasta: Date | null;
}

/** Tras un fallo del segundo factor: suma uno y, al llegar al máximo, bloquea 15 minutos y vuelve el contador a cero. */
export function despuesDeUnFallo(actual: EstadoDeFallos, ahora: Date): EstadoDeFallos {
  const fallos = actual.fallos + 1;
  if (fallos >= MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR) return { fallos: 0, bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_POR_FALLOS_MS) };
  return { fallos, bloqueadoHasta: actual.bloqueadoHasta };
}

/** Un acierto limpia el contador (el bloqueo ya no puede estar vigente: no se llega a verificar con bloqueo). */
export function despuesDeUnAcierto(): EstadoDeFallos {
  return { fallos: 0, bloqueadoHasta: null };
}
