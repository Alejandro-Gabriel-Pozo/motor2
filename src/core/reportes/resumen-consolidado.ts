import { obtenerResumenOperativo } from "./resumen-operativo";
import type { Db } from "./comun";
import { prisma } from "@/lib/db";

export interface FilaResumenConsolidado {
  sucursalId: string;
  sucursalNombre: string;
  ventasTotal: number;
  margenTotal: number;
  gastadoTotal: number;
  alertasCriticas: number;
  alertasBajas: number;
}

/**
 * Un resumen operativo por sucursal, lado a lado — para quien pertenece a
 * varias (ver src/core/auth/contexto.ts, `membresias`). Reusa
 * obtenerResumenOperativo tal cual (ya probado por sucursal), no
 * reimplementa el cálculo — esto solo junta filas, una consulta en
 * paralelo por sucursal.
 */
export async function obtenerResumenConsolidado(
  sucursales: { id: string; nombre: string }[],
  db: Db = prisma
): Promise<FilaResumenConsolidado[]> {
  const resumenes = await Promise.all(sucursales.map((s) => obtenerResumenOperativo(s.id, db)));
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
