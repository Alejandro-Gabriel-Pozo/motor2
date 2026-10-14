import { esDiaISOReal, sumarDias } from "@/core/tiempo/zona-horaria";

/**
 * El MENÚ DEL DÍA (GO-3, ADR-032, D-1 del dueño): el plato del día de un lugar DEL_DIA se carga por FECHA y por SUCURSAL. «Hoy» es el día de calendario de la zona de la empresa (sin corte de
 * jornada: `diaDeCalendario(actor.ahora, empresaZonaHoraria)`, que calcula quien llama). Se carga de hoy a hoy + 13 días (la semana que viene entera, por adelantado); lo pasado no se toca. Puro.
 */

/** Cuántos días hacia adelante se puede cargar (hoy incluido: de hoy a hoy + 13). */
export const DIAS_DE_ANTICIPACION_DEL_MENU = 13;

export type ResultadoDeFechaDeMenu = { ok: true } | { ok: false; codigo: "FECHA_INVALIDA"; mensaje: string };

/** ¿Se puede cargar (o quitar) el plato del día de `fecha` cuando «hoy» es `hoy`? Los dos «AAAA-MM-DD». */
export function validarFechaDeMenuDelDia(fecha: string, hoy: string): ResultadoDeFechaDeMenu {
  if (!esDiaISOReal(fecha)) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: "La fecha del menú del día no es válida." };
  if (fecha < hoy) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: "Esa fecha ya pasó: el menú del día se carga de hoy en adelante." };
  const ultimo = sumarDias(hoy, DIAS_DE_ANTICIPACION_DEL_MENU);
  if (fecha > ultimo) return { ok: false, codigo: "FECHA_INVALIDA", mensaje: `El menú del día se carga con hasta ${DIAS_DE_ANTICIPACION_DEL_MENU} días de anticipación (hasta el ${ultimo}).` };
  return { ok: true };
}

// GO-3b (U2): lo que muestra la pantalla «Menú del día» de la sucursal (lo arma `server/consultas/carta/menu-del-dia.ts`).

export interface LugarDelDia {
  cupoId: string;
  nombre: string;
  promoCartaId: string;
  promoTitulo: string;
  /** ¿La promo está prendida en esta sucursal? (si no, el plato queda cargado pero el POS no la ofrece todavía). */
  ofrecidaAca: boolean;
  platos: { platoId: string; productoId: string; nombre: string }[];
}

export interface CandidatoAPlato {
  productoId: string;
  nombre: string;
  /** Por qué no puede ser plato del día (sin receta, sin precio), o `null` si puede. */
  aviso: string | null;
}

export interface MenuDelDiaDeLaSucursal {
  hoy: string;
  /** El día que se muestra (`AAAA-MM-DD`). */
  fecha: string;
  /** Los días que se pueden cargar: de hoy a hoy + 13. */
  dias: string[];
  lugares: LugarDelDia[];
  candidatos: CandidatoAPlato[];
  /** ¿El día anterior tiene platos cargados en algún lugar? (habilita «Copiar el día anterior»). */
  hayDiaAnterior: boolean;
}
