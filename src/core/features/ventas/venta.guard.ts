import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoAnularVenta } from "./venta.schema";

/**
 * Guard de la feature Venta de mostrador (convención "guard por feature", 2026-09-25; Task #41, Fase M). Formato del comando, ANTES de
 * abrir la transacción. Puro: sin Prisma ni permisos.
 */

/**
 * Guard del comando «anular una venta». Solo el `operacionId`: si no es un string, el MISMO mensaje que «no encontrada»
 * («No se encontró esa operación en esta sucursal.», el texto que ya usaba `anularVenta`). Antes llegaba así al `findFirst`: con
 * `undefined` Prisma ignora el filtro por id y cargaba la PRIMERA operación de la sucursal; con otro tipo, un error crudo de validación
 * (un 500 para la pantalla). Un string —exista o no— pasa tal cual, y el caso de uso sigue respondiendo como siempre.
 */
export function guardComandoAnularVenta(entrada: unknown): ResultadoDato<ComandoAnularVenta> {
  const { operacionId } = (entrada ?? {}) as { operacionId?: unknown };
  if (typeof operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  return aceptar({ operacionId });
}
