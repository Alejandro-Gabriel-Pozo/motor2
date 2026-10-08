import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "./cuenta.guard";
import type { ComandoLiberarMesa } from "./cuenta-apertura.schema";

/**
 * Guard de la APERTURA de la cuenta de una mesa (feature Cuenta del salón; convención «guard por feature»; Hito 4, bloque 4.1). Formato del comando, ANTES de
 * abrir la transacción, llamado por la Server Action DENTRO de su `conPermiso(…)`. Puro: sin Prisma ni permisos.
 *
 * Solo miran que el id sea un TEXTO: si no lo es, devuelven el MISMO mensaje que «no encontrado», que es exactamente lo que ya respondía la acción (con un id
 * que no es texto, `cuentaAbiertaDeSucursal` salteaba la lectura y devolvía ese error). Todo lo demás (comensales, cliente) lo sigue validando el caso de uso
 * en el lugar de siempre: un guard que lo adelantara cambiaría qué mensaje gana cuando hay dos fallas a la vez (lo fija `huella-del-pos`).
 */

/** Guard del comando «liberar la mesa sin venta». */
export function guardComandoLiberarMesa(entrada: unknown): ResultadoDato<ComandoLiberarMesa> {
  const { cuentaId } = (entrada ?? {}) as { cuentaId?: unknown };
  if (typeof cuentaId !== "string") return rechazar("formato", MENSAJE_CUENTA_NO_ENCONTRADA);
  return aceptar({ cuentaId });
}
