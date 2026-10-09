import "server-only";
import type { Db } from "@/lib/db-tipos";
import { productoTieneRecetas } from "./recetas-vigentes";

/**
 * Qué historia tiene un producto: las dos preguntas que cierran lo que un operador podía cambiar sin que nadie lo notara (S-05 del plan de endurecimiento de
 * seguridad, tanda T2; decisión CAT-1 del dueño). Solo leen: las llama `casos-de-uso/actualizar-producto.ts` DENTRO de la transacción de la edición (con el `tx`),
 * para que la pregunta y el cambio vean el mismo estado.
 */

/**
 * ¿Algo ya guarda una cantidad o un vínculo en la unidad de stock de este producto? Es la definición de «historia» de CAT-1: un movimiento de stock (aunque esté anulado:
 * el Kardex solo agrega), una receta propia, una receta de sucursal, ser ingrediente de la receta de otro producto, una presentación de compra o el vínculo con un
 * proveedor; y, porque también guardan cantidades en esa unidad aunque todavía no hayan movido stock, un conteo físico, un traspaso, una línea de cuenta del POS y un stock mínimo cargado
 * (M-4 de la auditoría intermedia: un mínimo de 5 kg pasaba a ser 5 g si se cambiaba la unidad de un producto sin movimientos).
 * Con historia la unidad de stock no se cambia (igual que el tipo): reinterpretaría en silencio todo lo anterior. Sin historia se puede seguir corrigiendo.
 */
export async function productoTieneHistoria(db: Db, productoId: string): Promise<boolean> {
  const fila = await db.producto.findFirst({
    where: {
      id: productoId,
      OR: [
        { movimientos: { some: {} } },
        { presentaciones: { some: {} } },
        { proveedorPorProducto: { some: {} } },
        { recetasPorSucursal: { some: {} } },
        { usadoComoIngrediente: { some: {} } },
        { conteosFisicos: { some: {} } },
        { traspasos: { some: {} } },
        { cuentaItems: { some: {} } },
        { stockMinimos: { some: {} } },
      ],
    },
    select: { id: true },
  });
  if (fila !== null) return true;
  // Las versiones de receta solo se leen por el embudo de recetas (`lectores-de-receta.test.ts`).
  return productoTieneRecetas(db, productoId);
}

/**
 * ¿Ya se compró este producto con esta presentación de compra? (M-4 de la auditoría final; mismo criterio que la «historia» de CAT-1: lo ya hecho con un valor no se reinterpreta.) El factor de
 * la presentación mueve el stock que entra y el costo por unidad de TODO lo que se compre con ella, y un operario con `producto_presentaciones` lo pisaba con un `upsert`. El Kardex NO guarda con qué
 * unidad de compra se cargó una línea, así que el rastro que queda es el vínculo proveedor↔producto, que cada compra con proveedor escribe con la unidad de compra usada
 * (`upsertProveedorPorProducto`): si hay uno con esta unidad, la presentación se usó. Una compra SIN proveedor no deja ese rastro (cerrarlo exige una columna en el Kardex: [MIG]).
 */
export async function presentacionTieneUso(db: Db, productoId: string, unidadCompraId: string): Promise<boolean> {
  const fila = await db.proveedorPorProducto.findFirst({ where: { productoId, unidadCompraId }, select: { id: true } });
  return fila !== null;
}

/**
 * ¿Una venta o una producción ya liquidó este producto a su consignante? El reporte de consignación atribuye CADA liquidación al consignante ACTUAL del producto
 * (`Producto.proveedorConsignacionId`; la línea no guarda a quién): cambiarlo pasaría la deuda histórica, ya devengada, a otro proveedor. Con una liquidación (aunque
 * esté anulada: la reversión también se atribuye al consignante) el consignante no se cambia.
 */
export async function productoTieneLiquidaciones(db: Db, productoId: string): Promise<boolean> {
  const fila = await db.movimientoStock.findFirst({ where: { productoId, proceso: "LIQUIDACION_CONSIGNACION" }, select: { id: true } });
  return fila !== null;
}
