/**
 * Funciones puras de auditoría de calibración por sucursal (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso
 * 6, D6(a)/D6(c)) — sin Prisma, para poder testearlas sin base.
 *
 * D6(c): el origen es una anotación DECLARADA por el cliente (viene del reporte que armó la sugerencia), nunca una prueba
 * — se normaliza acá (números finitos, textos recortados) antes de guardarse en la descripción de auditoría.
 */

export type OrigenCalibracion = "manual" | "sugerencia_simple" | "sugerencia_pool";

export interface OrigenCalibracionInput {
  tipo: OrigenCalibracion;
  /** La sucursal activa cuando se armó la sugerencia (ctx.sucursalId de quien vio el reporte) — si cambió, se rechaza. */
  sucursalCalculoId: string;
  sugerido?: number;
  comprado?: number;
  vendido?: number;
  semanas?: number;
  confianza?: string;
  /** Solo sugerencia_pool. */
  platos?: number;
  ajusteR2?: number;
}

export interface OrigenNormalizado {
  tipo: OrigenCalibracion;
  sucursalCalculoId: string;
  sugerido: number | null;
  comprado: number | null;
  vendido: number | null;
  semanas: number | null;
  confianza: string | null;
  platos: number | null;
  ajusteR2: number | null;
}

const LARGO_MAXIMO_CONFIANZA = 80;

function numeroFinitoOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textoRecortadoOrNull(v: unknown, largoMaximo: number): string | null {
  if (typeof v !== "string") return null;
  const recortado = v.trim().slice(0, largoMaximo);
  return recortado || null;
}

/** Números finitos, textos recortados — nunca se confía a ciegas en lo que mandó el cliente (D6(c): es una anotación, no una prueba). */
export function normalizarOrigen(input: OrigenCalibracionInput): OrigenNormalizado {
  return {
    tipo: input.tipo === "sugerencia_pool" || input.tipo === "manual" ? input.tipo : "sugerencia_simple",
    sucursalCalculoId: input.sucursalCalculoId,
    sugerido: numeroFinitoOrNull(input.sugerido),
    comprado: numeroFinitoOrNull(input.comprado),
    vendido: numeroFinitoOrNull(input.vendido),
    semanas: numeroFinitoOrNull(input.semanas),
    confianza: textoRecortadoOrNull(input.confianza, LARGO_MAXIMO_CONFIANZA),
    platos: numeroFinitoOrNull(input.platos),
    ajusteR2: numeroFinitoOrNull(input.ajusteR2),
  };
}

function fraseSemanas(n: number): string {
  return `${n} semana${n === 1 ? "" : "s"}`;
}

/** El texto que sigue a "— " en la descripción de auditoría (D6(a), ejemplos en el plan). */
function describirOrigen(origen: OrigenNormalizado | null, guardado?: { cantidad: number | null; mermaPorcentaje: number | null }): string {
  if (!origen || origen.tipo === "manual") return "edición manual";

  const detalle: string[] = [];
  if (origen.tipo === "sugerencia_pool") {
    if (origen.platos !== null) detalle.push(`insumo compartido por ${origen.platos} plato(s)`);
    if (origen.semanas !== null) detalle.push(fraseSemanas(origen.semanas));
    if (origen.ajusteR2 !== null) detalle.push(`ajuste R² ${origen.ajusteR2.toFixed(2)}`);
  } else {
    const guardadoTxt = guardado?.cantidad !== null && guardado?.cantidad !== undefined ? `, guardado ${guardado.cantidad}` : "";
    if (origen.sugerido !== null) detalle.push(`sugerido ${origen.sugerido}${guardadoTxt}`);
    if (origen.semanas !== null) detalle.push(fraseSemanas(origen.semanas));
    if (origen.confianza !== null) detalle.push(`confianza ${origen.confianza}`);
    if (origen.comprado !== null && origen.vendido !== null) detalle.push(`comprado ${origen.comprado}, vendido ${origen.vendido}`);
  }
  return `desde sugerencia de Rendimiento real de recetas (${detalle.join("; ")})`;
}

export interface DescribirCalibracionArgs {
  productoNombre: string;
  insumoNombre: string;
  sucursalNombre: string;
  campo: "cantidad" | "mermaPorcentaje";
  central: { cantidad: number; mermaPorcentaje: number; unidadNombre: string };
  origen: OrigenNormalizado | null;
  /** Los valores que se van a guardar (para el texto "sugerido X, guardado Y" cuando difieren por el redondeo). */
  guardado?: { cantidad: number | null; mermaPorcentaje: number | null };
}

/** D6(a): descripción legible de un cambio de calibración local (manual o desde sugerencia). */
export function describirCalibracion(args: DescribirCalibracionArgs): string {
  const campoTxt = args.campo === "cantidad" ? "cantidad" : "merma";
  return (
    `Rendimiento de "${args.insumoNombre}" en "${args.productoNombre}" en «${args.sucursalNombre}» ` +
    `(central: ${args.central.cantidad} ${args.central.unidadNombre}, merma ${args.central.mermaPorcentaje} %): ${campoTxt} — ${describirOrigen(args.origen, args.guardado)}`
  );
}

/** D6(a): descripción del descarte de una calibración local, cuando `guardarReceta` arrastra los overrides a una versión nueva y esta línea cambió de unidad o salió de la receta (D3). */
export function describirDescarteArrastre(args: { insumoNombre: string; sucursalNombre: string; version: number; motivo: string }): string {
  return `Calibración de «${args.sucursalNombre}» para "${args.insumoNombre}" — descartada al guardar la versión ${args.version} de la receta central: ${args.motivo}.`;
}

/** D4: vuelve al valor central (los dos campos en null). */
export function describirVueltaAlCentral(args: { productoNombre: string; insumoNombre: string; sucursalNombre: string }): string {
  return `Rendimiento de "${args.insumoNombre}" en "${args.productoNombre}" en «${args.sucursalNombre}»: vuelta al valor central.`;
}
