import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSetPrecioLocalProducto, ResultadoSetPrecioLocalProducto } from "@/core/features/movimientos/precio-local.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarPrecioLocalEnTx } from "./guardar-precio-local-en-tx";

/**
 * Caso de uso «fijar el precio local de un producto en la sucursal activa» (Hito 4 de la pureza, bloque 4.2, paso H4C-4 — `docs/plan-hito-4-pureza.md` §3). Es el
 * cuerpo que antes vivía en línea en la Server Action `setPrecioLocalProducto` (`src/server/actions/movimientos/precio-local.ts`), movido TAL CUAL: el producto
 * se lee con la base del contexto FUERA de la transacción («No se encontró el producto.») y en UNA transacción el paso compartido `guardarPrecioLocalEnTx` escribe
 * el precio y sus dos filas de auditoría. La Server Action quedó como adaptador (`conPermiso("precio_local")` → `guardComandoSetPrecioLocalProducto` → este caso
 * de uso → `revalidarCartasPublicas` → y DESPUÉS de revalidar, si quedó habilitado, el `sincronizable` del ítem agrupado → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del precio (el guard).
 *
 * @contract Deja el precio local (y si está habilitado) del producto en la sucursal activa, con las dos filas de auditoría de lo que cambió: todo o nada.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo precio (sin filas de auditoría nuevas: no cambió nada).
 * @transaction `actor.transaccion` (READ COMMITTED): el precio y su auditoría juntos (paso compartido `guardar-precio-local-en-tx.ts`); el producto se lee antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (PrecioLocalProducto.precio y .habilitado, del anterior al nuevo), en la misma transacción, por el paso compartido. La
 *   revalidación de la carta pública y el `sincronizable` los hace la Server Action.
 * @ficha permiso=precio_local transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function setPrecioLocalProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoSetPrecioLocalProducto,
): Promise<ResultadoSetPrecioLocalProducto> {
  const { productoId, precio, habilitado } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

  await actor.transaccion((tx) => guardarPrecioLocalEnTx(tx, actor, producto, precio, habilitado));
  return exito(`Precio local de "${producto.nombre}" ${habilitado ? `fijado en ${precio}` : "cargado (deshabilitado, se usa el precio global)"}.`, null);
}
