import "server-only";
import { rangoDeDias, ZONA_UTC } from "@/core/tiempo/zona-horaria";
import type { Db } from "@/lib/db-tipos";
import { calcularRotacionMesas, MAXIMO_DE_CUENTAS_EN_ROTACION, type ReporteRotacionMesas } from "@/core/reportes/public";

/**
 * Las cuentas de la sucursal ABIERTAS dentro de `[desde, hasta]` (mismo criterio de rango que el resto de los reportes —
 * `resolverRangoDeReporte`/`SelectorRango`, en UTC), con la lectura de rotación ya calculada. Como mucho `MAXIMO_DE_CUENTAS_EN_ROTACION` (las más antiguas del rango): se pide una de
 * más para saber si había más y, en ese caso, el reporte sale con `truncado` en lugar de entregar un parcial como si fuera el total (S-28, GT-15).
 */
export async function generarReporteRotacionMesas(sucursalId: string, desdeParam: Date, hastaParam: Date, zonaHoraria: string, db: Db): Promise<ReporteRotacionMesas> {
  const { desde, hasta } = rangoDeDias(desdeParam, hastaParam, ZONA_UTC);
  const cuentas = await db.cuenta.findMany({
    where: { mesa: { sucursalId }, abiertaEn: { gte: desde, lte: hasta } },
    select: { abiertaEn: true, cerradaEn: true, comensales: true, _count: { select: { items: true } } },
    orderBy: { abiertaEn: "asc" },
    take: MAXIMO_DE_CUENTAS_EN_ROTACION + 1,
  });
  const truncado = cuentas.length > MAXIMO_DE_CUENTAS_EN_ROTACION;
  const reporte = calcularRotacionMesas(
    cuentas.slice(0, MAXIMO_DE_CUENTAS_EN_ROTACION).map((c) => ({ abiertaEn: c.abiertaEn, cerradaEn: c.cerradaEn, comensales: c.comensales, cantidadItems: c._count.items })),
    zonaHoraria,
  );
  return truncado ? { ...reporte, truncado: true } : reporte;
}