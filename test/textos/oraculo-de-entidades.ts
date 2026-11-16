/**
 * Oráculo de las entidades del catálogo de textos (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c: género de la cosa), escrito aparte del código: para cada entidad de
 * `src/core/textos/entidades.ts`, la frase que tiene que salir. Una entidad nueva sin su fila hace fallar `entidades.test.ts`.
 */
export const ORACULO_DE_ENTIDADES: Readonly<Record<string, { genero: "m" | "f"; noSeEncontro: string }>> = {
  membresia: { genero: "f", noSeEncontro: "No se encontró la membresía." },
  sucursal: { genero: "f", noSeEncontro: "No se encontró la sucursal." },
  usuario: { genero: "m", noSeEncontro: "No se encontró el usuario." },
  invitacion_pendiente: { genero: "f", noSeEncontro: "No se encontró la invitación pendiente." },
};
