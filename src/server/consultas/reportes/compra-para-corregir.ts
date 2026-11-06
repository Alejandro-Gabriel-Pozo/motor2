import "server-only";
import { obtenerCostoActualPorMP } from "@/server/lecturas/reportes/comun";
import { listarComprasRegistradas } from "@/server/consultas/reportes/compras-registradas";
import type { CompraRegistrada } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo que necesita la pantalla «Corregir una factura de compra» (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md): la compra con sus renglones y, para cada renglón, si es la ENTRADA MÁS RECIENTE de su producto (la que fija el
 * costo de reposición: así la pantalla dice «el costo de reposición cambia» o «no cambia: hay una compra más reciente»). Solo lectura. `null` si no es una compra de esta sucursal (o quedó fuera de la página leída).
 */
export interface CompraParaCorregir {
  compra: CompraRegistrada;
  /** `idMovimiento` de los renglones que hoy fijan el costo de reposición de su producto. */
  renglonesQueFijanElCosto: ReadonlySet<string>;
}

export async function obtenerCompraParaCorregir(sucursalId: string, operacionId: string, db: Db, zona: string): Promise<CompraParaCorregir | null> {
  const { items } = await listarComprasRegistradas(sucursalId, {}, db, zona);
  const compra = items.find((c) => c.idOperacion === operacionId);
  if (!compra) return null;
  const costos = await obtenerCostoActualPorMP(sucursalId, db);
  const fijan = new Set<string>();
  for (const l of compra.renglones) {
    const costo = costos.get(l.productoId);
    if (costo?.fecha && costo.fecha.getTime() === compra.fecha.getTime() && Math.round(costo.precioPorUnidadStock * 100) === Math.round(l.precioPorUnidadStock * 100)) fijan.add(l.idMovimiento);
  }
  return { compra, renglonesQueFijanElCosto: fijan };
}
