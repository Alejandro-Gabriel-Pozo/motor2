import { Prisma } from "@prisma/client";
import { whereDisponibleEn } from "@/core/catalogo/public";
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
 * Alcance: la EMPRESA entera (la RLS acota a la empresa). Con `precioDeLaSucursal` (el carrito: D-B del dueño, 2026-10-07), cada oferta de la empresa trae ADEMÁS, en la MISMA
 * consulta, lo que compró esa sucursal (O.5, Hito 4, paso A4: antes el carrito llamaba dos veces a este lector, una por la empresa y otra filtrada por la sucursal). Sin
 * `import "server-only"`: lo importan pruebas y scripts.
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

/**
 * Una oferta de la empresa con lo de UNA sucursal (`precioDeLaSucursal`). Con la MISMA regla que el resto, restringida a las compras de esa sucursal (sus secciones): `null` en los
 * dos si la sucursal no tiene ninguna compra vigente del par; si tiene alguna, la fecha de su última compra y el precio de su última compra CON precio, o 0.
 */
export interface OfertaConLaSucursal extends OfertaDeProveedor {
  ultimaCompraEnLaSucursal: Date | null;
  precioEnLaSucursal: number | null;
}

export interface FiltroDeOfertas {
  proveedorId?: string;
  /** Sumar a cada oferta de la empresa lo que compró esta sucursal (`OfertaConLaSucursal`). Sin esto: solo la empresa. */
  precioDeLaSucursal?: string;
}

