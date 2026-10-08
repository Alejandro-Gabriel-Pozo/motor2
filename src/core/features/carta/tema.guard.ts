import { validarValoresTema } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoCambiarAplicacionTema, ComandoGuardarTemaCarta } from "./tema.schema";

/**
 * Guard de la feature «tema de la carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("carta_tema", …)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes era lo primero de cada acción, antes de leer nada y en el MISMO orden: `carta_tema` es de contexto sucursal, así que otra sucursal
 * responde igual que una inexistente («No se encontró la sucursal.»; `sucursalActivaId` es la del contexto de quien llama); y, solo al guardar, los valores.
 */

const SUCURSAL_NO_ENCONTRADA = "No se encontró la sucursal.";

/** Guard del comando «guardar el tema de la sucursal activa»: primero que sea la activa, después `validarValoresTema` (hasta 5 errores juntos en un mensaje, sin escribir). */
export function guardComandoGuardarTemaCarta(entrada: { sucursalId: string; valores: Readonly<Record<string, unknown>>; sucursalActivaId: string }): ResultadoDato<ComandoGuardarTemaCarta> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", SUCURSAL_NO_ENCONTRADA);
  const validados = validarValoresTema(entrada.valores);
  if (!validados.ok) return rechazar("formato", validados.mensaje);
  return aceptar({ sucursalId: entrada.sucursalId, valores: validados.valor });
}

/** Guard del comando «aplicar o desaplicar el tema»: solo que sea la sucursal activa (el booleano nunca se validó). */
export function guardComandoCambiarAplicacionTema(entrada: { sucursalId: string; aplicar: boolean; sucursalActivaId: string }): ResultadoDato<ComandoCambiarAplicacionTema> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", SUCURSAL_NO_ENCONTRADA);
  return aceptar({ sucursalId: entrada.sucursalId, aplicar: entrada.aplicar });
}
