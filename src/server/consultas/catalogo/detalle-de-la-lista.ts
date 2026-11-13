import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { claseDelProducto, textoDelPrecioEnLaLista, type TipoFiltrable } from "@/core/catalogo/public";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";

type Db = PrismaClient | Prisma.TransactionClient;

/** Lo que dice la fila de la lista de Productos además de su nombre: el precio y qué es. */
export interface DetalleDeLaFila {
  /** El precio de la sucursal activa («$ 9.500,00»), «Según medida», «Sin precio» o `null` (lo que no se vende). */
  precio: string | null;
  /** Qué es, en la palabra del chip «¿Qué es?» (`TIPOS_FILTRABLES`). */
  clase: TipoFiltrable;
}

/**
 * El precio y la clase de cada fila de una página de la lista de Productos (docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1), en dos consultas para toda la página (sin N+1). El precio es el de la
 * sucursal ACTIVA: el precio propio vigente (capacidad `precio_local` + fila habilitada: `preciosLocalesVigentes` es el único lugar que lo decide) o, si no hay, el central. El texto lo arma
 * `textoDelPrecioEnLaLista` (puro). Quien llama ya validó el permiso de ver el catálogo (la lista misma lo exige); acá no se lee nada que la ficha no muestre.
 */
export async function detalleDeLaLista(db: Db, sucursalId: string, ids: readonly string[]): Promise<Map<string, DetalleDeLaFila>> {
  if (ids.length === 0) return new Map();
  const [filas, preciosLocales] = await Promise.all([
    db.producto.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, tipo: true, modoDeVenta: true, precioVenta: true, seProduce: true, opcionQueRespalda: { select: { id: true } } },
    }),
    preciosLocalesVigentes(sucursalId, db, ids),
  ]);
  return new Map(
    filas.map((p) => [
      p.id,
      {
        clase: claseDelProducto({ tipo: p.tipo, seProduce: p.seProduce, respaldaUnaOpcion: p.opcionQueRespalda !== null }),
        precio: textoDelPrecioEnLaLista({ tipo: p.tipo, modoDeVenta: p.modoDeVenta, precio: preciosLocales.get(p.id)?.precio ?? Number(p.precioVenta) }),
      },
    ])
  );
}
