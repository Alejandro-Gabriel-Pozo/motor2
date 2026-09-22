import { redondearMoneda } from "@/core/movimientos/transiciones";
import { mediana } from "@/core/estadistica/mediana";

/**
 * View-model puro de "Rendimiento real de recetas" (docs/planes-demo-y-
 * claridad-reportes-2026-09-21.md §3, docs/plan-rendimiento-recetas-2026-09-22.md
 * §B). Todo acá es puro (sin Prisma) — `rendimiento-recetas.ts` solo trae
 * datos y llama a estas funciones. Mismo molde que `historial-vistas.ts`
 * (§4): tipos locales, sin depender de que la capa de datos ya declare los
 * campos nuevos.
 *
 * A propósito NO importa nada de `./comun` (aunque tiene `redondearCantidad`,
 * la misma función de abajo): ese módulo importa `@/lib/db` a nivel de
 * archivo, así que CUALQUIER import de valor (no de tipo) desde acá arrastra
 * Prisma/`pg` al bundle del cliente — reventó el build la primera vez que un
 * componente "use client" (fila-simple.tsx/fila-compartida.tsx) importó una
 * función de este archivo. `redondearCantidad` se duplica localmente por eso.
 */
function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Umbral de ámbar — FIJO, no configurable (decisión 5)
// ---------------------------------------------------------------------------

/**
 * Un desvío de |10 %| o más se marca en ámbar. FIJO y NO configurable
 * (decisión 5, docs/planes-demo-y-claridad-reportes-2026-09-21.md §3;
 * grounding §6.5: es el estándar de industria — ERPNext usa el mismo
 * número en el ejemplo de `over_delivery_receipt_allowance` — y el
 * proyecto ya decidió una vez que este dueño no configura umbrales,
 * periodo.ts:205). El ruido de denominador chico no se resuelve moviendo
 * este número: se resuelve ordenando por impacto en $ (`compararPorImpacto`)
 * y mostrando la banda de ruido al lado (`bandaDeRuidoDeLote`).
 */
export const UMBRAL_DESVIO_AMBAR_PCT = 10;

export function desvioEsNotable(desviacionPorcentaje: number | null): boolean {
  return desviacionPorcentaje !== null && Math.abs(desviacionPorcentaje) >= UMBRAL_DESVIO_AMBAR_PCT;
}

// ---------------------------------------------------------------------------
// Teórico con merma, estimado neto y desvío (decisión: comparar contra la
// receta CON merma, no solo la neta — defecto 3 de §3)
// ---------------------------------------------------------------------------

/** cantidad × (1 + merma%) — misma fórmula que descuenta el Kardex (venta.ts:85, movimientos.ts:100, costos.ts:63). */
export function calcularCantidadTeoricaBruta(cantidadReceta: number, mermaPorcentaje: number): number {
  return redondearCantidad(cantidadReceta * (1 + mermaPorcentaje / 100));
}

/**
 * El estimado bruto (entradas/vendido) llevado a neto, dividiendo por el
 * mismo factor de merma — es lo que hay que ESCRIBIR en la receta
 * (`RecetaIngrediente.cantidad` es neta): si se escribiera el bruto
 * directo, el botón "Usar este valor" volvería a ser peligroso para toda
 * línea con merma (plan §A5).
 */
export function calcularCantidadEstimadaNeta(cantidadEstimadaBruta: number, mermaPorcentaje: number): number {
  return redondearCantidad(cantidadEstimadaBruta / (1 + mermaPorcentaje / 100));
}

/**
 * % de desvío entre el estimado bruto y el teórico bruto — da EXACTAMENTE
 * lo mismo que comparar el estimado neto contra la receta neta (es la
 * misma razón, solo cambia si se mira antes o después de aplicar la
 * merma). `null` sin estimado o con receta teórica <= 0 (nada contra qué
 * comparar).
 */
