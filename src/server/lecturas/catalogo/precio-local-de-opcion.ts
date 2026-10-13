import type { Prisma, PrismaClient } from "@prisma/client";
import { precioLocalActivoEn } from "./precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * GO-2b (ADR-030, decisión 5): el ÚNICO lugar que lee `PrecioLocalDeOpcion` (la grilla del modo ABSOLUTO de una MEDIDA en la sucursal) para decidir un precio.
 * Familia `override` de ADR-009: sin fila habilitada, rige el precio de la empresa. Rige solo con la capacidad `precio_local` prendida (la MISMA pregunta que el
 * precio local de los productos: `precioLocalActivoEn`, de `precio-local.ts`) y solo si el producto ADMITE la opción (`ProductoAdmiteOpcion` activa). Dos
 * consultas para todo el pedido (la capacidad y las filas); la llama la venta solo cuando se eligió una MEDIDA en ABSOLUTO. Devuelve el precio por
 * `productoId|opcionId`.
 *
 * Archivo HERMANO de `precio-local.ts` y no adentro: la carta pública alcanza `precio-local.ts` y su lista cerrada de campos (`carta-publica-lista-cerrada.test.ts`,
 * GT-13) no incluye la grilla de las opciones, que la carta no muestra. Lo fija `precio-local-en-un-solo-lugar.test.ts`.
 */
export async function preciosLocalesDeOpcionVigentes(
  sucursalId: string,
  db: Db,
  pares: readonly { productoId: string; opcionId: string }[]
): Promise<Map<string, number>> {
  if (pares.length === 0) return new Map();
  const [capacidadActiva, filas] = await Promise.all([
    precioLocalActivoEn(sucursalId, db),
    db.precioLocalDeOpcion.findMany({
      where: {
        sucursalId,
        habilitado: true,
        OR: pares.map((p) => ({ productoId: p.productoId, opcionId: p.opcionId, opcion: { productosQueLaAdmiten: { some: { productoId: p.productoId, activo: true } } } })),
      },
      select: { productoId: true, opcionId: true, precio: true },
    }),
  ]);
  if (!capacidadActiva) return new Map();
  return new Map(filas.map((f) => [`${f.productoId}|${f.opcionId}`, Number(f.precio)]));
}
