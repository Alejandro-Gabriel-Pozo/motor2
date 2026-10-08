import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Deuda de arrastre de redondeo de cada producto, en ESTA sucursal, al momento de empezar la venta (Task #27, docs/plan-redondeo-
 * consumo-fraccionado-2026-09-26.md) — cargador con Prisma del núcleo puro `arrastre-redondeo.ts`, mismo criterio que
 * `origen-venta-datos.ts` para `origen-venta.ts`. `D = Σcantidad − ΣcantidadExacta` (ver el docstring de
 * `MovimientoStock.cantidadExacta`, schema.prisma), sumando solo las filas CONSUMO con `cantidadExacta` no nulo — las nulas aportan 0
 * por definición, ya que ahí `cantidad` YA era exacta. Filtra por `seccion.sucursalId` (una relación, no `seccionId: { in: [...] }`):
 * ya lo hacen `consignacion.ts:104` y `resumen-operativo.ts` con el mismo `groupBy`, así que el filtro por relación es un patrón
 * probado en esta versión de Prisma. SIEMPRE con `tx` (nunca `prisma` global): dos ventas concurrentes de la misma MP tienen que leer
 * esto dentro de la MISMA transacción SERIALIZABLE que arbitra el conflicto (ver el docstring del módulo, con-reintento.ts).
 *
 * Hito 5, 5.1-1: mudada TAL CUAL desde `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts` (mismo nombre, misma firma y mismo cuerpo); es una LECTURA, así que
 * vive en `server/lecturas` y la llama el caso de uso. La red que la fija es `test/movimientos/venta-linea-caracterizacion.test.ts` (C8: sin productos no lee; C9: solo la sucursal
 * de la venta) más las matrices de la venta.
 */
export async function cargarDeudaDeRedondeo(tx: Prisma.TransactionClient, sucursalId: string, productoIds: readonly string[]): Promise<Map<string, number>> {
  if (!productoIds.length) return new Map();
  const grupos = await tx.movimientoStock.groupBy({
    by: ["productoId"],
    where: { productoId: { in: productoIds as string[] }, cantidadExacta: { not: null }, seccion: { sucursalId } },
    _sum: { cantidad: true, cantidadExacta: true },
  });
  return new Map(grupos.map((g) => [g.productoId, Number(g._sum.cantidad ?? 0) - Number(g._sum.cantidadExacta ?? 0)]));
}
