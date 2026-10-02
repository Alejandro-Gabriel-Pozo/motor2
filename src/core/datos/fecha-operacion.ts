import { aceptar, rechazar, type ResultadoDato } from "./resultado";

const MS_DIA = 24 * 60 * 60 * 1000;
// Argentina no tiene horario de verano: UTC-3 todo el año.
const MS_OFFSET_ARGENTINA = 3 * 60 * 60 * 1000;
// No hay cierre de período en el sistema que fije un piso: 400 días cubre un año de carga atrasada (inventarios, pagos) más el margen de cierre contable.
const DIAS_HACIA_ATRAS = 400;

/**
 * Fecha de una operación (movimiento, venta, conteo, reclasificación, pago): un `Date` válido, no posterior al fin de MAÑANA en hora de
 * Argentina (el día de margen cubre un reloj o una zona horaria del cliente adelantados) y no anterior a 400 días. Un `Invalid Date`
 * o un valor que no es `Date` se rechaza acá: llegando a Prisma sería un error crudo (500) en vez de un mensaje.
 */
export function validarFechaOperacion(valor: unknown, ahora: Date = new Date()): ResultadoDato<Date> {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return rechazar("formato", "La fecha no es válida.");

  const inicioDeHoyAR = Math.floor((ahora.getTime() - MS_OFFSET_ARGENTINA) / MS_DIA) * MS_DIA + MS_OFFSET_ARGENTINA;
  if (valor.getTime() >= inicioDeHoyAR + 2 * MS_DIA) return rechazar("rango", "La fecha no puede ser posterior a mañana.");
  if (valor.getTime() < ahora.getTime() - DIAS_HACIA_ATRAS * MS_DIA) return rechazar("rango", "La fecha es demasiado antigua: no puede ser de hace más de 400 días.");
  return aceptar(valor);
}
