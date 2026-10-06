/**
 * Zona horaria: el ÚNICO lugar del código que sabe de zonas. Formatear una hora, saber a qué día pertenece
 * un instante y calcular los límites de un día se hace acá, con la zona de la empresa (`Empresa.zonaHoraria`, IANA) como parámetro.
 * Nada fuera de `core/tiempo` escribe una zona, un offset ni `timeZone:` a mano: lo vigila `test/arquitectura/zona-horaria-solo-en-tiempo.test.ts`.
 *
 * Los límites de día se calculan con `Intl` (nunca con un offset fijo): así valen para cualquier zona y para cualquier fecha, con horario
 * de verano incluido (un día puede durar 23 o 25 horas).
 */

/** Argentina: el mercado cambiario (la cotización del dólar es de ahí, sea cual sea la zona de la empresa que la mire) y la zona que se supone cuando no hay otra a mano (las empresas de hoy son argentinas). */
export const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";
/** Corte "calendario UTC" de los reportes que lo usan por diseño (`core/reportes`): pasar esta zona es elegir ese criterio, a la vista. */
export const ZONA_UTC = "UTC";

/** ¿Es un nombre de zona IANA que `Intl` conoce («America/Argentina/Buenos_Aires», «UTC»)? Rechaza vacío, espacios y offsets («-03:00»). */
export function esZonaHorariaValida(zona: unknown): zona is string {
  if (typeof zona !== "string" || zona === "" || zona !== zona.trim() || /^[+-]/.test(zona)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorDe(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: zona });
    formateadores.set(zona, f);
  }
  return f;
}

interface Partes {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partesDe(instante: Date, zona: string): Partes {
  const p: Record<string, number> = {};
  for (const parte of formateadorDe(zona).formatToParts(instante)) if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  return p as unknown as Partes;
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** Cuánto se adelanta la hora de pared de `zona` respecto de UTC en ese instante (ms): -3 h en Buenos Aires, +5:30 h en Calcuta. */
function desfaseDe(instanteMs: number, zona: string): number {
  const p = partesDe(new Date(instanteMs), zona);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instanteMs / 1000) * 1000;
}

/** «25/09/2026 15:10» en la zona: la hora de los documentos impresos (comanda y ticket). */
export function formatearFechaHora(fecha: Date, zona: string): string {
  const p = partesDe(fecha, zona);
  return `${dosDigitos(p.day)}/${dosDigitos(p.month)}/${p.year} ${dosDigitos(p.hour)}:${dosDigitos(p.minute)}`;
}

/** «15:10» en la zona. */
export function formatearHora(fecha: Date, zona: string): string {
  const p = partesDe(fecha, zona);
  return `${dosDigitos(p.hour)}:${dosDigitos(p.minute)}`;
}

/** La hora del día (0–23) del instante en la zona: la franja horaria de una cuenta. */
export function horaDelDia(fecha: Date, zona: string): number {
  return partesDe(fecha, zona).hour;
}

/** «2026-09-26»: el día de calendario de la zona al que pertenece el instante. */
export function diaDeCalendario(instante: Date, zona: string): string {
  const p = partesDe(instante, zona);
  return `${p.year}-${dosDigitos(p.month)}-${dosDigitos(p.day)}`;
}

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function leerDia(dia: string): [number, number, number] {
  const m = RE_DIA.exec(dia);
  if (!m) throw new RangeError(`Día inválido: «${dia}» (se espera AAAA-MM-DD).`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** «2026-09-28» + 2 → «2026-09-30»: aritmética de calendario sobre un día «AAAA-MM-DD» (no depende de ninguna zona). */
export function sumarDias(dia: string, dias: number): string {
  const [y, m, d] = leerDia(dia);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** 00:00:00.000 de ese día en la zona, como instante. `dia`: «AAAA-MM-DD». */
export function inicioDelDia(dia: string, zona: string): Date {
  const [y, m, d] = leerDia(dia);
  const nominal = Date.UTC(y, m - 1, d);
  const primero = nominal - desfaseDe(nominal, zona);
  const corregido = nominal - desfaseDe(primero, zona);
  return new Date(corregido);
}

/** 23:59:59.999 de ese día en la zona, como instante: un milisegundo antes del inicio del día siguiente. */
export function finDelDia(dia: string, zona: string): Date {
  return new Date(inicioDelDia(sumarDias(dia, 1), zona).getTime() - 1);
}

/** Inicio del día de la zona que contiene el instante. */
export function inicioDelDiaDe(instante: Date, zona: string): Date {
  return inicioDelDia(diaDeCalendario(instante, zona), zona);
}

/** Fin del día de la zona que contiene el instante. */
export function finDelDiaDe(instante: Date, zona: string): Date {
  return finDelDia(diaDeCalendario(instante, zona), zona);
}

/**
 * Rango inclusivo [inicio del día `desde`, fin del día `hasta`] en la zona. `desde`/`hasta` llegan como fecha "de solo día" (`new Date("AAAA-MM-DD")`:
 * medianoche UTC, sin importar la zona del navegador): el día que nombran se lee en UTC, y los límites se calculan en la zona pedida.
 */
export function rangoDeDias(desde: Date, hasta: Date, zona: string): { desde: Date; hasta: Date } {
  return { desde: inicioDelDia(diaDeCalendario(desde, ZONA_UTC), zona), hasta: finDelDia(diaDeCalendario(hasta, ZONA_UTC), zona) };
}
