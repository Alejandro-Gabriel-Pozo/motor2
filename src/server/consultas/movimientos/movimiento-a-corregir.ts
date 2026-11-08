import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * El movimiento de stock que una persona quiere corregir con un Ajuste (E0 de la corrección por ajuste, «Corregir este movimiento» de Trazabilidad): lo que hace falta para
 * PRELLENAR el Ajuste — producto, sección y la referencia al original. Solo lectura, acotada a la sucursal activa (por la sección del movimiento: nunca se lee uno de otra sucursal)
 * y con `select` (no devuelve filas enteras). `null` si no existe o no es de esta sucursal. Sin guarda de permiso adentro: la página ya pone `requierePermisoVer` del Ajuste, y
 * guardar el Ajuste exige `proceso_ajuste` Editar en el servidor. NO corrige nada: el movimiento original queda como está (el Kardex solo agrega).
 */
export interface MovimientoACorregir {
  idMovimiento: string;
  idOperacion: string;
  procesoDelMovimiento: string;
  fechaDeLaOperacion: Date;
  productoId: string;
  seccionId: string;
}

export async function obtenerMovimientoACorregir(sucursalId: string, idMovimiento: string, db: Db): Promise<MovimientoACorregir | null> {
  const m = await db.movimientoStock.findFirst({
    where: { id: idMovimiento, seccion: { sucursalId } },
    select: { id: true, operacionId: true, proceso: true, productoId: true, seccionId: true, operacion: { select: { fecha: true } } },
  });
  if (!m) return null;
  return { idMovimiento: m.id, idOperacion: m.operacionId, procesoDelMovimiento: m.proceso, fechaDeLaOperacion: m.operacion.fecha, productoId: m.productoId, seccionId: m.seccionId };
}
