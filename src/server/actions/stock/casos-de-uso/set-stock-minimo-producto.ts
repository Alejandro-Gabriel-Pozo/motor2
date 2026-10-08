import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSetStockMinimo, ResultadoSetStockMinimo } from "@/core/features/stock/stock-minimo.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarMinimoDeSeccion, guardarMinimoGlobal } from "@/server/persistencia/stock/stock-minimo";

/**
 * Caso de uso «fijar el stock mínimo de un producto en la sucursal activa, global o de una sección» (port de setStockMinimoProducto_, Catalogo.js:1982-2008; Hito 4
 * de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server
 * Action `setStockMinimoProducto` (`src/server/actions/stock/stock-minimo.ts`), movido TAL CUAL y en el MISMO orden, con la base del contexto y sin transacción:
 * el producto («No se encontró el producto.»); con sección, que sea de ESTA sucursal («No se encontró la sección.») y el alta o cambio de su fila
 * (`guardarMinimoDeSeccion`); sin sección (`null`, omitida o vacía), el alta o cambio de la fila GLOBAL de la sucursal (`guardarMinimoGlobal`), que aplica salvo
 * que haya una más específica. La Server Action quedó como adaptador (`conPermiso("stock_minimo")` → `guardComandoSetStockMinimo` → este caso de uso →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del mínimo (el guard).
 *
 * @contract Deja el stock mínimo del producto en la sucursal activa (global o de la sección), salvo que el producto o la sección no existan.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo mínimo (sin duplicar la fila).
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (el umbral de la alerta de stock bajo no se auditaba; 4.4 lo decide aparte).
 * @ficha permiso=stock_minimo transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function setStockMinimoProductoCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoSetStockMinimo): Promise<ResultadoSetStockMinimo> {
  const { productoId, minimo, seccionId } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

  if (seccionId) {
    const seccion = await actor.db.seccion.findUnique({ where: { id: seccionId } });
    if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");

    await guardarMinimoDeSeccion(actor.db, { sucursalId: actor.sucursalId, productoId, seccionId, minimo });
    return exito(`Stock mínimo de "${producto.nombre}" en "${seccion.nombre}" actualizado.`, null);
  }

  await guardarMinimoGlobal(actor.db, { sucursalId: actor.sucursalId, productoId, minimo });
  return exito(`Stock mínimo (global) de "${producto.nombre}" actualizado.`, null);
}
