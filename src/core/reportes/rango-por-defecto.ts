/**
 * Rango de fechas por defecto de los reportes que antes SIEMPRE abrían en "mes en curso" (Resumen operativo, Período, Categorías,
 * Promociones, Rendimiento de recetas). Reemplaza las cinco copias de `primerDiaDelMes()`/`primerDiaDelMesISO()` que había, una
 * por pantalla.
 *
 * Decisión del usuario (2026-09-21, docs/planes-demo-y-claridad-reportes-2026-09-21.md §1): el default pasa a ser "Últimos 30
 * días", con "Mes en curso" como segunda opción y fechas personalizadas como tercera. El motivo no es solo la demo: en
 * cualquier negocio real, los días 1 y 2 de cada mes la pantalla de entrada se ve casi vacía con "mes en curso"; con 30 días
 * siempre hay algo que mostrar.
 */
import { ZONA_UTC, inicioDelDiaDe } from "@/core/tiempo/zona-horaria";

/**
 * Lo más que abarca un rango de reporte, contando los dos extremos (S-28, T11 del endurecimiento): una URL con `?desde=2000-01-01` hacía que cada reporte recorriera TODA la
 * historia de movimientos de la sucursal —una empresa con años de datos tumbaba la base compartida con un solo enlace—. Un año alcanza para comparar contra el mismo
 * período del año anterior; más allá, el reporte se pide por tramos. Es un default a confirmar por el dueño (decisión B16 del carril B), revertible cambiando esta constante.
 */
export const MAXIMO_DE_DIAS_DE_UN_RANGO = 366;
const DIA_MS = 24 * 60 * 60 * 1000;

export type OpcionRango = "30d" | "mes" | "personalizado";

export interface RangoPorDefecto {
  opcion: "30d" | "mes";
  desdeISO: string;
  hastaISO: string;
}

export interface RangoDeReporte {
  opcion: OpcionRango;
  desdeISO: string;
  hastaISO: string;
  /**
   * Solo presente si el rango pedido abarcaba más de `MAXIMO_DE_DIAS_DE_UN_RANGO` días y se RECORTÓ (M-21): el «desde» que se pidió, para que la pantalla lo DIGA (`SelectorRango`) en vez de
   * mostrar un reporte de menos días como si fuera el pedido. Ausente cuando el rango entró entero.
   */
  recortadoDesde?: string;
}

function hoyUtcSinHora(ahora: Date): Date {
  return inicioDelDiaDe(ahora, ZONA_UTC);
}

/** `ahora` es inyectable para que el cálculo sea testeable sin congelar `new Date()` globalmente. */
export function resolverRangoPorDefecto(opcionParam: string | undefined, ahora: Date): RangoPorDefecto {
  const opcion: "30d" | "mes" = opcionParam === "mes" ? "mes" : "30d";
  const hasta = hoyUtcSinHora(ahora);
  const hastaISO = hasta.toISOString().slice(0, 10);

  if (opcion === "mes") {
    const desde = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), 1));
    return { opcion, desdeISO: desde.toISOString().slice(0, 10), hastaISO };
  }

  // 29 días atrás + hoy = 30 días, inclusive de los dos extremos.
  const desde = new Date(hasta);
  desde.setUTCDate(desde.getUTCDate() - 29);
  return { opcion, desdeISO: desde.toISOString().slice(0, 10), hastaISO };
}

/**
 * El rango efectivo de un reporte, a partir de sus `searchParams`. Una fecha explícita en la URL (`desde`) SIEMPRE manda — mismo
 * comportamiento que antes de que existiera este selector, para no romper enlaces ni specs existentes que pasan `desde`/`hasta`
 * sin `rango` (ej. el link de "Compras por proveedor", o `?desde=no-es-una-fecha` de la prueba de la pantalla de error) — y en
 * ese caso la opción vigente pasa a ser "personalizado", sin validar la fecha (esa validación, si la tuviera, es cosa del
 * reporte, no de este selector).
 *
 * `rango=personalizado` SIN `desde` también cuenta como "personalizado" (no cae a 30d): es lo que llega el primer submit
 * después de elegir "Fechas personalizadas" en el selector, antes de que el usuario haya tocado los inputs de fecha (que recién
 * se muestran cuando la opción vigente ya es "personalizado" — ver SelectorRango). Ese primer submit se prellena con la ventana
 * de 30 días como punto de partida razonable para editar, no porque sea significativo.
 */
export function resolverRangoDeReporte(sp: { desde?: string; hasta?: string; rango?: string }, ahora: Date): RangoDeReporte {
  if (sp.desde || sp.rango === "personalizado") {
    const base = resolverRangoPorDefecto("30d", ahora);
    const desdeISO = sp.desde || base.desdeISO;
    const hastaISO = sp.hasta || base.hastaISO;
    const acotado = acotarElDesde(desdeISO, hastaISO);
    return { opcion: "personalizado", desdeISO: acotado, hastaISO, ...(acotado !== desdeISO ? { recortadoDesde: desdeISO } : {}) };
  }
  return resolverRangoPorDefecto(sp.rango, ahora);
}

/**
 * El «desde» que deja el rango en `MAXIMO_DE_DIAS_DE_UN_RANGO` días como mucho (S-28): si el pedido abarca más, el «hasta» manda y el «desde» se corre para que entren los últimos
 * 366 días. Lo que no es una fecha, o un rango al revés (desde después de hasta), no se toca: sigue el comportamiento de siempre (la pantalla de error del reporte, o un reporte vacío).
 */
function acotarElDesde(desdeISO: string, hastaISO: string): string {
  const desde = Date.parse(desdeISO);
  const hasta = Date.parse(hastaISO);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return desdeISO;
  const tope = (MAXIMO_DE_DIAS_DE_UN_RANGO - 1) * DIA_MS;
  if (hasta - desde <= tope) return desdeISO;
  return new Date(hasta - tope).toISOString().slice(0, 10);
}

export const ETIQUETA_RANGO: Record<"30d" | "mes", string> = {
  "30d": "los últimos 30 días",
  mes: "el mes en curso",
};
