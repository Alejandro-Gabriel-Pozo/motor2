import { ZONA_ARGENTINA, diaDeCalendario, inicioDelDia, sumarDias } from "@/core/tiempo/zona-horaria";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

const MS_DIA = 24 * 60 * 60 * 1000;
// No hay cierre de período en el sistema que fije un piso: 400 días cubre un año de carga atrasada (inventarios, pagos) más el margen de cierre contable.
const DIAS_HACIA_ATRAS = 400;

/** Valida formato, tope (inicio del día `diasDeMargen` días después de hoy en `zona`) y piso de 400 días; los mensajes de rango los pone quien llama. */
function validarFechaConTope(valor: unknown, ahora: Date, zona: string, diasDeMargen: number, mensajeFuturo: string): ResultadoDato<Date> {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return rechazar("formato", "La fecha no es válida.");

  const tope = inicioDelDia(sumarDias(diaDeCalendario(ahora, zona), diasDeMargen), zona);
  if (valor.getTime() >= tope.getTime()) return rechazar("rango", mensajeFuturo);
  if (valor.getTime() < ahora.getTime() - DIAS_HACIA_ATRAS * MS_DIA) return rechazar("rango", "La fecha es demasiado antigua: no puede ser de hace más de 400 días.");
  return aceptar(valor);
}

/**
 * Fecha de una operación (movimiento, venta, conteo, reclasificación, pago): un `Date` válido, no posterior al fin de MAÑANA en la zona
 * horaria `zona` y no anterior a 400 días. El día de margen cubre un reloj o una zona horaria del cliente adelantados. Los guards todavía
 * no pasan la zona de la empresa: usan la de Argentina por defecto (las empresas de hoy son argentinas). Un `Invalid Date` o un valor que
 * no es `Date` se rechaza acá: llegando a Prisma sería un error crudo (500) en vez de un mensaje.
 */
export function validarFechaOperacion(valor: unknown, ahora: Date, zona: string = ZONA_ARGENTINA): ResultadoDato<Date> {
  return validarFechaConTope(valor, ahora, zona, 2, "La fecha no puede ser posterior a mañana.");
}

/**
 * Fecha de una COMPRA (I13, etapa 1 de Compras): como `validarFechaOperacion` (formato y piso de 400 días) pero SIN el día de margen:
 * no puede ser posterior a HOY en la zona `zona` (hasta el último instante de hoy inclusive).
 */
export function validarFechaDeCompra(valor: unknown, ahora: Date, zona: string = ZONA_ARGENTINA): ResultadoDato<Date> {
  return validarFechaConTope(valor, ahora, zona, 1, "La fecha de la compra no puede ser posterior a hoy.");
}
