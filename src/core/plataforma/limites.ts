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
 * tope subió de 5 a 10 (la primera versión puso 20; el dueño preguntó «¿por qué no 10?», 2026-10-09, pendiente de su confirmación explícita): duplica el
 * margen contra el bloqueo sin cuadruplicar la superficie de adivinanza (unos 50 intentos por hora sobre 10⁶, y sigue faltando el TOTP). Los intentos por
 * código siguen en 5, y las adivinanzas de un atacante caen sobre códigos que son suyos, no sobre el del administrador. Se cuenta bajo el cerrojo de la
 * fila del administrador (nunca fuera de la transacción).
 */
export const MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA = 10;
export const VENTANA_DE_PEDIDOS_MS = 60 * 60 * 1000;
/**
 * Por ORIGEN (IP de `x-forwarded-for`), en memoria y por instancia (best effort, como el limitador de mutaciones): cuántos pedidos de código acepta la consola.
 *
 * El techo del administrador se cuenta sobre TODOS los códigos de la hora, vengan de quien vengan; si un solo origen pudiera llenarlo, un anónimo con una IP le
 * dejaría sin código al administrador (I-1 de la auditoría intermedia: el cupo de antes, 6 cada 10 minutos, dejaba pasar 36 por hora contra un techo de 10). Por
 * eso el cupo por origen se DERIVA del techo y de su ventana, y no se elige aparte:
 *  - la ventana es la misma hora que cuenta el techo (`VENTANA_DE_PEDIDOS_MS`: el limitador por origen usa ESA constante, no una propia), y
 *  - el limitador es de ventana FIJA: en cualquier hora móvil caben, en el peor caso, dos ventanas (una ráfaga al final de una y otra al principio de la siguiente),
 *    así que el tope por ventana es lo que deja que DOS ventanas sumen estrictamente menos que el techo: al administrador siempre le queda al menos un lugar.
 * Con el techo en 10 el tope es 4 (en cualquier hora, una IP escribe a lo sumo 8 códigos; en rigor 7, porque el pedido que ancla la primera ventana ya salió de
 * la hora, pero se cuenta con las dos ventanas enteras por margen). Lo que NO cierra: con muchas IP distintas, o repartido entre
 * instancias, el techo sigue agotable; el cierre de verdad es el firewall de Vercel (E.6) y contar por origen en la base (columna `origen`, [MIG], B10).
 */
export const MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN = Math.floor((MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA - 1) / 2);

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
