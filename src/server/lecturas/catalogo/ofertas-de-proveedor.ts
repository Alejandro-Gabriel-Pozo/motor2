import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo que cada proveedor le vendió a la empresa, DERIVADO del Kardex vigente (Pureza Fase 4, vínculo proveedor↔producto, parte 2; decisión del dueño 2026-10-06). La comparativa de
 * precios, la ficha del proveedor y la precarga del carrito leían la tabla `ProveedorPorProducto`, un caché que se escribe en cada compra y que NO se entera de que una compra se
 * anuló ni de que se le corrigió el proveedor: mostraba el precio de una factura que ya «no ocurrió», mientras el costo de reposición (`obtenerCostoActualPorMP`) sí la ignoraba — dos
 * verdades distintas. Acá el precio y la fecha salen de las compras VIGENTES, con la misma regla que el costo de reposición (que solo mira el movimiento; este lector mira también la operación: hoy no hay caso en que difieran):
 *  - solo cuentan los movimientos y operaciones de proceso COMPRA con proveedor y sin anular (una devolución al proveedor es otro proceso: nunca es «la última compra»);
 *  - la última compra es la de fecha más reciente (empate: la de mayor `id`, un desempate determinista —el cuid lleva la hora al frente, así que en la práctica es la cargada después—);
 *  - «un precio 0 nunca pisa uno bueno»: el precio es el de la última compra CON precio; si ninguna lo tiene, 0 («proveedor conocido, sin precio»).
 * Hasta acá, lo que SÍ sale de la tabla: la unidad de compra y la referencia del proveedor, que el Kardex no guarda (la tabla es el único lugar donde viven; ver la M3 `[MIG]` del plan).
 * Desde 2026-10-07 toda compra con proveedor escribe su fila (un producto sin unidad de compra usa su unidad de stock), así que una oferta sin fila solo existe para compras ANTERIORES a ese cambio: usa la
 * unidad de compra del producto, o la de stock si no tiene (y sin referencia, que nunca se guardó).
 *
 * Alcance: la EMPRESA entera (la RLS acota a la empresa) o, con `sucursalId`, solo lo comprado por esa sucursal (el carrito: D-B del dueño, 2026-10-07). Sin `import "server-only"`: lo
 * importan pruebas y scripts.
 */
export interface OfertaDeProveedor {
  productoId: string;
  proveedorId: string;
  ultimaCompra: Date;
  /** Precio de la última compra con precio (por unidad de stock); 0 si ninguna compra vigente lo tiene. */
  precioPorUnidadStock: number;
  unidadCompraId: string;
  unidadCompraNombre: string;
  referenciaProveedor: string | null;
}

export interface FiltroDeOfertas {
  proveedorId?: string;
  /** Solo lo comprado por esta sucursal (sus secciones). Sin esto: toda la empresa. */
  sucursalId?: string;
}

