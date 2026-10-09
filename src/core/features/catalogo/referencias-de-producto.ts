import { rechazoDeReferenciaNoEncontrada } from "@/core/datos/errores-de-base";

/**
 * Las referencias que un producto guarda a otras filas del catálogo y que llegan SIN VALIDAR del formulario (O.175, GT-3b): la categoría, el insumo, las dos unidades y el proveedor de consignación.
 * Cada una es una clave foránea compuesta con `empresaId` (`Producto_empresaId_<columna>_fkey`): el id de OTRA empresa (o inexistente) lo rechaza la base y, sin esto, salía como una excepción
 * cruda de Prisma (`P2003`) en lugar de un rechazo explicado. No cruzaba nada (la base lo impide); el arreglo está en el ÚLTIMO punto de decisión —la propia restricción— y lo traduce el caso de uso
 * en su borde, FUERA de la transacción abortada.
 */
const REFERENCIAS: Readonly<Record<string, string>> = {
  categoriaId: "la categoría elegida",
  insumoId: "el insumo elegido",
  unidadCompraId: "la unidad de compra elegida",
  unidadStockId: "la unidad de stock elegida",
  proveedorConsignacionId: "el proveedor de consignación elegido",
};

/** El rechazo «No se encontró …» de una violación de clave foránea al guardar un producto, o `null` si el error es otra cosa (que sigue de largo). */
export function rechazoDeReferenciaDeProducto(e: unknown): string | null {
  return rechazoDeReferenciaNoEncontrada(e, REFERENCIAS, "No se encontró alguna de las referencias elegidas (categoría, insumo, unidades o proveedor de consignación).");
}