/** Una fila por (producto, proveedor) con al menos una compra vigente en la empresa, de la fecha más reciente a la más vieja. */
export async function cargarOfertasDeProveedores(db: Db, filtro: FiltroDeOfertas & { precioDeLaSucursal: string }): Promise<OfertaConLaSucursal[]>;
export async function cargarOfertasDeProveedores(db: Db, filtro?: FiltroDeOfertas): Promise<OfertaDeProveedor[]>;
export async function cargarOfertasDeProveedores(db: Db, filtro: FiltroDeOfertas = {}): Promise<OfertaDeProveedor[] | OfertaConLaSucursal[]> {
  const { proveedorId, precioDeLaSucursal: suc } = filtro;
  // Con la sucursal: `vigentes` lleva la sucursal de cada compra (por su sección) y dos CTE más —`ultima_suc` y `ultimo_precio_suc`— repiten `ultima` y `ultimo_precio` solo con
  // las compras de esa sucursal. El JOIN con "Seccion" va SOLO con la opción (la de la empresa sigue igual que antes); `MovimientoStock.seccionId` es obligatoria, así que el JOIN
  // no descarta ninguna compra de la empresa.
  const derivadas = await db.$queryRaw<
    Array<{ productoId: string; proveedorId: string; ultimaCompra: Date; precioPorUnidadStock: Prisma.Decimal; ultimaCompraEnLaSucursal?: Date | null; precioEnLaSucursal?: Prisma.Decimal | null }>
  >`
    WITH vigentes AS (
      SELECT m."productoId", o."proveedorId", o."fecha", m."id", m."precioPorUnidadStock"${suc ? Prisma.sql`, s."sucursalId"` : Prisma.empty}
      FROM "MovimientoStock" m
      JOIN "Operacion" o ON o."id" = m."operacionId"
      ${suc ? Prisma.sql`JOIN "Seccion" s ON s."id" = m."seccionId"` : Prisma.empty}
      WHERE m."proceso" = 'COMPRA' AND o."proceso" = 'COMPRA'
        AND o."anuladaEn" IS NULL AND o."proveedorId" IS NOT NULL
        ${proveedorId ? Prisma.sql`AND o."proveedorId" = ${proveedorId}` : Prisma.empty}
    ),
    ultima AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "fecha" AS "ultimaCompra"
      FROM vigentes ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    ),
    ultimo_precio AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "precioPorUnidadStock"
      FROM vigentes WHERE "precioPorUnidadStock" > 0
      ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    )${
      suc
        ? Prisma.sql`,
    ultima_suc AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "fecha" AS "ultimaCompra"
      FROM vigentes WHERE "sucursalId" = ${suc}
      ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    ),
    ultimo_precio_suc AS (
      SELECT DISTINCT ON ("productoId", "proveedorId") "productoId", "proveedorId", "precioPorUnidadStock"
      FROM vigentes WHERE "sucursalId" = ${suc} AND "precioPorUnidadStock" > 0
      ORDER BY "productoId", "proveedorId", "fecha" DESC, "id" DESC
    )`
        : Prisma.empty
    }
    SELECT u."productoId", u."proveedorId", u."ultimaCompra", COALESCE(p."precioPorUnidadStock", 0) AS "precioPorUnidadStock"${
      suc
        ? Prisma.sql`,
      us."ultimaCompra" AS "ultimaCompraEnLaSucursal",
      CASE WHEN us."productoId" IS NULL THEN NULL ELSE COALESCE(ps."precioPorUnidadStock", 0) END AS "precioEnLaSucursal"`
        : Prisma.empty
    }
    FROM ultima u LEFT JOIN ultimo_precio p ON p."productoId" = u."productoId" AND p."proveedorId" = u."proveedorId"
    ${
      suc
        ? Prisma.sql`LEFT JOIN ultima_suc us ON us."productoId" = u."productoId" AND us."proveedorId" = u."proveedorId"
    LEFT JOIN ultimo_precio_suc ps ON ps."productoId" = u."productoId" AND ps."proveedorId" = u."proveedorId"`
        : Prisma.empty
    }
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
    const oferta: OfertaDeProveedor = {
      productoId: d.productoId,
      proveedorId: d.proveedorId,
      ultimaCompra: d.ultimaCompra,
      precioPorUnidadStock: Number(d.precioPorUnidadStock),
      unidadCompraId: unidad?.unidadCompraId ?? "",
      unidadCompraNombre: unidad?.unidadCompraNombre ?? "",
      referenciaProveedor: propias?.find((f) => f.referenciaProveedor !== null)?.referenciaProveedor ?? null,
    };
    if (!suc) return oferta;
    return {
      ...oferta,
      ultimaCompraEnLaSucursal: d.ultimaCompraEnLaSucursal ?? null,
      precioEnLaSucursal: d.precioEnLaSucursal === null || d.precioEnLaSucursal === undefined ? null : Number(d.precioEnLaSucursal),
    } satisfies OfertaConLaSucursal;
  });
}

/** Una fila del carrito de una Compra precargado con lo que ya se le compra a un proveedor (`cargarProductosDeProveedorParaElCarrito`). */
export interface ProductoDeProveedor {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  // O.10 (Hito 4): sin `unidadCompraId`/`unidadCompraNombre`. La precarga del carrito no los usaba (pone `unidadCompraId: ""` = la unidad por defecto del
  // producto, a propósito: ver `panel-movimiento-form.tsx`); la unidad de la última compra al proveedor sigue en `cargarOfertasDeProveedores` (la ficha y la comparativa).
  unidadStockNombre: string;
  referenciaProveedor: string | null;
  ultimoPrecioPorUnidadStock: number;
  ultimaCompra: Date;
  /** De dónde sale el precio: lo último que compró ESTA sucursal a este proveedor, o (si nunca le compró este producto) lo último que compró la empresa —otra sucursal—. La pantalla lo rotula. */
  origenDelPrecio: "SUCURSAL" | "EMPRESA";
}

/**
 * La precarga del carrito de una Compra (la usa `listarProductosDeProveedor`, `src/server/actions/catalogo/proveedor-por-producto.ts`, que exige el permiso): los productos que la
 * EMPRESA le compró a este proveedor y están disponibles en esta sucursal, más recientes primero. Sale del Kardex VIGENTE (`cargarOfertasDeProveedores`), no de la tabla
 * `ProveedorPorProducto`: una compra anulada o de un proveedor corregido ya no aparece ni da precio. El PRECIO es el de la última compra de ESTA sucursal y, si esta sucursal nunca le
 * compró ese producto, el de la última de la empresa (otra sucursal), marcado con `origenDelPrecio: "EMPRESA"` para que la pantalla lo diga (decisión del dueño, 2026-10-07).
 *
 * Hito 4, paso A2: es la composición que vivía en la Server Action, mudada tal cual para poder contar sus consultas con una base espiada
 * (`test/catalogo/carrito-de-proveedor-consultas.test.ts`). Paso A4 (O.5): las dos lecturas de ofertas (la de la empresa y la filtrada por la sucursal) pasan a ser UNA, con
 * `precioDeLaSucursal` (la sucursal viene en la misma consulta): «propio» si y solo si la sucursal tiene alguna compra vigente del par, con su precio (el último > 0 de la
 * sucursal, o 0) y su fecha; si no, los de la empresa. Mismo resultado; de 5 consultas (7 sin filas en la tabla) a 3 (4).
 */
export async function cargarProductosDeProveedorParaElCarrito(db: Db, proveedorId: string, sucursalId: string): Promise<ProductoDeProveedor[]> {
  const deLaEmpresa = await cargarOfertasDeProveedores(db, { proveedorId, precioDeLaSucursal: sucursalId });
  if (deLaEmpresa.length === 0) return [];
  const productos = new Map(
    (
      await db.producto.findMany({
        where: { id: { in: deLaEmpresa.map((o) => o.productoId) }, ...whereDisponibleEn(sucursalId) },
        include: { unidadStock: true },
      })
    ).map((p) => [p.id, p])
  );

  return deLaEmpresa
    .filter((o) => productos.has(o.productoId))
    .map((o) => {
      const producto = productos.get(o.productoId)!;
      // «Propio» si y solo si la sucursal tiene alguna compra vigente del par (su fecha no es null); su precio puede ser 0 (ninguna de la sucursal con precio).
      const propia = o.ultimaCompraEnLaSucursal !== null;
      return {
        productoId: o.productoId,
        productoCodigo: producto.codigo,
        productoNombre: producto.nombre,
        unidadStockNombre: producto.unidadStock.nombre,
        referenciaProveedor: o.referenciaProveedor,
        ultimoPrecioPorUnidadStock: propia ? (o.precioEnLaSucursal ?? 0) : o.precioPorUnidadStock,
        ultimaCompra: o.ultimaCompraEnLaSucursal ?? o.ultimaCompra,
        origenDelPrecio: propia ? ("SUCURSAL" as const) : ("EMPRESA" as const),
      };
    })
    .sort((a, b) => b.ultimaCompra.getTime() - a.ultimaCompra.getTime() || a.productoNombre.localeCompare(b.productoNombre));
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
