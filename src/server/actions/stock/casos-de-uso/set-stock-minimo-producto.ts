import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSetStockMinimo, ResultadoSetStockMinimo } from "@/core/features/stock/stock-minimo.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarMinimoDeSeccion, guardarMinimoGlobal } from "@/server/persistencia/stock/stock-minimo";

/**
 * Caso de uso «fijar el stock mínimo de un producto en la sucursal activa, global o de una sección» (port de setStockMinimoProducto_, Catalogo.js:1982-2008; Hito 4
 * de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server
 * Action `setStockMinimoProducto` (`src/server/actions/stock/stock-minimo.ts`), con las lecturas TAL CUAL y en el MISMO orden, con la base del contexto: el
 * producto («No se encontró el producto.») y, con sección, que sea de ESTA sucursal («No se encontró la sección.»). Con sección se da de alta o se cambia su fila
 * (`guardarMinimoDeSeccion`); sin sección (`null`, omitida o vacía), la fila GLOBAL de la sucursal (`guardarMinimoGlobal`), que aplica salvo que haya una más
 * específica. La Server Action quedó como adaptador (`conPermiso("stock_minimo")` → `guardComandoSetStockMinimo` → este caso de uso → `aResultadoAccion`).
 *
 * 4.4 (decisión del dueño, 2026-10-07; paso H4C-22, CAMBIA COMPORTAMIENTO): la escritura y su fila de auditoría van en UNA transacción simple (entidad
 * «StockMinimoProducto», `entidadId` el id de la fila, `campo: "minimo"`, del mínimo anterior —`null` si la fila no existía— al nuevo, con la sucursal, y la
 * descripción `Stock mínimo de "<producto>" (global)` o `… en "<sección>"`). Repetir el mismo valor no deja fila. Antes el mínimo no se auditaba (era la excepción
 * «stockMinimoProducto.minimo» de `escrituras-auditadas`, que se quitó).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del mínimo (el guard).
 *
 * @contract Deja el stock mínimo del producto en la sucursal activa (global o de la sección) y el cambio en la auditoría, salvo que el producto o la sección no existan.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo mínimo (sin duplicar la fila ni dejar otra fila de auditoría: nada cambió).
 * @transaction Transacción simple (`actor.transaccion`): la escritura y su auditoría juntas. Las lecturas del producto y la sección, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (StockMinimoProducto.minimo, del anterior al nuevo).
 * @ficha permiso=stock_minimo transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function setStockMinimoProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId" | "transaccion" | "usuarioId">,
  comando: ComandoSetStockMinimo,
): Promise<ResultadoSetStockMinimo> {
  const { productoId, minimo, seccionId } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

  if (seccionId) {
    const seccion = await actor.db.seccion.findUnique({ where: { id: seccionId } });
    if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");

    await actor.transaccion(async (tx) => {
      const escrito = await guardarMinimoDeSeccion(tx, { sucursalId: actor.sucursalId, productoId, seccionId, minimo });
      await registrarCambioAuditado(tx, {
        entidad: "StockMinimoProducto",
        entidadId: escrito.id,
        campo: "minimo",
        descripcion: `Stock mínimo de "${producto.nombre}" en "${seccion.nombre}"`,
        valorAnterior: escrito.anterior,
        valorNuevo: minimo,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    });
    return exito(`Stock mínimo de "${producto.nombre}" en "${seccion.nombre}" actualizado.`, null);
  }

  await actor.transaccion(async (tx) => {
    const escrito = await guardarMinimoGlobal(tx, { sucursalId: actor.sucursalId, productoId, minimo });
    await registrarCambioAuditado(tx, {
      entidad: "StockMinimoProducto",
      entidadId: escrito.id,
      campo: "minimo",
      descripcion: `Stock mínimo de "${producto.nombre}" (global)`,
      valorAnterior: escrito.anterior,
      valorNuevo: minimo,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
  });
  return exito(`Stock mínimo (global) de "${producto.nombre}" actualizado.`, null);
}
