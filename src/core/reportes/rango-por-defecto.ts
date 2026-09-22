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
}

function hoyUtcSinHora(ahora: Date): Date {
  const d = new Date(ahora);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** `ahora` es inyectable para que el cálculo sea testeable sin congelar `new Date()` globalmente. */
export function resolverRangoPorDefecto(opcionParam: string | undefined, ahora: Date = new Date()): RangoPorDefecto {
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
export function resolverRangoDeReporte(sp: { desde?: string; hasta?: string; rango?: string }, ahora: Date = new Date()): RangoDeReporte {
  if (sp.desde || sp.rango === "personalizado") {
    const base = resolverRangoPorDefecto("30d", ahora);
    return { opcion: "personalizado", desdeISO: sp.desde || base.desdeISO, hastaISO: sp.hasta || base.hastaISO };
  }
  return resolverRangoPorDefecto(sp.rango, ahora);
}

export const ETIQUETA_RANGO: Record<"30d" | "mes", string> = {
  "30d": "los últimos 30 días",
  mes: "el mes en curso",
};
