import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoCopiarCartaDeSucursal } from "./copiar-carta.schema";

/**
 * Guard de la feature «copiar la carta de otra sucursal» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del
 * comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("carta_copiar_de_sucursal", …)`, así que el rechazo por permiso sigue llegando antes
 * que el de formato. Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes era lo primero de `copiarCartaDeSucursal`, antes de leer nada y en el MISMO orden: la confirmación explícita, y que el origen no sea la
 * propia sucursal activa (`sucursalActivaId`: la del contexto de quien llama; el destino nunca llega por parámetro).
 */
export function guardComandoCopiarCartaDeSucursal(entrada: { sucursalOrigenId: string; confirmado: boolean; sucursalActivaId: string }): ResultadoDato<ComandoCopiarCartaDeSucursal> {
  if (!entrada.confirmado) return rechazar("vacio", "Confirmá que querés copiar la carta de otra sucursal a esta.");
  if (entrada.sucursalOrigenId === entrada.sucursalActivaId) return rechazar("formato", "Elegí otra sucursal: no se puede copiar de la misma.");
  return aceptar({ sucursalOrigenId: entrada.sucursalOrigenId });
}
