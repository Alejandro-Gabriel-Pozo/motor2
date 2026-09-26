/**
 * Rango de un día en hora de ARGENTINA (Reporte de boletas emitidas, Task #17 del backlog) — EXCEPCIÓN documentada a la convención
 * del resto de los reportes, que cortan el día en UTC (`inicioDelDiaUtc`/`finDelDiaUtc` de compras-registradas.ts, `rangoUtc` de
 * periodo.ts). Motivo: el filtro de este reporte es sobre `EjemplarBoleta.emitidoEn`, y el servicio de la noche del restaurante
 * cruza la medianoche UTC (21 h de Argentina = 00 h UTC): un corte en UTC partiría en dos días distintos las boletas de una misma
 * noche de servicio. El resto de los reportes de dinero (ventas, compras, período) no tiene este problema porque agrega por
 * rango elegido por quien lo pide, no por "el día calendario del negocio".
 *
 * Argentina está en UTC-3 fijo TODO el año desde 2009 (no aplica horario de verano) — un offset constante es correcto para
 * cualquier fecha, pasada o futura, sin tabla de zonas horarias ni Intl.
 */
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/** "2026-09-26": el día de calendario en Argentina al que pertenece un instante UTC. 00:00 ART = 03:00 UTC del mismo día; 02:59 UTC
 *  todavía es el día ANTERIOR en Argentina (23:59 ART de la noche de antes). */
export function fechaArgentina(instante: Date): string {
  return new Date(instante.getTime() - OFFSET_ARGENTINA_MS).toISOString().slice(0, 10);
}

/** 00:00:00.000 de ese día en Argentina, como instante UTC (03:00:00.000 UTC del mismo día). `dia`: "YYYY-MM-DD". */
export function inicioDelDiaArgentina(dia: string): Date {
  return new Date(`${dia}T00:00:00.000-03:00`);
}

/** 23:59:59.999 de ese día en Argentina, como instante UTC (02:59:59.999 UTC del día siguiente). `dia`: "YYYY-MM-DD". */
export function finDelDiaArgentina(dia: string): Date {
  return new Date(`${dia}T23:59:59.999-03:00`);
}

/** El día de "hoy" en Argentina — default del filtro de fecha del reporte de boletas emitidas cuando no se pidió ningún rango. */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return fechaArgentina(ahora);
}
