import type { Db } from "./comun";

/**
 * Reporte de rotación de mesas (módulo POS, docs/plan-comensales-y-limite-mesas-2026-09-26.md): comensales/cuenta promedio,
 * duración de mesa, y rotación por franja horaria y por tamaño de grupo. Usa `Cuenta.comensales` y `Cuenta.abiertaEn`/`cerradaEn`
 * — nada nuevo que registrar, solo lectura.
 *
 * «Atendidas» = cuentas CERRADAS con al menos un `CuentaItem` (aunque el neto haya quedado en cero: la mesa comió algo, aunque se
 * haya anulado todo). Las liberadas SIN consumo (`liberarMesa`: cerradas sin ningún ítem) se cuentan aparte y no entran en ninguna
 * métrica de comensales/duración/franja/grupo — no representan una mesa "atendida". Una cuenta atendida con `comensales: null`
 * (abierta antes de este campo, sin backfill) entra en los conteos generales pero no en los promedios por comensal.
 *
 * ZONA HORARIA: a diferencia del resto de los reportes de este proyecto (rango de fechas en UTC, ver rango-por-defecto.ts), la
 * FRANJA HORARIA de cada cuenta usa la hora LOCAL de Argentina (`Intl.DateTimeFormat` con `timeZone: "America/Argentina/Buenos_Aires"`,
 * NUNCA un offset fijo "-03:00": esa zona tiene horario de verano histórico y `Intl` lo resuelve bien para cualquier fecha). El
 * RANGO de fechas (`desde`/`hasta`, con `SelectorRango`) sigue en UTC, igual que todos los demás — solo la franja horaria difiere.
 */

const HORA_ARGENTINA = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });

/** La hora (0-23) de `fecha` en horario de Argentina. */
export function horaLocalArgentina(fecha: Date): number {
  return Number(HORA_ARGENTINA.format(fecha));
}

/** Bucket de tamaño de grupo: "1".."6" individual (mismo rango que los botones rápidos del modal de comensales) y "7+" el resto. */
export function grupoDeTamano(comensales: number): string {
  return comensales >= 7 ? "7+" : String(comensales);
}

const ORDEN_GRUPO = ["1", "2", "3", "4", "5", "6", "7+"];

function promedio(valores: readonly number[]): number | null {
  if (!valores.length) return null;
  return Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 10) / 10;
}

function duracionEnMinutos(abiertaEn: Date, cerradaEn: Date): number {
  return (cerradaEn.getTime() - abiertaEn.getTime()) / 60_000;
}

export interface FilaCuentaRotacion {
  abiertaEn: Date;
  cerradaEn: Date | null;
  comensales: number | null;
  /** Cuántas filas `CuentaItem` tiene (originales + espejos): >0 decide "atendida" vs "liberada sin consumo". */
  cantidadItems: number;
}

export interface FranjaHorariaRotacion {
  /** Hora local de Argentina (0-23) en la que se ABRIÓ la cuenta. */
  hora: number;
  cantidad: number;
  comensalesPromedio: number | null;
  duracionPromedioMin: number | null;
}

export interface GrupoTamanoRotacion {
  /** "1".."6", o "7+". */
  grupo: string;
  cantidad: number;
  duracionPromedioMin: number | null;
}

export interface ReporteRotacionMesas {
  /** Cuentas cerradas con al menos un ítem — la base de todas las métricas de acá abajo. */
  atendidas: number;
  /** Cerradas por `liberarMesa` (sin ningún ítem): no entran en ninguna métrica. */
  liberadasSinConsumo: number;
  /** Todavía abiertas dentro del rango pedido (informativo: ninguna métrica de duración las puede incluir, no tienen `cerradaEn`). */
  abiertasSinCerrar: number;
  /** De las atendidas, cuántas tienen `comensales` registrado (el resto son de antes de este campo). */
  cuentasConComensales: number;
  cuentasSinComensales: number;
  comensalesPromedio: number | null;
  duracionPromedioMin: number | null;
  /** Solo horas con al menos una cuenta atendida, ordenadas 0..23. */
  porFranjaHoraria: FranjaHorariaRotacion[];
  /** Solo grupos con al menos una cuenta atendida CON comensales, en el orden fijo "1".."6","7+". */
  porTamanoGrupo: GrupoTamanoRotacion[];
}

