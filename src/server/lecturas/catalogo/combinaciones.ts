import "server-only";
import type { Prisma } from "@prisma/client";
import { claveDeCombinacion } from "@/core/opciones/public";
import type { CombinacionesDelProducto } from "@/core/pos/public";
import { preciosLocalesDeCombinacionVigentes } from "./precio-local-de-combinaciones";
import { cargarRecetasVigentesDeCombinaciones } from "./recetas-de-combinacion";

/**
 * Lecturas de las COMBINACIONES de un producto (GO-3b, ADR-032, frente A), para VENDERLO. SIEMPRE con el `tx` de quien llama. Un id de otra empresa no se ve (RLS). Las lecturas de la
 * administración (los ejes y una combinación por su clave) se retiraron en la Fase 3 de la ola «precio y carta», con la pantalla de combinaciones.
 * Lo que decide un precio de la SUCURSAL no se lee acá: va en `precio-local-de-combinaciones.ts` (el embudo del precio local).
 */

type Tx = Prisma.TransactionClient;

/**
 * GO-3b (F5, I1): las COMBINACIONES de los productos con ejes de un pedido, para venderlas en la sucursal (la forma que pide `armarLineaConfigurada`): sus filas (activa o no, precio propio o tarifa
 * con su estado, y la versión VIGENTE de su receta propia, que la venta congela al agregar), y los precios locales VIGENTES de la sucursal (por el embudo del precio local). Quien llama pasa SOLO los
 * productos que tienen algún grupo eje (lo dice la lectura de las opciones): un pedido sin combinaciones no lee nada de acá. Cuatro consultas (filas, recetas, capacidad y precios locales).
 */
export async function cargarCombinacionesParaVender(
  tx: Tx,
  args: { sucursalId: string; productoIds: readonly string[] },
): Promise<Map<string, CombinacionesDelProducto>> {
  if (args.productoIds.length === 0) return new Map();
  const filas = await tx.combinacionDeProducto.findMany({
    where: { productoId: { in: [...args.productoIds] } },
    select: {
      id: true,
      productoId: true,
      opcionEje1Id: true,
      opcionEje2Id: true,
      activa: true,
      precio: true,
      producto: { select: { nombre: true } },
      grupoDePrecio: { select: { id: true, nombre: true, precio: true, activo: true } },
    },
  });
  const recetas = await cargarRecetasVigentesDeCombinaciones(tx, filas.map((f) => f.id));
  const locales = await preciosLocalesDeCombinacionVigentes(args.sucursalId, tx, {
    combinacionIds: filas.map((f) => f.id),
    grupoDePrecioIds: [...new Set(filas.flatMap((f) => (f.grupoDePrecio ? [f.grupoDePrecio.id] : [])))],
  });
  const resultado = new Map<string, CombinacionesDelProducto>();
  for (const productoId of new Set(args.productoIds)) {
    const propias = filas.filter((f) => f.productoId === productoId);
    resultado.set(productoId, {
      // El nombre solo aparece en un rechazo de una combinación que existe (sin filas no hay mensaje que lo use).
      nombreDelProducto: propias[0]?.producto.nombre ?? "",
      filas: new Map(
        propias.map((f) => [
          claveDeCombinacion(f),
          {
            combinacionId: f.id,
            activa: f.activa,
            precio: f.precio === null ? null : Number(f.precio),
            grupo: f.grupoDePrecio ? { grupoDePrecioId: f.grupoDePrecio.id, nombre: f.grupoDePrecio.nombre, precio: Number(f.grupoDePrecio.precio), activo: f.grupoDePrecio.activo } : null,
            recetaDeCombinacionVersionId: recetas.get(f.id)?.versionId ?? null,
          },
        ]),
      ),
      locales,
    });
  }
  return resultado;
}