export function calcularDesviacionPorcentaje(cantidadEstimadaBruta: number | null, cantidadTeoricaBruta: number): number | null {
  if (cantidadEstimadaBruta === null || cantidadTeoricaBruta <= 0) return null;
  return Math.round(((cantidadEstimadaBruta - cantidadTeoricaBruta) / cantidadTeoricaBruta) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Banda de ruido de lote — CONTEXTO en texto, nunca umbral de alerta
// ---------------------------------------------------------------------------

/**
 * Cuánto puede moverse el % de desvío solo por comprar de a lotes (cajas,
 * bolsas) en vez de por unidad — el ±19 % del caso real del Agua (lote 12,
 * 63 vendidos, teórico 1). Se calcula SOLO sobre compras (no producción: el
 * ruido de lote es del envase del proveedor, no de un lote de producción
 * propio). `null` sin compras en la ventana, sin ventas, o con teórico <= 0.
 */
export function bandaDeRuidoDeLote(cantidadesDeCadaCompra: number[], totalVendido: number, cantidadTeoricaBruta: number): number | null {
  const loteTipico = mediana(cantidadesDeCadaCompra);
  if (loteTipico === null || totalVendido <= 0 || cantidadTeoricaBruta <= 0) return null;
  return Math.round((loteTipico / totalVendido / cantidadTeoricaBruta) * 1000) / 10;
}

/** Solo elige el TEXTO ("cae dentro de la banda esperable"); nunca decide si la celda se pinta ámbar (esa es `desvioEsNotable`, fija — decisión 5 ya cerrada). */
export function dentroDeLaBanda(desviacionPorcentaje: number | null, bandaRuidoPct: number | null): boolean {
  return bandaRuidoPct !== null && desviacionPorcentaje !== null && Math.abs(desviacionPorcentaje) <= bandaRuidoPct;
}

// ---------------------------------------------------------------------------
// Impacto en $ — lo que de verdad ordena el ranking (decisión 5)
// ---------------------------------------------------------------------------

/**
 * (entradas reales − lo que la receta hubiera consumido) × costo de
 * reposición — mismo espíritu que `deltaImpacto` de periodo.ts:519
 * (grounding §6.3: Restaurant365/xtraCHEF ordenan por plata, no por %).
 * Forma sin división (nunca explota con `totalVendido = 0`, ahí ya da
 * `null` por `costoUnitario`/el propio caller). `null` sin costo conocido
 * — nunca se inventa un precio (mismo criterio que `perdidas.ts:83`).
 * Signo: positivo = entró/se consumió MÁS de lo que la receta prevé.
 */
export function impactoDelDesvio(totalEntradas: number, cantidadTeoricaBruta: number, totalVendido: number, costoUnitario: number | null): number | null {
  if (costoUnitario === null || totalVendido <= 0) return null;
  return redondearMoneda((totalEntradas - cantidadTeoricaBruta * totalVendido) * costoUnitario);
}

/**
 * Ordena por |impacto en $| descendente, con los `null` siempre al final
 * — reemplaza el orden alfabético de hoy (rendimiento-recetas.ts:234-236,
 * :337). `desempate` es el criterio de hoy (nombre del plato/insumo),
 * para cuando el impacto es igual (ambos null, o casualmente el mismo
 * número).
 */
export function compararPorImpacto<T>(a: T, b: T, impacto: (fila: T) => number | null, desempate: (a: T, b: T) => number): number {
  const ia = impacto(a);
  const ib = impacto(b);
  if (ia === null && ib === null) return desempate(a, b);
  if (ia === null) return 1; // null siempre al final
  if (ib === null) return -1;
  const diferencia = Math.abs(ib) - Math.abs(ia); // descendente
  return diferencia !== 0 ? diferencia : desempate(a, b);
}

// ---------------------------------------------------------------------------
// motivoSinEstimacion — explica en vez de mostrar/ocultar un número dudoso
// ---------------------------------------------------------------------------

/**
 * Por qué no hay una estimación confiable, en texto — mismo patrón que
 * `motivoNoResoluble` (ya existe en rendimiento-recetas.ts:52, Fase 2).
 * La fila NUNCA se oculta (decisión 3: rotular, nunca ocultar); sin
 * estimación tampoco hay botón "Usar este valor" (ya es así hoy). Orden
 * de evaluación: gana el primero que aplica.
 */
export function motivoSinEstimacion({
  totalVendido,
  totalEntradas,
  cantidadTeoricaBruta,
}: {
  totalVendido: number;
  totalEntradas: number;
  cantidadTeoricaBruta: number;
}): string | null {
  if (totalVendido === 0) return "No hubo ventas de este plato en la ventana elegida: no hay contra qué comparar.";
  if (totalEntradas === 0) return "No hubo compras ni producción de este insumo en la ventana: no se puede estimar el consumo.";
  if (cantidadTeoricaBruta <= 0) return "La receta dice 0: no se puede calcular un porcentaje de desvío.";
  return null;
}

// ---------------------------------------------------------------------------
// Rótulo declarado — reemplaza `esUsoTrivial` (inferido de cantidad===1 && merma===0)
// ---------------------------------------------------------------------------

export type RotuloLinea = "SUBRECETA_PRODUCIDA" | "PACKAGING_NO_COMESTIBLE" | "PRODUCTO_DE_REVENTA" | null;

export const ETIQUETA_ROTULO: Record<Exclude<RotuloLinea, null>, string> = {
  SUBRECETA_PRODUCIDA: "Sub-receta producida",
  PACKAGING_NO_COMESTIBLE: "Packaging / no comestible",
  PRODUCTO_DE_REVENTA: "Producto de reventa",
};

/**
 * Rótulo DECLARADO (datos que ya existen: `Producto.seProduce`, el grupo
 * "No comestibles"), no INFERIDO — grounding §4.6: ningún sistema de
 * referencia infiere la exclusión de una línea a partir de sus números.
 * Prioridad estricta (el caso trampa: un insumo que se produce Y es 1:1
 * gana "Sub-receta producida" — no es trivial, es justo el que conviene
 * revisar):
 *
 * 1. El INSUMO se produce (`insumoProducto.seProduce`) → sub-receta
 *    producida. NO es trivial — es la que más conviene revisar (antes se
 *    rotulaba mal, "(venta directa)").
 * 2. El insumo es del grupo "No comestibles" → packaging.
 * 3. El PV no se produce, la receta es 1:1 sin merma → producto de
 *    reventa (§4, decisión 8 — el caso del agua: el desvío acá no puede
 *    ser un error de receta).
 * 4. Ninguna de las anteriores → sin rótulo.
 */
export function rotularLineaDeReceta({
  insumoSeProduce,
  insumoEsNoComestible,
  pvSeProduce,
  cantidadReceta,
  mermaPorcentaje,
}: {
  insumoSeProduce: boolean;
  insumoEsNoComestible: boolean;
  pvSeProduce: boolean;
  cantidadReceta: number;
  mermaPorcentaje: number;
}): RotuloLinea {
  if (insumoSeProduce) return "SUBRECETA_PRODUCIDA";
  if (insumoEsNoComestible) return "PACKAGING_NO_COMESTIBLE";
  if (!pvSeProduce && cantidadReceta === 1 && mermaPorcentaje === 0) return "PRODUCTO_DE_REVENTA";
  return null;
}

// ---------------------------------------------------------------------------
// Confianza — explica el rótulo en vez de dejarlo sin motivo (residuo de la decisión 4)
// ---------------------------------------------------------------------------

export type Confianza = "alta" | "media" | "baja" | "sin_datos";

/** `calcularConfianza` (rendimiento-recetas.ts) no cambia — esto solo explica POR QUÉ, ya que con el default de 30 días nunca llega a "alta" (exige ≥8 semanas). */
export function explicarConfianza(confianza: Confianza, semanasConDatos: number): string {
  const semana = semanasConDatos === 1 ? "semana" : "semanas";
  switch (confianza) {
    case "alta":
      return `Alta — ${semanasConDatos} ${semana} con datos`;
    case "media":
      return `Media — la ventana elegida tiene ${semanasConDatos} ${semana}`;
    case "baja":
      return `Baja — solo ${semanasConDatos} ${semana} con datos`;
    case "sin_datos":
      return "Sin datos";
  }
}
