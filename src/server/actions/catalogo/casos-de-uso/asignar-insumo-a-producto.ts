import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoAsignarInsumoAProducto, ResultadoAsignarInsumoAProducto } from "@/core/features/catalogo/productos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { validarUnidadInsumo } from "@/server/lecturas/catalogo/unidad-de-insumo";
import { fijarInsumoDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «asignar el insumo a una materia prima ya existente» (Hito 4 de la pureza, bloque 4.3, paso H4C-11 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo
 * que antes vivía en línea en la Server Action `asignarInsumoAProducto` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: la mitad "retroactiva" del
 * asistente de hermanar — cuando la MP elegida como "ya la compro" todavía no tenía Insumo, se crea uno nuevo (`crearInsumo`) y este caso de uso se lo asigna a
 * ELLA, además de a la MP que se está dando de alta/editando ahora. Misma validación de unidad que el alta/edición normal (`validarUnidadInsumo`): no se puede
 * agrupar si ya hay un producto activo del mismo Insumo con otra unidad de stock. El producto y la unidad se leen con la base del contexto y la escritura va con
 * ella, sin transacción ni auditoría, como antes. La Server Action quedó como adaptador (`conPermisoDeEmpresa("producto_asignar_insumo")` → este caso de uso →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el insumo asignado a la materia prima, si es una MP y la unidad de stock no choca con la de los otros productos del insumo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo insumo.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (el insumo de un producto no es plata: sin auditoría).
 * @ficha permiso=producto_asignar_insumo transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function asignarInsumoAProductoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoAsignarInsumoAProducto): Promise<ResultadoAsignarInsumoAProducto> {
  const { productoId, insumoId } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "MP") return fracaso("NO_ES_MP", "Solo una materia prima (MP) puede tener Insumo asignado.");

  const invalido = await validarUnidadInsumo(insumoId, producto.unidadStockId, productoId, actor.db);
  if (invalido) return fracaso("UNIDAD_MEZCLADA", invalido);

  await fijarInsumoDeProducto(actor.db, { id: productoId, insumoId });
  return exito("Insumo asignado.", null);
}
