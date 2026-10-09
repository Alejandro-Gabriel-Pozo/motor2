import "server-only";
import type { Prisma } from "@prisma/client";
import { claveDeLote, type LineaComprada, type SaldosPorLote } from "@/core/compras/public";

/**
 * Carga de una compra para ANULARLA (Task #41, Fase M — primer archivo de `src/server/persistencia/`, ver
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Es EXACTAMENTE la lectura que antes hacía en línea `anularCompra`
 * (src/server/actions/movimientos/compras.ts): el `findFirst` de la operación de ESTA sucursal con sus líneas, y una sola consulta
 * agrupada con el saldo actual por (producto, sección, lote) de lo que esa compra tocó.
 *
 * Contrato de la capa de persistencia de ESCRITURA (distinto del piloto de LECTURA de `server/consultas/`, que recibe `db`):
 *  - `tx` OBLIGATORIO como primer parámetro: siempre corre dentro de la transacción SERIALIZABLE de quien la llama (el caso de uso);
 *    nunca abre una conexión ni una transacción propia.
 *  - Devuelve TIPOS DE DOMINIO (`LineaComprada`, `SaldosPorLote` de core/compras/anulacion.ts), no `Prisma.*GetPayload`: los
 *    `Decimal` se convierten a `number` acá, en el borde.
 *  - Sin reglas de negocio: qué hacer con lo cargado lo decide `evaluarAnulacion`.
 */

/** La compra tal como la necesita el caso de uso `anularCompra`. `proceso` puede no ser COMPRA: eso lo rechaza `evaluarAnulacion`. */
export interface CompraParaAnular {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  fecha: Date;
  /** Cuándo se ESCRIBIÓ la compra (`Operacion.creadoEn`, el reloj de la base): desde cuándo un conteo o un ajuste es «posterior» a ella (M-3, D7). `fecha` la fija quien carga. */
  creadoEn: Date;
  nroFactura: string | null;
  /** `null` si la compra no tiene proveedor. */
  proveedorNombre: string | null;
  lineas: LineaComprada[];
  /** Saldo actual por (producto, sección, lote) de lo que esta compra tocó, con la clave de `claveDeLote`. */
  saldos: SaldosPorLote;
}

/** `null` si no hay ninguna operación con ese id en esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCompraParaAnular(
  tx: Prisma.TransactionClient,
  args: { operacionId: string; sucursalId: string }
): Promise<CompraParaAnular | null> {
  const operacion = await tx.operacion.findFirst({
    where: { id: args.operacionId, sucursalId: args.sucursalId },
    include: {
      proveedor: { select: { nombre: true } },
      movimientos: { include: { producto: { select: { codigo: true, nombre: true } }, seccion: { select: { nombre: true } } } },
    },
  });
  if (!operacion) return null;

  // Saldo actual por (producto, sección, lote) de lo que esta compra tocó: una sola consulta agrupada. Trae TODOS los lotes (y el «sin lote») de cada par: de ahí
  // sale también el saldo TOTAL del (producto, sección) que exige `evaluarAnulacion` (S-02), sin una consulta nueva. NO filtrar por lote acá.
  const saldosAgrupados = await tx.movimientoStock.groupBy({
    by: ["productoId", "seccionId", "loteVencimiento"],
    where: {
      productoId: { in: [...new Set(operacion.movimientos.map((m) => m.productoId))] },
      seccionId: { in: [...new Set(operacion.movimientos.map((m) => m.seccionId))] },
    },
    _sum: { cantidad: true },
  });
  const saldos = new Map(saldosAgrupados.map((s) => [claveDeLote(s.productoId, s.seccionId, s.loteVencimiento), Number(s._sum.cantidad ?? 0)]));

  const lineas: LineaComprada[] = operacion.movimientos.map((m) => ({
    productoId: m.productoId,
    productoCodigo: m.producto.codigo,
    productoNombre: m.producto.nombre,
    seccionId: m.seccionId,
    seccionNombre: m.seccion.nombre,
    loteVencimiento: m.loteVencimiento,
    cantidad: Number(m.cantidad),
    precioTotal: Number(m.precioTotal),
    precioPorUnidadStock: Number(m.precioPorUnidadStock),
    detalle: m.detalle,
  }));

  return {
    id: operacion.id,
    proceso: operacion.proceso,
    anuladaEn: operacion.anuladaEn,
    fecha: operacion.fecha,
    creadoEn: operacion.creadoEn,
    nroFactura: operacion.nroFactura,
    proveedorNombre: operacion.proveedor ? operacion.proveedor.nombre : null,
    lineas,
    saldos,
  };
}
