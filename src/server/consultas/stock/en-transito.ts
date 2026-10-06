import "server-only";
import { armarStockEnTransito, type FilaStockEnTransito } from "@/core/stock/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Stock en tránsito de una sucursal (traspasos ENVIADA / RECHAZADA_DESTINO que ya salieron de un Kardex y todavía no figuran en otro). La lectura
 * vive acá; el armado de las filas es puro y vive en `core/stock/en-transito.ts` (Pureza Fase 3). Sin guarda de permiso adentro: la página la pone antes.
 */
export async function calcularStockEnTransito(sucursalId: string, db: Db): Promise<FilaStockEnTransito[]> {
  const traspasos = await db.traspasoSucursal.findMany({
    where: {
      OR: [
        { estado: "ENVIADA", origenSucursalId: sucursalId },
        { estado: "ENVIADA", destinoSucursalId: sucursalId },
        { estado: "RECHAZADA_DESTINO", origenSucursalId: sucursalId },
      ],
    },
    select: {
      estado: true,
      origenSucursalId: true,
      cantidad: true,
      producto: { select: { id: true, codigo: true, nombre: true, unidadStock: { select: { nombre: true } } } },
    },
  });

  return armarStockEnTransito(
    traspasos.map((t) => ({ ...t, cantidad: Number(t.cantidad) })),
    sucursalId,
  );
}