/** Una fila por (producto, proveedor) con al menos una compra vigente, de la fecha más reciente a la más vieja. */
export async function cargarOfertasDeProveedores(db: Db, filtro: FiltroDeOfertas = {}): Promise<OfertaDeProveedor[]> {
  const { proveedorId, sucursalId } = filtro;
  const derivadas = await db.$queryRaw<Array<{ productoId: string; proveedorId: string; ultimaCompra: Date; precioPorUnidadStock: Prisma.Decimal }>>`
    WITH vigentes AS (
      SELECT m."productoId", o."proveedorId", o."fecha", m."id", m."precioPorUnidadStock"
      FROM "MovimientoStock" m
      JOIN "Operacion" o ON o."id" = m."operacionId"
      ${sucursalId ? Prisma.sql`JOIN "Seccion" s ON s."id" = m."seccionId"` : Prisma.empty}
      WHERE m."proceso" = 'COMPRA' AND o."proceso" = 'COMPRA'
        AND o."anuladaEn" IS NULL AND o."proveedorId" IS NOT NULL
        ${proveedorId ? Prisma.sql`AND o."proveedorId" = ${proveedorId}` : Prisma.empty}
        ${sucursalId ? Prisma.sql`AND s."sucursalId" = ${sucursalId}` : Prisma.empty}
    ),
    ultima AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "fecha" AS "ultimaCompra"
      FROM vigentes ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    ),
    ultimo_precio AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "precioPorUnidadStock"
      FROM vigentes WHERE "precioPorUnidadStock" > 0
      ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    )
    SELECT u."productoId", u."proveedorId", u."ultimaCompra", COALESCE(p."precioPorUnidadStock", 0) AS "precioPorUnidadStock"
    FROM ultima u LEFT JOIN ultimo_precio p ON p."productoId" = u."productoId" AND p."proveedorId" = u."proveedorId"
    ORDER BY u."ultimaCompra" DESC, u."productoId", u."proveedorId"
  `;
  if (derivadas.length === 0) return [];

  // Unidad de compra y referencia: de la tabla (la fila más reciente de cada par; la referencia, la más reciente que tenga una).
  const filas = await db.proveedorPorProducto.findMany({
    where: proveedorId ? { proveedorId } : {},
    select: { productoId: true, proveedorId: true, unidadCompraId: true, referenciaProveedor: true, unidadCompra: { select: { nombre: true } } },
    orderBy: [{ ultimaCompra: "desc" }, { id: "desc" }],
  });
  const delPar = new Map<string, typeof filas>();
  for (const f of filas) {
    const clave = `${f.productoId}|${f.proveedorId}`;
    const lista = delPar.get(clave);
    if (lista) lista.push(f);
    else delPar.set(clave, [f]);
  }

  // Un par sin fila en la tabla (solo compras anteriores a que toda compra escribiera su fila): la unidad de compra del producto, o la de stock.
  const sinFila = derivadas.filter((d) => !delPar.has(`${d.productoId}|${d.proveedorId}`)).map((d) => d.productoId);
  const productos =
    sinFila.length === 0
      ? new Map<string, { unidadCompraId: string; unidadCompraNombre: string }>()
      : new Map(
          (
            await db.producto.findMany({
              where: { id: { in: Array.from(new Set(sinFila)) } },
              select: { id: true, unidadStock: { select: { id: true, nombre: true } }, unidadCompra: { select: { id: true, nombre: true } } },
            })
          ).map((p) => [p.id, { unidadCompraId: (p.unidadCompra ?? p.unidadStock).id, unidadCompraNombre: (p.unidadCompra ?? p.unidadStock).nombre }])
        );

  return derivadas.map((d) => {
    const propias = delPar.get(`${d.productoId}|${d.proveedorId}`);
    const unidad = propias ? { unidadCompraId: propias[0].unidadCompraId, unidadCompraNombre: propias[0].unidadCompra.nombre } : productos.get(d.productoId);
    return {
      productoId: d.productoId,
      proveedorId: d.proveedorId,
      ultimaCompra: d.ultimaCompra,
      precioPorUnidadStock: Number(d.precioPorUnidadStock),
      unidadCompraId: unidad?.unidadCompraId ?? "",
      unidadCompraNombre: unidad?.unidadCompraNombre ?? "",
      referenciaProveedor: propias?.find((f) => f.referenciaProveedor !== null)?.referenciaProveedor ?? null,
    };
  });
}

/**
 * Los productos que la empresa le compró alguna vez (y sigue vigente) a ALGÚN proveedor: para los reportes «tiene proveedor». Misma regla que `cargarOfertasDeProveedores` —una compra
 * anulada o sin proveedor no cuenta—, pero sin traer precios ni filas: una consulta con `DISTINCT`.
 */
export async function cargarProductosConProveedor(db: Db): Promise<Set<string>> {
  const filas = await db.$queryRaw<Array<{ productoId: string }>>`
    SELECT DISTINCT m."productoId"
    FROM "MovimientoStock" m
    JOIN "Operacion" o ON o."id" = m."operacionId"
    WHERE m."proceso" = 'COMPRA' AND o."proceso" = 'COMPRA' AND o."anuladaEn" IS NULL AND o."proveedorId" IS NOT NULL
  `;
  return new Set(filas.map((f) => f.productoId));
}
