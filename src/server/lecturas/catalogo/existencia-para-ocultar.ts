import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * ¿Tiene el producto existencia DISTINTA DE CERO (también negativa) en alguna sección del alcance? Es la condición de «Ocultar» (docs/diseno-ocultar-como-pedernal-2026-11-15.md, O-3, R-11):
 * se mira por sección y no se netea entre secciones (un +5 y un −5 siguen siendo existencia), igual que `dependenciasParaDesactivar`; y la de Pedernal (`saldo_de_stock.existencia <> 0` en
 * cualquier depósito del alcance). `sucursalId` = el local; `null` = toda la empresa (la lectura ve solo lo que el alcance de la transacción deja ver: quien llama tiene que haberlo ensanchado a
 * toda la empresa, si no esta función subestimaría la existencia). Un producto sin movimientos no tiene existencia.
 */
export async function tieneExistenciaDistintaDeCero(db: Db, productoId: string, sucursalId: string | null): Promise<boolean> {
  const porSeccion = await db.movimientoStock.groupBy({
    by: ["seccionId"],
    where: { productoId, ...(sucursalId === null ? {} : { seccion: { sucursalId } }) },
    _sum: { cantidad: true },
  });
  return porSeccion.some((s) => s._sum.cantidad !== null && !s._sum.cantidad.isZero());
}
