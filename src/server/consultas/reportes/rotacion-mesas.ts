import { rangoDeDias, ZONA_UTC } from "@/core/tiempo/zona-horaria";
import type { Db } from "@/lib/db-tipos";
import { calcularRotacionMesas, type ReporteRotacionMesas } from "@/core/reportes/public";

/**
 * Todas las cuentas de la sucursal ABIERTAS dentro de `[desde, hasta]` (mismo criterio de rango que el resto de los reportes —
 * `resolverRangoDeReporte`/`SelectorRango`, en UTC), con la lectura de rotación ya calculada.
 */
export async function generarReporteRotacionMesas(sucursalId: string, desdeParam: Date, hastaParam: Date, zonaHoraria: string, db: Db): Promise<ReporteRotacionMesas> {
  const { desde, hasta } = rangoDeDias(desdeParam, hastaParam, ZONA_UTC);
  const cuentas = await db.cuenta.findMany({
    where: { mesa: { sucursalId }, abiertaEn: { gte: desde, lte: hasta } },
    select: { abiertaEn: true, cerradaEn: true, comensales: true, _count: { select: { items: true } } },
  });
  return calcularRotacionMesas(cuentas.map((c) => ({ abiertaEn: c.abiertaEn, cerradaEn: c.cerradaEn, comensales: c.comensales, cantidadItems: c._count.items })), zonaHoraria);
}