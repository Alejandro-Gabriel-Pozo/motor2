import { prisma } from "./test-db";
import { anularFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";

/**
 * Anula, desde un test, la compra (`Operacion` COMPRA) de una parte de factura: desde U0 de «una sola compra» toda compra cargada por `registrarMovimiento` o `registrarFacturaProveedor` es la parte de una factura, y la única
 * anulación es la de la factura entera (con motivo). Busca la factura de esa compra y llama a la acción real `anularFacturaProveedor`; con la sesión que el test ya tenga puesta (necesita `anular_compra`).
 */
export async function anularCompraDeTest(operacionId: string, claveIdempotencia: string = crypto.randomUUID(), motivo: string = "Anulada en la prueba") {
  const parte = await prisma.facturaProveedorSucursal.findFirst({ where: { operacionId }, select: { facturaProveedorId: true } });
  if (!parte) throw new Error(`La compra ${operacionId} no es la parte de una factura: no hay nada que anular con anularFacturaProveedor.`);
  return anularFacturaProveedor(parte.facturaProveedorId, motivo, claveIdempotencia);
}
