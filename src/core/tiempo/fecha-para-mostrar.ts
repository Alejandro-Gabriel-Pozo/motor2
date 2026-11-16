import { esDiaISOReal } from "./zona-horaria";

/**
 * LA FECHA QUE VE EL CLIENTE: «15/11/2026» (DD/MM/AAAA; el dueño lo confirmó el 2026-11-16 para el trabajo nuevo). Un solo formateador de un día de calendario: «AAAA-MM-DD» queda para
 * datos internos y entre sistemas, nunca en pantalla ni en papel. Recibe el día «AAAA-MM-DD» ya leído de la base o de `diaDeCalendario` (zona de la empresa), que es un día y no un instante:
 * no convierte nada de zona. Si lo que llega no es un día que existe (`esDiaISOReal`: «2026-02-30», «2026-9-1», un texto cualquiera, vacío), FALLA CERRADA: lanza `RangeError`, no muestra nada
 * a medias ni devuelve el texto crudo. Sin `Date` ni zona del proceso o del navegador: parte el texto ya validado en año, mes y día (día y mes de 2 dígitos, año de 4: `05/03/2026`).
 * Puro: sin reloj, sin azar, sin I/O. Límite heredado de `esDiaISOReal`: los años 0000 a 0099 se rechazan (el `Date` de JavaScript los corre a 1900–1999).
 * Previene: el ticket o la pantalla que sale con la fecha cruda de la base. Chequeo: `test/tiempo/fecha-para-mostrar.test.ts`.
 */
export function fechaParaMostrar(dia: string): string {
  if (!esDiaISOReal(dia)) throw new RangeError("fechaParaMostrar: no es un día de calendario válido (se espera AAAA-MM-DD)");
  const [anio, mes, d] = dia.split("-");
  return `${d}/${mes}/${anio}`;
}
