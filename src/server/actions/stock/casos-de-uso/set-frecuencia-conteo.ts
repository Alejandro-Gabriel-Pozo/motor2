import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSetFrecuenciaConteo, ResultadoSetFrecuenciaConteo } from "@/core/features/stock/frecuencia-conteo.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarFrecuenciaConteo } from "@/server/persistencia/stock/frecuencia-conteo";

/**
 * Caso de uso «fijar cada cuántos días se cuenta un producto en la sucursal activa» (sub-plan S, docs/plan-rendimiento-recetas-2026-09-22.md §E; Hito 4 de la
 * pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-19 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action
 * `setFrecuenciaConteo` (`src/server/actions/stock/frecuencia-conteo.ts`), movido TAL CUAL: lee el producto («No se encontró el producto.») y hace el alta o el
 * reemplazo de la fila de la sucursal con la base del contexto, sin transacción ni auditoría. `frecuenciaDias === 0` desactiva la agenda de ese producto (se
 * conserva la fila: mismo criterio «0 es un valor real» de setStockMinimoProducto). La Server Action quedó como adaptador (`conPermiso("conteo_frecuencia")` →
 * `guardComandoSetFrecuenciaConteo` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Deja la frecuencia de conteo del producto en la sucursal activa (una fila; 0 la desactiva), salvo que el producto no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir la misma frecuencia (el upsert no duplica la fila).
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (una frecuencia no es plata: sin auditoría).
 * @ficha permiso=conteo_frecuencia transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function setFrecuenciaConteoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoSetFrecuenciaConteo,
): Promise<ResultadoSetFrecuenciaConteo> {
  const { productoId, frecuenciaDias } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

  await guardarFrecuenciaConteo(actor.db, { sucursalId: actor.sucursalId, productoId, frecuenciaDias });
  return exito(
    frecuenciaDias === 0 ? `Agenda de conteo de "${producto.nombre}" desactivada.` : `Agenda de conteo de "${producto.nombre}" fijada cada ${frecuenciaDias} día(s).`,
    null,
  );
}
