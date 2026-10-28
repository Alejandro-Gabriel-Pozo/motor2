import { diaDeLaSemana, esDiaISOReal } from "@/core/tiempo/zona-horaria";

/**
 * La VIGENCIA de una promo (GO-3, ADR-032, decisión D-7 del dueño): opcional, por rango de fechas (`PromoCarta.vigenteDesde`/`vigenteHasta`, DATE local de la zona de la
 * empresa, rango INCLUSIVE) y por días de la semana (`PromoCarta.diasDeSemana`, una máscara: bit 0 = lunes … bit 6 = domingo; de 1 a 127). NULL en cualquiera de las tres
 * = sin límite por ese lado. Sin horario: «hoy» es el día de calendario de la zona de la empresa (no hay corte de jornada).
 *
 * Se evalúa AL AGREGAR la promo a la cuenta, con el día que quien llama sacó de `diaDeCalendario(actor.ahora, empresaZonaHoraria)` (`core/tiempo`, el único lugar que conoce
 * las zonas): lo que ya está en una mesa no cambia si la promo deja de valer. Función pura: sin reloj ni zona propios.
 */

/**
 * INTERRUPTOR de la VIGENCIA en la pantalla de las promos (decisión del dueño, 2026-10-20 noche, 10.ª y 11.ª parte de `docs/pendientes-sesion-2026-10-22.md`: «la promoción NO tiene vigencia desde/hasta,
 * ni días, ni carga por fecha; se maneja con ACTIVAR/DESACTIVAR»; aplicada en la Fase 7, 2026-10-28). Mismo patrón que `MENU_DEL_DIA_VISIBLE`: una sola constante. Con `false`, la pantalla no ofrece
 * «Desde», «Hasta» ni «Días en que vale». NO se toca el servidor, ni las columnas, ni el filtro del POS (con todo en NULL, `promoVigenteEl` vale siempre); retirar las columnas es una migración
 * destructiva futura, con autorización expresa (docs/diseno-modulo-carta-2026-10-28.md). Lo comprueba `test/carta/vigencia-de-promo-interruptor.test.tsx` (los dos estados).
 */
export const VIGENCIA_DE_PROMO_VISIBLE: boolean = false;

export interface VigenciaDePromo {
  /** «AAAA-MM-DD» o `null` (sin límite inferior). */
  vigenteDesde: string | null;
  /** «AAAA-MM-DD» o `null` (sin límite superior). */
  vigenteHasta: string | null;
  /** Máscara de 1 a 127 (bit 0 = lunes … bit 6 = domingo) o `null` (todos los días). */
  diasDeSemana: number | null;
}

/** Todos los días de la semana: la máscara llena (lunes a domingo). */
export const TODOS_LOS_DIAS = 127;

/** La máscara de una lista de días (0 = lunes … 6 = domingo). Repetidos se ignoran; un día fuera de 0 a 6 es un error de programación. */
export function mascaraDeDias(dias: readonly number[]): number {
  let mascara = 0;
  for (const d of dias) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new RangeError(`Día de la semana inválido: ${d} (0 = lunes … 6 = domingo).`);
    mascara |= 1 << d;
  }
  return mascara;
}

export type ResultadoDeVigencia = { ok: true } | { ok: false; codigo: "VIGENCIA_INVALIDA"; mensaje: string };

/**
 * ¿La vigencia es válida para guardarse? Las fechas tienen que existir en el calendario, «desde» no puede ser posterior a «hasta» (CHECK `PromoCarta_vigencia_chk`) y la máscara
 * tiene que ser un entero de 1 a 127 (CHECK `PromoCarta_dias_de_semana_chk`: una promo que no vale ningún día no se guarda: se apaga).
 */
export function validarVigenciaDePromo(v: VigenciaDePromo): ResultadoDeVigencia {
  const mal = (mensaje: string): ResultadoDeVigencia => ({ ok: false, codigo: "VIGENCIA_INVALIDA", mensaje });
  if (v.vigenteDesde !== null && !esDiaISOReal(v.vigenteDesde)) return mal("La fecha «desde» de la promo no es una fecha válida.");
  if (v.vigenteHasta !== null && !esDiaISOReal(v.vigenteHasta)) return mal("La fecha «hasta» de la promo no es una fecha válida.");
  if (v.vigenteDesde !== null && v.vigenteHasta !== null && v.vigenteDesde > v.vigenteHasta) return mal("La fecha «desde» de la promo no puede ser posterior a la fecha «hasta».");
  if (v.diasDeSemana !== null && (!Number.isInteger(v.diasDeSemana) || v.diasDeSemana < 1 || v.diasDeSemana > TODOS_LOS_DIAS)) {
    return mal("Elegí al menos un día de la semana en que vale la promo.");
  }
  return { ok: true };
}

/**
 * ¿La promo vale el día `dia` («AAAA-MM-DD», el de la zona de la empresa)? Rango inclusive en las dos puntas y el bit del día de la semana prendido. Las fechas se comparan como
 * texto (el formato «AAAA-MM-DD» ordena igual que el calendario); una vigencia inválida o un día inválido FALLAN CERRADO (no vale).
 */
export function promoVigenteEl(v: VigenciaDePromo, dia: string): boolean {
  if (!esDiaISOReal(dia) || !validarVigenciaDePromo(v).ok) return false;
  if (v.vigenteDesde !== null && dia < v.vigenteDesde) return false;
  if (v.vigenteHasta !== null && dia > v.vigenteHasta) return false;
  if (v.diasDeSemana !== null && (v.diasDeSemana & (1 << diaDeLaSemana(dia))) === 0) return false;
  return true;
}
