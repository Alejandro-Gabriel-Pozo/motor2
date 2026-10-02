import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esIdentificador } from "@/core/datos/identificador";
import type { ComandoResolverConteo, ComoResolverConteo } from "./resolver-conteo.schema";

/** Las dos formas de resolver un conteo pendiente; la clave es el tipo cerrado, así que un valor nuevo del tipo obliga a tocar esta lista. */
const FORMAS_DE_RESOLVER: Record<ComoResolverConteo, true> = { resuelto: true, ajustar: true };

/**
 * Guard del comando «resolver un conteo pendiente» (formato, ANTES de abrir la transacción; puro). El tipo `ComoResolverConteo` solo
 * acota en tiempo de compilación: un POST crudo a la Server Action puede mandar cualquier cosa, y en el caso de uso todo lo que no sea
 * «resuelto» caía en la rama «ajustar» (escribía un movimiento de ajuste de stock). Acá `comoResolver` es uno de los dos valores o se
 * rechaza, y `conteoId` tiene que ser un texto no vacío. Devuelve `aceptar(entrada)` SIN transformar nada.
 */
export function guardComandoResolverConteo(entrada: unknown): ResultadoDato<ComandoResolverConteo> {
  const { conteoId, comoResolver } = (entrada ?? {}) as { conteoId?: unknown; comoResolver?: unknown };
  if (!esIdentificador(conteoId)) return rechazar("formato", "No se encontró ese conteo.");
  if (typeof comoResolver !== "string" || !Object.hasOwn(FORMAS_DE_RESOLVER, comoResolver)) {
    return rechazar("formato", "Elegí cómo resolver el conteo: «resuelto» o «ajustar».");
  }
  return aceptar(entrada as ComandoResolverConteo);
}
