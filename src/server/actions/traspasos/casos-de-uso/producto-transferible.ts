import "server-only";
import type { Prisma } from "@prisma/client";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { tieneStockReal } from "@/core/movimientos/public";
import { cargarProductoParaTraspaso, type ProductoParaTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";

/**
 * Re-chequeo «el producto sigue siendo transferible» DENTRO de la transacción de un caso de uso de traspasos (Task #41, Fase M11a).
 * Es la misma regla, con los mismos textos, que `obtenerProductoTransferible` de src/server/actions/traspasos/traspasos.ts — que sigue
 * ahí para las Server Actions todavía sin migrar (M11b/M11c) y se borra cuando la última deje de usarla: existe, tiene stock real, y
 * está disponible en TODAS las sucursales dadas (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.5), en ese orden.
 *
 * No es un endpoint ni un caso de uso propio: es un paso compartido por los casos de uso de `casos-de-uso/` (por eso vive acá, con
 * `import "server-only"`, y puede leer `server/persistencia/`).
 */
export async function verificarProductoTransferible(
  tx: Prisma.TransactionClient,
  productoId: string,
  sucursales: { sucursalId: string; sucursalNombre: string }[]
): Promise<{ ok: true; producto: ProductoParaTraspaso } | { ok: false; mensaje: string }> {
  const producto = await cargarProductoParaTraspaso(tx, productoId);
  if (!producto) return { ok: false, mensaje: "El producto no existe." };
  if (!tieneStockReal(producto.tipo, producto.seProduce)) {
    return { ok: false, mensaje: `"${producto.nombre}" no tiene stock real — no se puede transferir.` };
  }
  for (const s of sucursales) {
    if (!(await productoDisponibleEn(s.sucursalId, producto.id, tx))) {
      return { ok: false, mensaje: `«${producto.nombre}» no está disponible en «${s.sucursalNombre}»: activalo allá antes de enviar.` };
    }
  }
  return { ok: true, producto };
}
