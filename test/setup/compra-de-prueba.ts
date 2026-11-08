import { randomUUID } from "node:crypto";
import { prisma } from "./test-db";
import { nroFacturaDePrueba } from "./comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "./referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";

/**
 * Compras de prueba desde U0/U1 de «una sola compra»: toda compra es una factura de una o más partes. Estas ayudas cargan una compra de UNA sucursal por el camino real (el adaptador `registrarMovimiento` → la factura de una parte)
 * y devuelven los dos ids que los tests necesitan: la compra (`Operacion`) y su factura. Corregir sus datos con la acción real: `corregir-compra-de-prueba.ts` (aparte: importa la Server Action y su sesión).
 */
type ActorDePrueba = Parameters<typeof registrarMovimientoCasoDeUso>[0];

export async function cargarCompraDeUnaParte(
  actor: ActorDePrueba,
  p: { seccionId: string; proveedorId: string; productoId: string; cantidad?: number; precioTotal?: number; nroFactura?: string; fecha?: Date; loteVencimiento?: Date; detalleLibre?: string; claveIdempotencia?: string }
): Promise<{ operacionId: string; facturaId: string }> {
  const r = await registrarMovimientoCasoDeUso(actor, {
    proceso: "COMPRA",
    fecha: p.fecha ?? new Date(),
    seccionId: p.seccionId,
    proveedorId: p.proveedorId,
    nroFactura: p.nroFactura ?? nroFacturaDePrueba(),
    detalleLibre: p.detalleLibre,
    items: [{ productoId: p.productoId, cantidad: p.cantidad ?? 10, precioTotal: p.precioTotal ?? 1000, loteVencimiento: p.loteVencimiento, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    claveIdempotencia: p.claveIdempotencia ?? randomUUID(),
  });
  if (!r.ok) throw new Error(`No se pudo cargar la compra de prueba: ${r.mensaje}`);
  const operacionId = r.datos.operacionId;
  if (!operacionId) throw new Error("La compra de prueba salió como reenvío: no hay operación nueva.");
  const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { operacionId }, select: { facturaProveedorId: true } });
  return { operacionId, facturaId: parte.facturaProveedorId };
}
