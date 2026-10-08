import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoEliminarFrecuenciaConteo, ResultadoEliminarFrecuenciaConteo } from "@/core/features/stock/frecuencia-conteo.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarFrecuenciaConteo } from "@/server/persistencia/stock/frecuencia-conteo";

/**
 * Caso de uso «borrar una fila de la agenda de conteo» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-19 — `docs/plan-hito-4-pureza.md`
 * §3). Es el cuerpo que antes vivía en línea en la Server Action `eliminarFrecuenciaConteo` (`src/server/actions/stock/frecuencia-conteo.ts`), movido TAL CUAL: la
 * fila tiene que ser de ESTA sucursal («No se encontró esa fila de Frecuencia de conteo.») y se borra con la base del contexto, sin transacción ni auditoría. La
 * Server Action quedó como adaptador (`conPermiso("conteo_frecuencia")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Borra la fila de la agenda de la sucursal activa, salvo que no exista.
 * @idempotency Por estado — repetir el pedido no encuentra la fila y se rechaza: no borra nada más.
 * @transaction Ninguna: una lectura y un borrado con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata).
 * @ficha permiso=conteo_frecuencia transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function eliminarFrecuenciaConteoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoEliminarFrecuenciaConteo,
): Promise<ResultadoEliminarFrecuenciaConteo> {
  const { id } = comando;
  const fila = await actor.db.frecuenciaConteoProducto.findUnique({ where: { id } });
  if (!fila || fila.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró esa fila de Frecuencia de conteo.");
  await borrarFrecuenciaConteo(actor.db, { id });
  return exito("Fila de Frecuencia de conteo eliminada.", null);
}
