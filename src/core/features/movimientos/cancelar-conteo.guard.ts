import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esIdentificador } from "@/core/datos/identificador";
import type { ComandoCancelarConteo } from "./cancelar-conteo.schema";

/**
 * Guard del comando «cancelar un conteo físico» (formato, ANTES de abrir la transacción; puro). `conteoId` tiene que ser un texto no
 * vacío: con `undefined` Prisma ignora el filtro por id y la carga devolvería el PRIMER conteo, no el pedido. Devuelve `aceptar(entrada)`
 * SIN transformar nada.
 */
export function guardComandoCancelarConteo(entrada: unknown): ResultadoDato<ComandoCancelarConteo> {
  const { conteoId } = (entrada ?? {}) as { conteoId?: unknown };
  if (!esIdentificador(conteoId)) return rechazar("formato", "No se encontró ese conteo.");
  return aceptar(entrada as ComandoCancelarConteo);
}
