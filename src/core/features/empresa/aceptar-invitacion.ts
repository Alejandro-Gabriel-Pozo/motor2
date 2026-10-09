/**
 * Aceptar una invitación (E5 la del primer gerente, ADR-020; E8 la de usuario, ADR-024): lo PURO que comparten las dos aceptaciones, sus pantallas y su Server Action — el
 * resultado, el mensaje del enlace inútil y el error que deshace la transacción. El cuerpo de aceptar la del primer gerente vivía acá (P3: leía y escribía la base) y pasó a
 * su caso de uso, `server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts` (Hito 3, B3-5 de `docs/plan-hito-3-pureza.md`): este archivo queda P0.
 */

export type ResultadoDeAceptacion = { ok: true; empresaId: string; nombreEmpresa: string } | { ok: false; mensaje: string };

/** El mismo mensaje para todo lo que hace inútil el enlace: no distingue «no existe» de «ya se usó», para no confirmar nada a quien adivina. */
export const MENSAJE_ENLACE_NO_VALIDO = "Este enlace ya no sirve: venció, se usó o la plataforma lo canceló. Pedile a la plataforma que te mande otro.";

/** Un fallo de datos de la empresa (no de quien acepta): deshace la transacción entera, incluida la marca ACEPTADA. */
export class ErrorDeAceptacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeAceptacion";
  }
}
