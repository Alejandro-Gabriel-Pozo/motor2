import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import type { ComandoCrearMesa } from "./mesas.schema";

/**
 * Guard de la feature Mesas del salón (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.1). Formato del comando, ANTES de tocar la base; lo
 * llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 */

/** El número de mesa más alto que se puede dar de alta (vivía en `src/server/actions/pos/mesas.ts`; el límite de mesas abiertas usa el mismo tope). */
const NUMERO_MESA_MAXIMO = 9999;

/**
 * Guard del comando «dar de alta una mesa». Es EXACTAMENTE la validación que antes corría en línea en `crearMesa`, con el MISMO texto: un entero, estricto
 * (`esNumeroEstricto`: ni `NaN` ni infinito), entre 1 y {@link NUMERO_MESA_MAXIMO}. Que el número esté libre en la sucursal lo resuelve la base (el índice
 * único), en el caso de uso.
 */
export function guardComandoCrearMesa(numero: unknown): ResultadoDato<ComandoCrearMesa> {
  if (typeof numero !== "number" || !Number.isInteger(numero) || !esNumeroEstricto(numero) || numero < 1 || numero > NUMERO_MESA_MAXIMO) {
    return rechazar("rango", `El número de mesa tiene que ser un entero entre 1 y ${NUMERO_MESA_MAXIMO}.`);
  }
  return aceptar({ numero });
}
