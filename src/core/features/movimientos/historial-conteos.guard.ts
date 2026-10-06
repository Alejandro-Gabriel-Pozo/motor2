import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esIdentificador } from "@/core/datos/identificador";

/**
 * Guard del filtro del historial de conteos (LECTURA; puro). El filtro llega como argumento de una Server Action: el cliente puede mandar
 * cualquier cosa, y un objeto en `productoId` iría tal cual al `where` de Prisma (operadores en vez de un id) y un `Invalid Date` rompe la
 * consulta. Cada id tiene que ser `undefined` o un texto no vacío, y cada fecha `undefined` o una `Date` válida. Devuelve `aceptar(entrada)`
 * SIN transformar nada.
 */
export function guardFiltroHistorialConteos(entrada: unknown): ResultadoDato<Record<string, unknown>> {
  if (entrada === undefined) return aceptar({});
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) return rechazar("formato", "El filtro del historial no es válido.");
  const filtro = entrada as Record<string, unknown>;
  for (const campo of ["seccionId", "productoId", "cursor"]) {
    if (filtro[campo] !== undefined && !esIdentificador(filtro[campo])) return rechazar("formato", `El filtro «${campo}» no es válido.`);
  }
  for (const campo of ["desde", "hasta"]) {
    const v = filtro[campo];
    if (v !== undefined && !(v instanceof Date && !Number.isNaN(v.getTime()))) return rechazar("formato", `La fecha «${campo}» no es válida.`);
  }
  return aceptar(filtro);
}
