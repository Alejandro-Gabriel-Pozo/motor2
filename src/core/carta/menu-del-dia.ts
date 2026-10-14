import { esDiaISOReal, sumarDias } from "@/core/tiempo/zona-horaria";

/**
 * El MENÚ DEL DÍA (GO-3, ADR-032, D-1 del dueño): el plato del día de un lugar DEL_DIA se carga por FECHA y por SUCURSAL. «Hoy» es el día de calendario de la zona de la empresa (sin corte de
 * jornada: `diaDeCalendario(actor.ahora, empresaZonaHoraria)`, que calcula quien llama). Se carga de hoy a hoy + 13 días (la semana que viene entera, por adelantado); lo pasado no se toca. Puro.
 */

/** Cuántos días hacia adelante se puede cargar (hoy incluido: de hoy a hoy + 13). */
const DIAS_DE_ANTICIPACION_DEL_MENU = 13;

export type ResultadoDeFechaDeMenu = { ok: true } | { ok: false; codigo: "FECHA_INVALIDA"; mensaje: string };

/** ¿Se puede cargar (o quitar) el plato del día de `fecha` cuando «hoy» es `hoy`? Los dos «AAAA-MM-DD». */
export function validarFechaDeMenuDelDia(fecha: string, hoy: string): ResultadoDeFechaDeMenu {
  if (!esDiaISOReal(fecha)) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: "La fecha del menú del día no es válida." };
  if (fecha < hoy) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: "Esa fecha ya pasó: el menú del día se carga de hoy en adelante." };
  const ultimo = sumarDias(hoy, DIAS_DE_ANTICIPACION_DEL_MENU);
  if (fecha > ultimo) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: `El menú del día se carga con hasta ${DIAS_DE_ANTICIPACION_DEL_MENU} días de anticipación (hasta el ${ultimo}).` };
  return { ok: true };
}
