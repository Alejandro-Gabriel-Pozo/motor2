import "server-only";
import { obtenerResumenOperativo } from "@/server/consultas/reportes/resumen-operativo";
import type { Db } from "@/lib/db-tipos";
import type { FilaResumenConsolidado } from "@/core/reportes/public";

/**
 * Un resumen operativo por sucursal, lado a lado — para quien pertenece a
 * varias (ver src/core/auth/contexto.ts, `membresias`). Reusa
 * obtenerResumenOperativo tal cual (ya probado por sucursal), no
 * reimplementa el cálculo — esto solo junta filas, una consulta en
 * paralelo por sucursal.
 */
export async function obtenerResumenConsolidado(
  sucursales: { id: string; nombre: string }[],
  db: Db,
  ahora: Date
): Promise<FilaResumenConsolidado[]> {
  const resumenes = await Promise.all(sucursales.map((s) => obtenerResumenOperativo(s.id, db, ahora)));
  return sucursales.map((s, i) => {
    const r = resumenes[i];
    return {
      sucursalId: s.id,
      sucursalNombre: s.nombre,
      ventasTotal: r.financiero.ventasTotal,
      margenTotal: r.financiero.margenTotal,
      gastadoTotal: r.financiero.gastadoTotal,
      alertasCriticas: r.alertas.criticos,
      alertasBajas: r.alertas.bajos,
    };
  });
}