/** Núcleo puro: de las filas ya traídas de la base, todas las métricas del reporte. Ver el docstring del archivo para las reglas. */
export function calcularRotacionMesas(cuentas: readonly FilaCuentaRotacion[]): ReporteRotacionMesas {
  const cerradas = cuentas.filter((c) => c.cerradaEn !== null);
  const atendidas = cerradas.filter((c) => c.cantidadItems > 0);
  const liberadasSinConsumo = cerradas.filter((c) => c.cantidadItems === 0);
  const abiertasSinCerrar = cuentas.filter((c) => c.cerradaEn === null);

  const conComensales = atendidas.filter((c): c is FilaCuentaRotacion & { comensales: number } => c.comensales !== null);
  const duraciones = atendidas.map((c) => duracionEnMinutos(c.abiertaEn, c.cerradaEn as Date));

  const porHora = new Map<number, { cantidad: number; comensales: number[]; duraciones: number[] }>();
  for (const c of atendidas) {
    const hora = horaLocalArgentina(c.abiertaEn);
    const fila = porHora.get(hora) ?? { cantidad: 0, comensales: [], duraciones: [] };
    fila.cantidad += 1;
    if (c.comensales !== null) fila.comensales.push(c.comensales);
    fila.duraciones.push(duracionEnMinutos(c.abiertaEn, c.cerradaEn as Date));
    porHora.set(hora, fila);
  }

  const porGrupo = new Map<string, { cantidad: number; duraciones: number[] }>();
  for (const c of conComensales) {
    const grupo = grupoDeTamano(c.comensales);
    const fila = porGrupo.get(grupo) ?? { cantidad: 0, duraciones: [] };
    fila.cantidad += 1;
    fila.duraciones.push(duracionEnMinutos(c.abiertaEn, c.cerradaEn as Date));
    porGrupo.set(grupo, fila);
  }

  return {
    atendidas: atendidas.length,
    liberadasSinConsumo: liberadasSinConsumo.length,
    abiertasSinCerrar: abiertasSinCerrar.length,
    cuentasConComensales: conComensales.length,
    cuentasSinComensales: atendidas.length - conComensales.length,
    comensalesPromedio: promedio(conComensales.map((c) => c.comensales)),
    duracionPromedioMin: promedio(duraciones),
    porFranjaHoraria: [...porHora.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hora, f]) => ({ hora, cantidad: f.cantidad, comensalesPromedio: promedio(f.comensales), duracionPromedioMin: promedio(f.duraciones) })),
    porTamanoGrupo: ORDEN_GRUPO.filter((g) => porGrupo.has(g)).map((grupo) => {
      const f = porGrupo.get(grupo)!;
      return { grupo, cantidad: f.cantidad, duracionPromedioMin: promedio(f.duraciones) };
    }),
  };
}

/**
 * Rango inclusivo [desde 00:00 UTC, hasta 23:59:59.999 UTC] — mismo criterio que `rangoUtc` en periodo.ts: `desde`/`hasta`
 * llegan como Date "de solo día" (`SelectorRango`/`resolverRangoDeReporte`), así que sin extender `hasta` al final del día
 * quedaría en medianoche y el día de "hasta" (típicamente HOY) perdería todas las cuentas abiertas después de las 00:00 UTC.
 */
function rangoUtc(desde: Date, hasta: Date): { desde: Date; hasta: Date } {
  const d = new Date(desde);
  d.setUTCHours(0, 0, 0, 0);
  const h = new Date(hasta);
  h.setUTCHours(23, 59, 59, 999);
  return { desde: d, hasta: h };
}

/**
 * Todas las cuentas de la sucursal ABIERTAS dentro de `[desde, hasta]` (mismo criterio de rango que el resto de los reportes —
 * `resolverRangoDeReporte`/`SelectorRango`, en UTC), con la lectura de rotación ya calculada.
 */
export async function generarReporteRotacionMesas(sucursalId: string, desdeParam: Date, hastaParam: Date, db: Db): Promise<ReporteRotacionMesas> {
  const { desde, hasta } = rangoUtc(desdeParam, hastaParam);
  const cuentas = await db.cuenta.findMany({
    where: { mesa: { sucursalId }, abiertaEn: { gte: desde, lte: hasta } },
    select: { abiertaEn: true, cerradaEn: true, comensales: true, _count: { select: { items: true } } },
  });
  return calcularRotacionMesas(cuentas.map((c) => ({ abiertaEn: c.abiertaEn, cerradaEn: c.cerradaEn, comensales: c.comensales, cantidadItems: c._count.items })));
}
