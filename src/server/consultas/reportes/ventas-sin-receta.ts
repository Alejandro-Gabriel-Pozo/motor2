import { construirMapaProductos } from "@/core/reportes/public-servidor";
import type { Db } from "@/lib/db-tipos";
import type { FilaVentaSinReceta } from "@/core/reportes/public";

/**
 * Port de generarReporteVentasSinReceta_ (Reportes.js:1063-1112) — un PV se
 * puede vender sin receta cargada (la venta se registra igual, no
 * descuenta stock de ninguna MP). Cada venta es su propia Operacion
 * (registrarVenta, venta.ts) que comparte `operacionId` con sus líneas
 * CONSUMO si la receta generó alguna — así que "venta sin receta" es,
 * directo, una fila VENTA cuya Operacion no tiene ninguna fila CONSUMO
 * asociada (acá se resuelve con una FK real, no comparando IDs de texto).
 */
export async function generarReporteVentasSinReceta(sucursalId: string, db: Db): Promise<FilaVentaSinReceta[]> {
  // Se agrega en SQL: traer una fila por venta (y luego un `in` con todos sus `operacionId`) superaba el límite de parámetros de
  // Prisma 7 con ~60k ventas. La sucursal fija la empresa (`Seccion` y `Operacion` la comparten por FK compuesta); el aislamiento
  // entre empresas lo sigue haciendo el `db` recibido (RLS, A6).
  const ventas = await db.$queryRaw<Array<{ productoId: string; cantidad: bigint; primeraFecha: Date; ultimaFecha: Date }>>`
    SELECT m."productoId", count(*) AS "cantidad", min(o."fecha") AS "primeraFecha", max(o."fecha") AS "ultimaFecha"
    FROM "MovimientoStock" m
    JOIN "Operacion" o ON o."id" = m."operacionId"
    JOIN "Seccion" s ON s."id" = m."seccionId"
    WHERE m."proceso" = 'VENTA' AND s."sucursalId" = ${sucursalId}
      AND o."anuladaEn" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "MovimientoStock" c WHERE c."operacionId" = m."operacionId" AND c."proceso" = 'CONSUMO')
    GROUP BY m."productoId"
  `;
  if (!ventas.length) return [];

  const productos = await construirMapaProductos(undefined, db);
  const porProducto = new Map<string, { cantidadVentasSinReceta: number; primeraFecha: Date; ultimaFecha: Date }>();

  for (const v of ventas) {
    if (productos.get(v.productoId)?.tipo !== "PV") continue;
    porProducto.set(v.productoId, { cantidadVentasSinReceta: Number(v.cantidad), primeraFecha: v.primeraFecha, ultimaFecha: v.ultimaFecha });
  }

  return Array.from(porProducto.entries())
    .map(([productoId, acc]) => ({ productoId, producto: productos.get(productoId)!.nombre, codigo: productos.get(productoId)!.codigo, ...acc }))
    .sort((a, b) => b.ultimaFecha.getTime() - a.ultimaFecha.getTime());
}