import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * E3a (ADR-029, ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): las ESCRITURAS de la factura de proveedor repartida por propuesta y aceptación. Único escritor de `FacturaProveedor`,
 * `FacturaProveedorRenglon`, `FacturaProveedorSucursal`, `FacturaProveedorPropuesta`, `FacturaProveedorPropuestaRenglon` y `AnulacionDeFacturaProveedor`. La compra de cada parte (`Operacion` y Kardex) la
 * escribe `persistencia/movimientos/escribir-movimiento-de-stock.ts` (dueño del asiento) y la anulación de cada compra `escribir-anulacion-de-compra.ts`.
 *
 * Contrato de la persistencia de escritura: `tx` obligatorio (siempre dentro de la transacción SERIALIZABLE del caso de uso), sin reglas de negocio (el reparto lo calcula y lo verifica el caso de uso),
 * los montos llegan como `number` ya redondeados (pesos con 2 decimales, cantidades con hasta 4).
 */

export interface CabeceraAEscribir {
  proveedorId: string;
  nroFactura: string | null;
  nroFacturaNormalizado: string | null;
  fecha: Date;
  importeTotal: number;
  detalleLibre: string | null;
  usuarioId: string;
  ahora: Date;
  claveIdempotencia: string;
  payloadHash: string;
}

/** La cabecera nace CONFIRMADA: el reparto queda declarado completo al cargar (ADR-041); lo pendiente es la aceptación de cada destino. */
export async function escribirCabeceraDeFactura(tx: Prisma.TransactionClient, c: CabeceraAEscribir): Promise<{ id: string }> {
  const fila = await tx.facturaProveedor.create({
    data: {
      proveedorId: c.proveedorId,
      nroFactura: c.nroFactura,
      nroFacturaNormalizado: c.nroFacturaNormalizado,
      fecha: c.fecha,
      importeTotal: c.importeTotal,
      estado: "CONFIRMADA",
      confirmadaEn: c.ahora,
      confirmadaPorId: c.usuarioId,
      detalleLibre: c.detalleLibre,
      claveIdempotencia: c.claveIdempotencia,
      payloadHash: c.payloadHash,
      creadoPorId: c.usuarioId,
    },
    select: { id: true },
  });
  return fila;
}

export interface RenglonAEscribir {
  productoId: string;
  cantidadStock: number;
  precioPorUnidadStock: number;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
}

/** Los renglones en orden (desde 1). Devuelve sus ids en el mismo orden. */
export async function escribirRenglonesDeFactura(tx: Prisma.TransactionClient, facturaProveedorId: string, renglones: readonly RenglonAEscribir[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, r] of renglones.entries()) {
    const fila = await tx.facturaProveedorRenglon.create({
      data: { facturaProveedorId, orden: i + 1, naturaleza: "MERCADERIA", productoId: r.productoId, cantidadStock: r.cantidadStock, precioPorUnidadStock: r.precioPorUnidadStock, loteVencimiento: r.loteVencimiento, detalle: r.detalle, precioTotal: r.precioTotal },
      select: { id: true },
    });
    ids.push(fila.id);
  }
  return ids;
}

/** La parte de una sucursal, siempre RECIBIDA y con su compra (la de la sucursal que carga, al cargar; la de cada destino, al aceptar). */
export async function escribirParteRecibida(
  tx: Prisma.TransactionClient,
  p: { facturaProveedorId: string; sucursalId: string; porcentajeDeclaradoBp: number; operacionId: string; recibidaEn: Date; recibidaPorId: string }
): Promise<{ id: string }> {
  return tx.facturaProveedorSucursal.create({
    data: { facturaProveedorId: p.facturaProveedorId, sucursalId: p.sucursalId, porcentajeDeclaradoBp: p.porcentajeDeclaradoBp, operacionId: p.operacionId, estadoRecepcion: "RECIBIDA", recibidaEn: p.recibidaEn, recibidaPorId: p.recibidaPorId },
    select: { id: true },
  });
}

