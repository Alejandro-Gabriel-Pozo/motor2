import "server-only";
import type { Prisma } from "@prisma/client";
import { CONTROL_RECEPCION_EXCEDE_LA_ORDEN, type NivelDeControl } from "@/core/compras/public";

/**
 * Compras, orden de compra (etapa OC): las ESCRITURAS. Único escritor de `OrdenDeCompra`, `LineaDeOrdenDeCompra`, `VinculoDeRenglonConOrden` y `NivelDeControl`; el saldo (`SaldoDeLineaDeOrden`) NO lo escribe nadie de acá: lo mueven los disparadores
 * de la base (abrir al pedir, sumar al confirmar la recepción, devolver al anular la factura). Contrato: `tx` obligatorio (dentro de la transacción SERIALIZABLE del caso de uso), sin reglas de negocio, montos y cantidades ya validados. El id de cada
 * fila lo manda la aplicación (uuid). Las guardas de estado van en el WHERE: devuelven cuántas filas tocaron (0 = otro comando ganó; el caso de uso lo traduce).
 */

type Db = Prisma.TransactionClient;

/** La orden BORRADOR con sus líneas, en UNA transacción. La fecha de entrega es un día `AAAA-MM-DD` (columna `DATE`). */
export async function escribirOrdenBorrador(
  tx: Db,
  o: {
    id: string;
    proveedorId: string;
    sucursalId: string | null;
    fechaDeEntregaPrevista: Date | null;
    claveIdempotencia: string;
    payloadHash: string;
    creadoPorId: string;
    lineas: readonly { id: string; productoId: string; cantidad: number; precio: number | null }[];
  }
): Promise<void> {
  await tx.ordenDeCompra.create({
    data: {
      id: o.id,
      proveedorId: o.proveedorId,
      sucursalId: o.sucursalId,
      fechaDeEntregaPrevista: o.fechaDeEntregaPrevista,
      claveIdempotencia: o.claveIdempotencia,
      payloadHash: o.payloadHash,
      creadoPorId: o.creadoPorId,
    },
  });
  await tx.lineaDeOrdenDeCompra.createMany({
    data: o.lineas.map((l, i) => ({ id: l.id, ordenId: o.id, numero: i + 1, productoId: l.productoId, cantidadPedida: l.cantidad, precioPorUnidadStock: l.precio })),
  });
}

/** BORRADOR → PEDIDA con la guarda `estado = 'BORRADOR'`; la base fija el número. Devuelve cuántas filas tocó. */
export async function marcarOrdenPedida(tx: Db, p: { ordenId: string; usuarioId: string; ahora: Date; fechaDeNegocio: Date }): Promise<number> {
  const r = await tx.ordenDeCompra.updateMany({ where: { id: p.ordenId, estado: "BORRADOR" }, data: { estado: "PEDIDA", pedidaPorId: p.usuarioId, pedidaEn: p.ahora, fechaDeNegocio: p.fechaDeNegocio } });
  return r.count;
}

/** PEDIDA → CERRADA con la guarda `estado = 'PEDIDA'`; la base fija el motivo de cierre. Devuelve cuántas filas tocó. */
export async function marcarOrdenCerrada(tx: Db, p: { ordenId: string; usuarioId: string; ahora: Date }): Promise<number> {
  const r = await tx.ordenDeCompra.updateMany({ where: { id: p.ordenId, estado: "PEDIDA" }, data: { estado: "CERRADA", cerradaPorId: p.usuarioId, cerradaEn: p.ahora } });
  return r.count;
}

/** BORRADOR | PEDIDA → ANULADA con su motivo y la guarda de estado. Devuelve cuántas filas tocó. */
export async function marcarOrdenAnulada(tx: Db, p: { ordenId: string; usuarioId: string; ahora: Date; motivo: string }): Promise<number> {
  const r = await tx.ordenDeCompra.updateMany({ where: { id: p.ordenId, estado: { in: ["BORRADOR", "PEDIDA"] } }, data: { estado: "ANULADA", anuladaPorId: p.usuarioId, anuladaEn: p.ahora, motivoDeAnulacion: p.motivo } });
  return r.count;
}

/** Los vínculos de los renglones de una compra pendiente con las líneas de una orden, en UN INSERT (todo o nada). La base arbitra el resto (orden pedida, mismo proveedor y producto, línea no retirada, parte pendiente, único por renglón y tope según el control). */
export async function escribirVinculosConOrden(
  tx: Db,
  p: {
    facturaProveedorId: string;
    parteId: string;
    ordenId: string;
    registradoPorId: string;
    vinculos: readonly { id: string; renglonId: string; lineaDeOrden: number; confirmoExceso: boolean }[];
  }
): Promise<number> {
  const r = await tx.vinculoDeRenglonConOrden.createMany({
    data: p.vinculos.map((v) => ({
      id: v.id,
      facturaProveedorId: p.facturaProveedorId,
      facturaProveedorSucursalId: p.parteId,
      facturaProveedorRenglonId: v.renglonId,
      ordenId: p.ordenId,
      lineaDeOrden: v.lineaDeOrden,
      confirmoExceso: v.confirmoExceso,
      registradoPorId: p.registradoPorId,
    })),
  });
  return r.count;
}

/** Fija el nivel del control de exceso: crea la fila (la primera vez) o la actualiza con la guarda de versión. Devuelve el nivel anterior (`null` = no había fila, es decir PERMITIR). */
export async function escribirNivelDelControlDeExceso(tx: Db, p: { id: string; nivel: NivelDeControl; usuarioId: string; ahora: Date }): Promise<{ anterior: NivelDeControl | null }> {
  const actual = await tx.nivelDeControl.findFirst({ where: { control: CONTROL_RECEPCION_EXCEDE_LA_ORDEN }, select: { id: true, nivel: true, version: true } });
  if (!actual) {
    await tx.nivelDeControl.create({ data: { id: p.id, control: CONTROL_RECEPCION_EXCEDE_LA_ORDEN, nivel: p.nivel, actualizadoPorId: p.usuarioId, actualizadoEn: p.ahora } });
    return { anterior: null };
  }
  const r = await tx.nivelDeControl.updateMany({ where: { id: actual.id, version: actual.version }, data: { nivel: p.nivel, actualizadoPorId: p.usuarioId, actualizadoEn: p.ahora, version: actual.version + 1 } });
  if (r.count !== 1) throw new Error("escribirNivelDelControlDeExceso: la fila cambió en la transacción; se reintenta.");
  return { anterior: actual.nivel as NivelDeControl };
}
