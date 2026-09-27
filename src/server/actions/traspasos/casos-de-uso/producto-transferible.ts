import "server-only";
import type { Prisma } from "@prisma/client";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { tieneStockReal } from "@/core/movimientos/public";
import { MENSAJE_PRODUCTO_NO_EXISTE } from "@/core/features/traspasos/traspaso-comandos.guard";
import { cargarProductoParaTraspaso, type ProductoParaTraspaso } from "@/server/persistencia/traspasos/cargar-traspaso";

/**
 * «El producto es transferible» DENTRO de la transacción de un caso de uso de traspasos (Task #41, Fase M11a; lo reusan
 * `aceptar-traspaso.ts`, M11b, y las dos creaciones, M11c). Es la regla que antes vivía en `obtenerProductoTransferible` de
 * src/server/actions/traspasos/traspasos.ts (borrado en la M11c, cuando la última Server Action dejó de usarlo), con los mismos textos:
 * existe, tiene stock real, y está disponible en TODAS las sucursales dadas (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.5),
 * en ese orden. Al crear se pasan origen Y destino; al re-chequear en cada paso siguiente, la que corresponda.
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
  if (!producto) return { ok: false, mensaje: MENSAJE_PRODUCTO_NO_EXISTE };
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
