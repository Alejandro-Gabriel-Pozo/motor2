"use server";

import { calcularSaldoPorLote, obtenerSeccionPropia } from "@/core/movimientos/public-servidor";
import { requerirSesion } from "../con-sesion";

/**
 * LECTURA de reclasificación: el saldo disponible en origen, para mostrarlo en el formulario ANTES de enviarlo. Vivía en
 * `reclasificacion.ts` y se mudó TAL CUAL acá en la Task #41, Fase M13d (docs/arquitectura-casos-de-uso-2026-09-27.md, mismo criterio
 * que M11c con `traspasos/lecturas.ts`): con `reclasificarStock` ya migrado a caso de uso, `reclasificacion.ts` entró en
 * `ACCIONES_CON_CASO_DE_USO`, y esa regla de dependency-cruiser (`accion-migrada-sin-orquestacion`) vale para el archivo ENTERO — no
 * admite `@/lib/db` ni la fachada `core/movimientos/public-servidor.ts` en runtime. Esta lectura no es una mutación (no entra en la
 * Fase M) y una Server Action no puede importar `server/consultas/` (regla `acciones-sin-ui`), así que sigue siendo una Server Action
 * con su propia guarda de sesión, en un archivo propio fuera de esa lista.
 *
 * Solo lectura — la usa el cliente para mostrar el saldo disponible en
 * origen ANTES de enviar el form, a diferencia de antes (que solo lo
 * informaba el servidor recién al fallar el submit si la suma no cerraba,
 * a diferencia de su hermano Conteo Físico, que sí lo muestra de entrada).
 *
 * Fase 6 (auditoría de seguridad/contratos): sin `conPermiso` a propósito
 * (es de solo lectura, mismo criterio que el resto de las consultas de
 * este módulo), pero SÍ necesita su propio chequeo de sesión + sección
 * propia acá — a diferencia de las demás consultas "abiertas" del
 * proyecto, esta expone un saldo de stock de una sección puntual elegida
 * por el cliente, no un catálogo compartido.
 */
export async function obtenerSaldoDisponibleParaReclasificar(
  productoId: string,
  seccionId: string,
  loteVencimiento: Date | null
): Promise<number | null> {
  // Sin sesión LANZA (como el resto de las lecturas, ver con-sesion.ts), en vez de devolver `null`: `null` significa «no hay saldo
  // para mostrar» y el cliente no podía distinguir un producto sin datos de una sesión vencida.
  const ctx = await requerirSesion();
  if (!productoId || !seccionId) return null;
  if (!(await obtenerSeccionPropia(seccionId, ctx.sucursalId, ctx.db))) return null;
  return calcularSaldoPorLote(productoId, seccionId, loteVencimiento, ctx.db);
}
