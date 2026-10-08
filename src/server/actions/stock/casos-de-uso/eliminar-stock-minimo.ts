import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoEliminarStockMinimo, ResultadoEliminarStockMinimo } from "@/core/features/stock/stock-minimo.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarStockMinimo } from "@/server/persistencia/stock/stock-minimo";

/**
 * Caso de uso «borrar una fila de stock mínimo» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3). Es
 * el cuerpo que antes vivía en línea en la Server Action `eliminarStockMinimo` (`src/server/actions/stock/stock-minimo.ts`), movido TAL CUAL: la fila tiene que ser
 * de ESTA sucursal («No se encontró esa fila de Stock Mínimo.») y se borra con la base del contexto, sin transacción. La Server Action quedó como adaptador
 * (`conPermiso("stock_minimo")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Borra la fila de stock mínimo de la sucursal activa, salvo que no exista.
 * @idempotency Por estado — repetir el pedido no encuentra la fila y se rechaza: no borra nada más.
 * @transaction Ninguna: una lectura y un borrado con `actor.db`, como antes.
 * @sideEffects Ninguno (el umbral de la alerta de stock bajo no se auditaba; 4.4 lo decide aparte).
 * @ficha permiso=stock_minimo transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function eliminarStockMinimoCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoEliminarStockMinimo): Promise<ResultadoEliminarStockMinimo> {
  const { id } = comando;
  const fila = await actor.db.stockMinimoProducto.findUnique({ where: { id } });
  if (!fila || fila.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró esa fila de Stock Mínimo.");
  await borrarStockMinimo(actor.db, { id });
  return exito("Stock mínimo eliminado.", null);
}
