import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoCerrarCuenta } from "./cuenta.schema";

/**
 * Guard de la feature Cuenta del salón (convención "guard por feature", 2026-09-25; Task #41, Fase M). Formato del comando, ANTES de
 * abrir la transacción. Puro: sin Prisma ni permisos.
 */

/** El texto que ya usaban las acciones de «tomar pedido» para una cuenta que no es de la sucursal activa (o no existe). */
export const MENSAJE_CUENTA_NO_ENCONTRADA = "No se encontró esa cuenta en esta sucursal.";

/**
 * Guard del comando «cerrar la cuenta». Solo el `cuentaId`: si no es un string, el MISMO mensaje que «no encontrada» — exactamente lo
 * que ya respondía `cerrarCuenta` (que con un id no-string salteaba el `findFirst` y devolvía ese error). Un string —exista o no— pasa
 * tal cual, y el caso de uso sigue respondiendo como siempre.
 */
export function guardComandoCerrarCuenta(entrada: unknown): ResultadoDato<ComandoCerrarCuenta> {
  const { cuentaId } = (entrada ?? {}) as { cuentaId?: unknown };
  if (typeof cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  return aceptar({ cuentaId });
}
