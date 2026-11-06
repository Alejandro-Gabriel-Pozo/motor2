import { prisma } from "./test-db";
import { corregirFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";

/** Corrige los datos (proveedor, número, detalle) de la factura de una compra con la acción real `corregirFacturaProveedor`; `esperado` es lo que hoy está guardado. Necesita una sesión con `corregir_compra`. */
export async function corregirCompraDeTest(operacionId: string, cambios: { proveedorId?: string | null; nroFactura?: string; detalleLibre?: string }) {
  const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { operacionId }, select: { facturaProveedorId: true } });
  const f = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: parte.facturaProveedorId } });
  const esperado = { proveedorId: f.proveedorId, nroFactura: f.nroFactura, detalleLibre: f.detalleLibre };
  const nueva = {
    proveedorId: cambios.proveedorId === undefined ? f.proveedorId : cambios.proveedorId,
    nroFactura: cambios.nroFactura ?? f.nroFactura ?? "",
    detalleLibre: cambios.detalleLibre ?? f.detalleLibre ?? "",
  };
  return corregirFacturaProveedor(f.id, nueva, esperado);
}
