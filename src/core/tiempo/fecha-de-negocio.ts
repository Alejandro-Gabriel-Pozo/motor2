import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";

/**
 * FECHA DE NEGOCIO (la jornada) — frente 3, pieza «hora de corte» acordada con el frente 1 (caja) y el orquestador general (2026-11-16); referencia: `ZuluHub-ERP`
 * `src/primitivas/tiempo/fecha-de-negocio.ts` y `hora-del-dia.ts`. La fecha de negocio de un instante es la fecha civil de `(instante en la zona de la empresa) − hora de corte`: con corte
 * 00:00 es el día civil local; con corte 04:00, lo que pasa entre las 00:00 y las 03:59 pertenece a la jornada del día anterior. Es la MISMA fórmula que aplica la base de Pedernal
 * (`((instante AT TIME ZONE zona) - corte)::date`) para caja, ventas y stock: cuando Motor2 la lleve a SQL tiene que dar lo mismo (esa comparación contra Postgres NO se hace acá: sin base).
 * La columna `Sucursal.horaDeCorte` la agrega el frente 1 en su migración; esta función no la lee: recibe el valor.
 *
 * Valida en este orden y devuelve el primer error (códigos cerrados): hora de corte (`HH:MM` estricto, 00:00 a 23:59), zona horaria (IANA canónica) e instante (0001 a 9999). Los segundos del
 * instante no cuentan: la jornada cambia exactamente a la hora de corte en punto. DIFERENCIA DECLARADA con `core/tiempo/zona-horaria.ts` (`esZonaHorariaValida`, que acepta cualquier zona que `Intl` conoce
 * salvo los desfases): acá se pide la forma canónica de Pedernal (`UTC` o `Continente/Ciudad`, sin siglas como `EST` ni variantes de mayúsculas), porque la base la interpretaría distinto.
 * Puro: el instante entra como parámetro, sin reloj, sin azar, sin I/O. La única zona permitida es la que llega por parámetro (el guardián `zona-horaria-solo-en-tiempo` vive en `core/tiempo`).
 */
export type ErrorDeJornada = "HORA_DE_CORTE_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";

/** Sin corrimiento: la jornada coincide con el día civil. */
export const HORA_DE_CORTE_POR_DEFECTO = "00:00";

/** Rango de instantes que dan una fecha de negocio de año 0001 a 9999 en cualquier zona (se corre hasta 14 horas, más el corte de hasta un día). */
export const INSTANTE_MINIMO = Date.parse("0001-01-03T00:00:00Z");
export const INSTANTE_MAXIMO = Date.parse("9999-12-30T00:00:00Z");

/** Estricto: dos dígitos de hora (00 a 23), dos puntos y dos dígitos de minutos (00 a 59). */
const FORMATO_DE_HORA = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** Nombre canónico de la base de zonas (IANA): `UTC` o varios segmentos con mayúscula inicial separados por `/` (`America/Argentina/Buenos_Aires`, `Etc/GMT+3`). */
const FORMATO_DE_ZONA = /^(?:UTC|[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)+)$/;

function formateadorDeZona(zonaHoraria: string): Intl.DateTimeFormat | null {
  if (!FORMATO_DE_ZONA.test(zonaHoraria)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zonaHoraria,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    // `Intl` lanza RangeError ante una zona que no existe: es un error previsto, no un fallo.
    return null;
  }
}

/** Las partes de la fecha formateada (año, mes, día, hora, minuto) como números, por tipo. */
function numerosPorTipo(formateador: Intl.DateTimeFormat, instante: Date): Record<"year" | "month" | "day" | "hour" | "minute", number> {
  const valores: Record<string, number> = {};
  for (const { type, value } of formateador.formatToParts(instante)) valores[type] = Number(value);
  return valores as Record<"year" | "month" | "day" | "hour" | "minute", number>;
}

/** ¿Es un `Date` de verdad? (`instanceof` falla con un `Date` de otro contexto; la etiqueta interna no se puede imitar con un objeto cualquiera.) */
function esUnDate(valor: unknown): valor is Date {
  return Object.prototype.toString.call(valor) === "[object Date]";
}

/** La fecha de negocio «AAAA-MM-DD» de `instante` en `zonaHoraria` con `horaDeCorte` («HH:MM»), o el primer error. */
export function fechaDeNegocio(instante: Date, zonaHoraria: string, horaDeCorte: string): ResultadoDeRegla<string, ErrorDeJornada> {
  // Fallo cerrado: los tipos solo protegen en compilación; un dato que llega de afuera (`null`, un texto, un objeto con `toString`) no puede lanzar ni colarse.
  const corte = typeof horaDeCorte === "string" ? FORMATO_DE_HORA.exec(horaDeCorte) : null;
  if (corte === null) return invalido("HORA_DE_CORTE_INVALIDA");
  const formateador = typeof zonaHoraria === "string" ? formateadorDeZona(zonaHoraria) : null;
  if (formateador === null) return invalido("ZONA_HORARIA_INVALIDA");
  const ms = esUnDate(instante) ? instante.getTime() : Number.NaN;
  if (!(ms >= INSTANTE_MINIMO && ms <= INSTANTE_MAXIMO)) return invalido("INSTANTE_INVALIDO");

  const local = numerosPorTipo(formateador, instante);
  const minutosLocales = local.hour * 60 + local.minute;
  // Antes de la hora de corte todavía rige la jornada anterior: se resta un día civil.
  const retroceso = minutosLocales < Number(corte[1]) * 60 + Number(corte[2]) ? 1 : 0;
  // `setUTCFullYear` (y no `Date.UTC`) para que los años 0 a 99 no se lean como 1900 a 1999.
  const fecha = new Date(0);
  fecha.setUTCFullYear(local.year, local.month - 1, local.day - retroceso);
  return valido(fecha.toISOString().slice(0, 10));
}
