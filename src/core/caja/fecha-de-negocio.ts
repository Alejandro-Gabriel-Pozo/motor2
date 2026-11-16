import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import { diaDeCalendario, esZonaHorariaValida, formatearHora, sumarDias } from "@/core/tiempo/zona-horaria";

/**
 * Fecha de negocio (la jornada) de caja, C2 (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, §2 fila 2): la fecha civil de `(instante en la zona de la empresa) − hora de corte`, la MISMA fórmula que aplica la base
 * (`((instante AT TIME ZONE zona) - corte)::date`, función `caja_fecha_de_negocio` de la migración 20261117114000) y que usa Pedernal (`fechaDeNegocio` de `primitivas/tiempo`). Con corte 00:00 es el día civil local; con corte 06:00,
 * lo que pasa entre las 00:00 y las 05:59 pertenece a la jornada del día anterior. Los segundos del instante no cuentan: la jornada cambia exactamente a la hora de corte en punto.
 *
 * TRANSITORIA: la función de verdad es de `src/core/tiempo/` (la escribe el Frente 3, «fechas»); cuando entre, esta se reemplaza por esa. Usa solo funciones de `core/tiempo` (ningún `Intl` ni zona a mano acá).
 * Puro: el instante entra como parámetro (nunca se lee el reloj), sin azar ni I/O.
 */
export type ErrorDeFechaDeNegocio = "HORA_DE_CORTE_INVALIDA" | "ZONA_HORARIA_INVALIDA" | "INSTANTE_INVALIDO";

/** Lista de permitidos de la hora de corte: `HH:MM` con la hora de 00 a 23 y los minutos de 00 a 59 (el CHECK de la base exige además segundos en cero). */
const FORMA_DE_LA_HORA_DE_CORTE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** Rango de instantes que dan una fecha de negocio de año 0001 a 9999 en cualquier zona; un instante fuera de él, o inválido (`NaN`), no tiene fecha de negocio representable. */
const INSTANTE_MINIMO = Date.parse("0001-01-03T00:00:00Z");
const INSTANTE_MAXIMO = Date.parse("9999-12-30T00:00:00Z");

/** Valida en este orden (como Pedernal): hora de corte, zona horaria e instante; devuelve el primer error. La fecha sale como «AAAA-MM-DD». */
export function fechaDeNegocio(instante: Date, zonaHoraria: string, horaDeCorte: string): ResultadoDeRegla<string, ErrorDeFechaDeNegocio> {
  const corte = FORMA_DE_LA_HORA_DE_CORTE.exec(horaDeCorte);
  if (corte === null) return invalido("HORA_DE_CORTE_INVALIDA");
  if (!esZonaHorariaValida(zonaHoraria)) return invalido("ZONA_HORARIA_INVALIDA");
  const ms = instante.getTime();
  if (!(ms >= INSTANTE_MINIMO && ms <= INSTANTE_MAXIMO)) return invalido("INSTANTE_INVALIDO");
  const [horas, minutos] = formatearHora(instante, zonaHoraria).split(":").map(Number);
  const minutosLocales = (horas as number) * 60 + (minutos as number);
  // Antes de la hora de corte todavía rige la jornada anterior: se resta un día civil.
  const retroceso = minutosLocales < Number(corte[1]) * 60 + Number(corte[2]) ? -1 : 0;
  return valido(sumarDias(diaDeCalendario(instante, zonaHoraria), retroceso));
}
