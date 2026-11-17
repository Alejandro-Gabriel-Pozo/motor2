/**
 * Las cosas del negocio que un texto nombra con artículo («No se encontró {entidad}.» → «No se encontró la sucursal.»): una sola vez cada una, con su género. El oráculo
 * (`test/textos/oraculo-de-entidades.ts`) tiene que declarar la frase esperada de cada una; una entidad nueva sin su fila hace fallar la prueba (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c).
 */
export type Entidad = { readonly nombre: string; readonly genero: "m" | "f" };

export const ENTIDADES = {
  membresia: { nombre: "membresía", genero: "f" },
  sucursal: { nombre: "sucursal", genero: "f" },
  usuario: { nombre: "usuario", genero: "m" },
  invitacion_pendiente: { nombre: "invitación pendiente", genero: "f" },
} as const satisfies Readonly<Record<string, Entidad>>;
