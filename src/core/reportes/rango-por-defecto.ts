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
import { diaDeCalendario, esDiaISOReal, sumarDias } from "@/core/tiempo/zona-horaria";

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

/**
 * `ahora` es inyectable para que el cálculo sea testeable sin congelar `new Date()` globalmente. `zona` es OBLIGATORIA (P1, O.251): «hoy» es el día de calendario de la zona de la empresa
 * (las páginas pasan `ctx.empresaZonaHoraria`), el mismo con el que los reportes cortan cada día (`rangoDeDias`). Con «hoy» en UTC, desde las 21:00 argentinas el rango por defecto terminaba
 * mañana y dejaba la noche de hoy afuera de un corte en hora argentina. Obligatoria a propósito: `tsc` obliga a quien llama a decidir la zona.
 */
export function resolverRangoPorDefecto(opcionParam: string | undefined, ahora: Date, zona: string): RangoPorDefecto {
  const opcion: "30d" | "mes" = opcionParam === "mes" ? "mes" : "30d";
  const hastaISO = diaDeCalendario(ahora, zona);

  if (opcion === "mes") return { opcion, desdeISO: `${hastaISO.slice(0, 8)}01`, hastaISO };

  // 29 días atrás + hoy = 30 días, inclusive de los dos extremos.
  return { opcion, desdeISO: sumarDias(hastaISO, -29), hastaISO };
}

/**
 * El rango efectivo de un reporte, a partir de sus `searchParams`. Una fecha explícita en la URL (`desde`) SIEMPRE manda — mismo
 * comportamiento que antes de que existiera este selector, para no romper enlaces ni specs existentes que pasan `desde`/`hasta`
 * sin `rango` (ej. el link de "Compras por proveedor") — y en ese caso la opción vigente pasa a ser "personalizado". Una fecha que
 * no es un día real (`?desde=no-es-una-fecha`, `2026-13-45`, `2026-02-31`) NO cuenta como fecha explícita: se ignora y se sigue
 * con el rango por defecto (o con `rango`), en vez de dejar que el reporte reciba un Invalid Date y lance.
 *
 * `rango=personalizado` SIN `desde` también cuenta como "personalizado" (no cae a 30d): es lo que llega el primer submit
 * después de elegir "Fechas personalizadas" en el selector, antes de que el usuario haya tocado los inputs de fecha (que recién
 * se muestran cuando la opción vigente ya es "personalizado" — ver SelectorRango). Ese primer submit se prellena con la ventana
 * de 30 días como punto de partida razonable para editar, no porque sea significativo.
 *
 * `zona` (obligatoria): la zona de la empresa con la que se calcula «hoy» para el rango por defecto y para el «hasta» que falta (ver `resolverRangoPorDefecto`).
 */
export function resolverRangoDeReporte(sp: { desde?: string; hasta?: string; rango?: string }, ahora: Date, zona: string): RangoDeReporte {
  // Una fecha que no es un día real «AAAA-MM-DD» (texto, mes 13, 31 de febrero) se descarta como si no viniera: el «desde» cae al rango por defecto y el «hasta» a hoy. Sin esto
  // el reporte armaba `new Date("abc")` (Invalid Date) y la consulta lanzaba un RangeError que tumbaba la pantalla. Mismo criterio que Compras y Tickets: lo inválido se ignora.
  const desdePedido = esDiaISOReal(sp.desde) ? sp.desde : undefined;
  const hastaPedido = esDiaISOReal(sp.hasta) ? sp.hasta : undefined;
  if (desdePedido || sp.rango === "personalizado") {
    const base = resolverRangoPorDefecto("30d", ahora, zona);
    const desdeISO = desdePedido || base.desdeISO;
    const hastaISO = hastaPedido || base.hastaISO;
    const acotado = acotarElDesde(desdeISO, hastaISO);
    return { opcion: "personalizado", desdeISO: acotado, hastaISO, ...(acotado !== desdeISO ? { recortadoDesde: desdeISO } : {}) };
  }
  return resolverRangoPorDefecto(sp.rango, ahora, zona);
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
