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
 * proveedor; y, porque también guardan cantidades en esa unidad aunque todavía no hayan movido stock, un conteo físico, un traspaso y una línea de cuenta del POS.
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
      ],
    },
    select: { id: true },
  });
  if (fila !== null) return true;
  // Las versiones de receta solo se leen por el embudo de recetas (`lectores-de-receta.test.ts`).
  return productoTieneRecetas(db, productoId);
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
