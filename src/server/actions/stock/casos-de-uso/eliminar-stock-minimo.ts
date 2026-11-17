import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import type { ComandoEliminarStockMinimo, ResultadoEliminarStockMinimo } from "@/core/features/stock/stock-minimo.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { quitarStockMinimo } from "@/server/persistencia/stock/stock-minimo";
import { textoDe } from "@/core/textos/texto-de";
import { ENTIDADES } from "@/core/textos/entidades";

/**
 * Caso de uso «quitar una fila de stock mínimo» (E-4(2): ya no se borra, queda marcada con quién y cuándo) (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3). Es
 * el cuerpo que antes vivía en línea en la Server Action `eliminarStockMinimo` (`src/server/actions/stock/stock-minimo.ts`): la fila tiene que ser de ESTA
 * sucursal («No se encontró esa fila de Stock Mínimo.»), leída con la base del contexto. La Server Action quedó como adaptador (`conPermiso("stock_minimo")` → este
 * caso de uso → `aResultadoAccion`).
 *
 * 4.4 (decisión del dueño, 2026-10-07; paso H4C-22, CAMBIA COMPORTAMIENTO): el borrado y su fila de auditoría van en UNA transacción simple (entidad
 * «StockMinimoProducto», `entidadId` el id de la fila borrada, `campo: "minimo"`, del mínimo que tenía a `null`, con la sucursal, y la misma descripción que el alta:
 * global o de qué sección). Para la descripción la lectura de la fila trae el nombre del producto y el de la sección.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Borra la fila de stock mínimo de la sucursal activa y deja el borrado en la auditoría, salvo que la fila no exista.
 * @idempotency Por estado — repetir el pedido no encuentra la fila y se rechaza: no borra nada más.
 * @transaction Transacción simple (`actor.transaccion`): el borrado y su auditoría juntos. La lectura de la fila, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (StockMinimoProducto.minimo, del valor que tenía a null).
 * @ficha permiso=stock_minimo transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function eliminarStockMinimoCasoDeUso(
  actor: Pick<ContextoDeAccion, "db" | "sucursalId" | "transaccion" | "usuarioId" | "ahora">,
  comando: ComandoEliminarStockMinimo,
): Promise<ResultadoEliminarStockMinimo> {
  const { id } = comando;
  const fila = await actor.db.stockMinimoProducto.findFirst({
    where: { id, quitadoEn: null },
    include: { producto: { select: { nombre: true } }, seccion: { select: { nombre: true } } },
  });
  if (!fila || fila.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.fila_de_stock_minimo }));
  const quitada = await actor.transaccion(async (tx) => {
    // E-4(2): no se borra, se quita con rastro. Si otro la quitó entre la lectura y acá, no quedó nada por quitar: no se audita dos veces.
    if ((await quitarStockMinimo(tx, { id, quitadoPorId: actor.usuarioId, quitadoEn: actor.ahora })) === 0) return false;
    await registrarCambioAuditado(tx, {
      entidad: "StockMinimoProducto",
      entidadId: id,
      campo: "minimo",
      descripcion: fila.seccion ? `Stock mínimo de "${fila.producto.nombre}" en "${fila.seccion.nombre}"` : `Stock mínimo de "${fila.producto.nombre}" (global)`,
      valorAnterior: Number(fila.minimo),
      valorNuevo: null,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return true;
  });
  if (!quitada) return fracaso("NO_ENCONTRADA", textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.fila_de_stock_minimo }));
  return exito("Stock mínimo eliminado.", null);
}
