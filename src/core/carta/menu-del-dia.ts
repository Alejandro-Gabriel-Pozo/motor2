import { esDiaISOReal, sumarDias } from "@/core/tiempo/zona-horaria";
import type { DiferenciaDeCupos } from "./cupos-de-promo";

/**
 * INTERRUPTOR del «Menú del día» (decisión del dueño, 2026-10-20): hasta que se rediseñe, NO SE VE. Una sola constante (el mismo patrón que `SUMAR_LUGAR_DE_LISTA_VISIBLE` y `VIGENCIA_DE_PROMO_VISIBLE`).
 * Con `false`:
 *  - Movimientos no muestra la entrada «Menú del día» (`core/movimientos/ui-config.ts`) y su pantalla, `/movimientos/menu-del-dia`, responde «no existe» (404, no un error);
 *  - al armar una promo no se ofrece el lugar «Plato del día» (DEL_DIA) ni el enlace a esa pantalla (Carta → Promociones);
 *  - el servidor rechaza sumar un lugar del día (nuevo, o reactivar uno dado de baja: `lugarDelDiaApagado`) y cargar o copiar platos del día (`server/actions/carta/menu-del-dia.ts`),
 *    aunque alguien arme el pedido a mano.
 * No se borra nada ni se toca la base: los lugares del día y los platos que ya existían quedan como están (el POS los sigue leyendo) y se pueden quitar.
 * Para volver a encenderlo: poner `true` (nada más). Lo comprueban `test/carta/menu-del-dia-interruptor.test.ts` (los dos estados) y los e2e `movimientos-menu-del-dia.spec.ts` y
 * `pos-menu-del-dia.spec.ts`, que con `false` se omiten con el motivo a la vista.
 */
export const MENU_DEL_DIA_VISIBLE: boolean = false;

/** Lo que responde el servidor a un pedido que suma algo del menú del día con el interruptor apagado. */
export const MENSAJE_MENU_DEL_DIA_APAGADO = "El menú del día está apagado por ahora: no se pueden sumar lugares ni platos del día.";

/**
 * Con el interruptor apagado, ¿el guardado de los cupos de una promo SUMA un lugar del día (uno nuevo, o uno dado de baja que vuelve)? Devuelve el mensaje del rechazo, o `null` si se puede
 * guardar. Los lugares del día que ya estaban activos se pueden seguir cambiando o quitar (no se esconde lo que ya existe). `visible` es el interruptor: quien llama le pasa
 * `MENU_DEL_DIA_VISIBLE` (sin valor por defecto a propósito: así el interruptor se lee siempre en el que llama). Puro.
 */
export function lugarDelDiaApagado(diferencia: Pick<DiferenciaDeCupos, "crear" | "cambiar">, visible: boolean): string | null {
  if (visible) return null;
  const suma = diferencia.crear.some((c) => c.tipo === "DEL_DIA") || diferencia.cambiar.some((c) => c.queda.tipo === "DEL_DIA" && !c.estaba.activo);
  return suma ? MENSAJE_MENU_DEL_DIA_APAGADO : null;
}

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