/** La propuesta de la parte de una sucursal destino, PENDIENTE, con sus renglones (cantidad > 0). */
export async function escribirPropuesta(
  tx: Prisma.TransactionClient,
  p: {
    facturaProveedorId: string;
    origenSucursalId: string;
    destinoSucursalId: string;
    porcentajeDeclaradoBp: number;
    creadoPorId: string;
    renglones: readonly { facturaProveedorRenglonId: string; cantidadStock: number; precioTotal: number }[];
  }
): Promise<{ id: string }> {
  const propuesta = await tx.facturaProveedorPropuesta.create({
    data: { facturaProveedorId: p.facturaProveedorId, origenSucursalId: p.origenSucursalId, destinoSucursalId: p.destinoSucursalId, porcentajeDeclaradoBp: p.porcentajeDeclaradoBp, creadoPorId: p.creadoPorId },
    select: { id: true },
  });
  await tx.facturaProveedorPropuestaRenglon.createMany({
    data: p.renglones.map((r) => ({
      facturaProveedorId: p.facturaProveedorId,
      propuestaId: propuesta.id,
      origenSucursalId: p.origenSucursalId,
      destinoSucursalId: p.destinoSucursalId,
      facturaProveedorRenglonId: r.facturaProveedorRenglonId,
      cantidadStock: r.cantidadStock,
      precioTotal: r.precioTotal,
    })),
  });
  return propuesta;
}

/** El mensaje devuelto a la carga, para que un reenvío con la misma clave lo repita tal cual (I3). */
export async function registrarResultadoDeFactura(tx: Prisma.TransactionClient, facturaProveedorId: string, mensaje: string): Promise<void> {
  await tx.facturaProveedor.update({ where: { id: facturaProveedorId }, data: { resultadoMensaje: mensaje } });
}

/**
 * Marca ACEPTADA una propuesta PENDIENTE con su parte. La guarda es el `WHERE estado = 'PENDIENTE'`: devuelve cuántas filas tocó (0 = otra aceptación ganó; el caso de uso aborta la transacción). Es el único UPDATE
 * de la propuesta en `src/` (la base solo le deja actualizar estas cuatro columnas).
 */
export async function marcarPropuestaAceptada(tx: Prisma.TransactionClient, p: { propuestaId: string; parteId: string; aceptadaEn: Date; aceptadaPorId: string }): Promise<number> {
  const r = await tx.facturaProveedorPropuesta.updateMany({
    where: { id: p.propuestaId, estado: "PENDIENTE" },
    data: { estado: "ACEPTADA", aceptadaEn: p.aceptadaEn, aceptadaPorId: p.aceptadaPorId, parteId: p.parteId },
  });
  return r.count;
}

/** Marca anulada la cabecera (libera el número) con la guarda `anuladaEn IS NULL`, y escribe la anulación como registro nuevo (motivo, clave, huella y mensaje). Devuelve cuántas cabeceras tocó. */
export async function escribirAnulacionDeFactura(
  tx: Prisma.TransactionClient,
  a: { facturaProveedorId: string; usuarioId: string; ahora: Date; motivo: string; claveIdempotencia: string; payloadHash: string; resultadoMensaje: string }
): Promise<number> {
  const r = await tx.facturaProveedor.updateMany({ where: { id: a.facturaProveedorId, anuladaEn: null }, data: { anuladaEn: a.ahora, anuladaPorId: a.usuarioId } });
  if (r.count === 0) return 0;
  await tx.anulacionDeFacturaProveedor.create({
    data: { facturaProveedorId: a.facturaProveedorId, motivo: a.motivo, claveIdempotencia: a.claveIdempotencia, payloadHash: a.payloadHash, resultadoMensaje: a.resultadoMensaje, creadoPorId: a.usuarioId },
  });
  return r.count;
}
