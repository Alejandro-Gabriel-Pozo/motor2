/**
 * "Rendimiento real de recetas", método CONCILIADO (Diseño B, Task #26 del
 * backlog — reabre una decisión previamente cerrada, autorizada por el
 * dueño del negocio: D1). Módulo puro (sin importar `@/lib/db`, mismo
 * motivo que `rendimiento-recetas-vistas.ts`: cualquier import de valor de
 * un módulo que arrastre Prisma revienta el bundle del cliente el día que
 * un componente "use client" importe algo de acá) — `rendimiento-
 * recetas.ts` solo trae los movimientos/conteos reales y llama a estas
 * funciones puras.
 *
 * EL PROBLEMA que resuelve: el método de hoy (`totalEntradas / totalVendido`,
 * "COMPRAS") asume que todo lo que entra en la ventana se consume en la
 * ventana — falso si se compra por lote y algo queda en el depósito (caso
 * real del Agua, docstring de `rendimiento-recetas.ts`). La corrección
 * obvia ("restar Δstock") es tautológica: el saldo del sistema YA asume la
 * propia receta (cada venta escribe un CONSUMO = receta × vendido), así
 * que Δstock siempre reproduce el mismo desvío que se está midiendo, nunca
 * un número independiente.
 *
 * LA SALIDA: un Conteo Físico (`ConteoFisico.estado === "RESUELTO"`) es la
 * ÚNICA medición del depósito que NO depende de la receta — ahí, y solo
 * ahí, el Kardex coincide con lo físico de verdad. Con DOS anclas (una al
 * principio del tramo, otra al final) que cubren TODO el pool, el consumo
 * real del tramo se puede sumar DIRECTO por proceso (CONSUMO/CONTROL/
 * AJUSTE) en vez de inferirlo de las compras — método "CONTEO", medido en
 * vez de estimado. Sin las dos anclas (D4), se cae al método "COMPRAS" de
 * siempre: nunca se deja la fila sin ningún número.
 */
import { ZONA_UTC, finDelDiaDe } from "@/core/tiempo/zona-horaria";

/** Redondeo a 3 decimales, para cantidades de stock — duplicado a propósito de `comun.ts`/`rendimiento-recetas-vistas.ts` (ver el docstring de arriba, el motivo es el mismo: nunca importar nada que arrastre Prisma). */
function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

/** Cómo se calculó `cantidadEstimada`/`desviacionPorcentaje` de una fila — nunca oculto, siempre declarado (mismo criterio que `RotuloLinea`, decisión 3: rotular, nunca ocultar). */
export type MetodoRendimiento = "CONTEO" | "COMPRAS";

// ---------------------------------------------------------------------------
// Clasificación: qué proceso cuenta como "consumo de la receta" (D2)
// ---------------------------------------------------------------------------

/**
 * Un movimiento de Kardex, ya reducido a lo que hace falta para decidir si
 * cuenta como consumo real de la receta (D2) — no el `MovimientoStock`
 * completo, para que este módulo se quede sin importar Prisma.
 */
export interface MovimientoParaConciliar {
  /** `MovimientoStock.proceso` — el efecto REAL de esta línea puntual. */
  procesoMovimiento: string;
  /** `MovimientoStock.operacion.proceso` — el proceso de la Operación que la generó (puede diferir del de la línea: una VENTA/PRODUCCION escribe también líneas CONSUMO, ver el docstring de `MovimientoStock` en el schema). */
  procesoOperacion: string;
  /** Ya con signo (convención del Kardex: + entra, − sale). */
  cantidad: number;
}

/**
 * D2 (decisión del dueño, confirmada): solo CONSUMO/CONTROL/AJUSTE cuentan
 * como consumo real de la receta entre dos anclas — y CONSUMO solo cuando
 * lo generó una receta de verdad (una venta o una producción), nunca un
 * CONSUMO MANUAL (Operacion.proceso = "CONSUMO" con `Operacion.destino` —
 * ui-config.ts, `pideDestino: true`): eso es una pérdida/consumo interno,
 * que ya mide `/reportes/perdidas` aparte (perdidas.ts, `SIN_DESTINO`), no
 * un desvío de receta.
 *
 * CONTROL siempre cuenta — es la propia medición del Conteo Físico (el
 * ajuste que escribe `registrarConteoFisico`/`resolverConteoPendiente`/
 * `cancelarConteoFisico`, todos con `Operacion.proceso === "CONTROL"` sin
 * excepción, así que no hace falta mirar `procesoOperacion` para él).
 *
 * AJUSTE cuenta salvo que sea la reversión de anular una compra o una
 * venta (D2) — ESE filtro se hace en la QUERY (`OPERACION_QUE_NO_ES_
 * REVERSION_POR_ANULACION` de `@/core/movimientos/anulaciones`, mismo
 * criterio que ya usa `diferencias-ajustes.ts`), nunca acá: esta función
 * asume que el llamador ya excluyó esas filas antes de traerlas, así que
 * todo AJUSTE que llega hasta acá es un ajuste manual real. Tampoco hace
 * falta mirar `procesoOperacion` para AJUSTE (una línea AJUSTE siempre
 * cuelga de una Operación AJUSTE, manual o de reversión).
 *
 * Los que NUNCA cuentan, aunque muevan el mismo insumo del pool (documentado
 * para que quede explícito qué se decidió sobre cada uno, no un olvido):
 * TRANSFERENCIA/TRANSFERENCIA_SALIDA_SUCURSAL/TRANSFERENCIA_ENTRADA_
 * SUCURSAL/REINGRESO_TRANSFERENCIA_SUCURSAL (mueve stock de un lado a
 * otro, no lo consume — escenario E del plan: sin este filtro, un traspaso
 * saliente se vería como sobreconsumo de receta); DEVOLUCION_PROVEEDOR/
 * DEVOLUCION_CONSIGNACION/LIQUIDACION_CONSIGNACION (vuelve al proveedor o
 * es puramente financiero); RECLASIFICACION (cambia de categoría, no de
 * cantidad total); MERMA (pérdida, cubierta por `/reportes/perdidas`,
 * igual que el CONSUMO manual).
 */
export function cuentaComoConsumoDeReceta(procesoMovimiento: string, procesoOperacion: string): boolean {
  if (procesoMovimiento === "CONTROL") return true;
  if (procesoMovimiento === "AJUSTE") return true;
  // El llamador ya filtró `operacion: { anuladaEn: null }` antes de traer estas filas — una VENTA o una PRODUCCION
  // anulada nunca llega hasta acá, así que no hace falta volver a decidir nada sobre anuladas en esta función.
  if (procesoMovimiento === "CONSUMO") return procesoOperacion === "VENTA" || procesoOperacion === "PRODUCCION";
  return false;
}

/**
 * −Σ CONSUMO(venta/producción) − Σ CONTROL − Σ AJUSTE(no-reversión) de un
 * tramo entero — el consumo real MEDIDO directo por proceso entre dos
 * anclas de Conteo Físico (Diseño B), nunca restando `stockCierre −
 * stockApertura` (eso es tautológico, ver el docstring del módulo). Estos
 * tres procesos siempre son SALIDA (negativos) en el Kardex cuando
 * representan consumo real, así que negar la suma deja la convención en
 * un número POSITIVO ("cuánto se consumió de verdad") — misma convención
 * que `totalVendido`/`totalEntradas` del método COMPRAS.
 */
export function consumoRealDelTramo(movimientos: readonly MovimientoParaConciliar[]): number {
  const suma = movimientos
    .filter((m) => cuentaComoConsumoDeReceta(m.procesoMovimiento, m.procesoOperacion))
    .reduce((acc, m) => acc + m.cantidad, 0);
  return redondearCantidad(-suma);
}

// ---------------------------------------------------------------------------
// Anclas: dos Conteo Físico RESUELTO que cubren el pool entero, el mismo día
// ---------------------------------------------------------------------------

/** Clave estable de un par (producto, sección) — para comparar sets sin depender de un tipo compuesto. */
export function clavePar(productoId: string, seccionId: string): string {
  return `${productoId}::${seccionId}`;
}

/**
 * Un día candidato a ancla — ya con los dos sets que hacen falta para
 * decidir si califica, resueltos por el llamador (requieren el Kardex y
 * los `ConteoFisico` reales, así que esa parte no puede ser pura).
 */
export interface CandidatoAncla {
  /** El día calendario (D3: el conteo vale al cierre del día calendario en que se realizó) — se usa tal cual, sin volver a normalizar acá. */
  fecha: Date;
  /** Pares (producto, sección) del pool con un `ConteoFisico` `RESUELTO` fechado ESE MISMO día calendario. */
  paresContados: ReadonlySet<string>;
  /** Pares (producto, sección) del pool con saldo del sistema ≠ 0 al CIERRE de ese día calendario (incluyendo el propio ajuste CONTROL de ese día, si lo hubo) — TODOS tienen que estar en `paresContados` para que el día califique. */
  paresConSaldo: ReadonlySet<string>;
}

/**
 * Un día califica como ancla si TODOS los pares (producto, sección) del
 * pool con saldo ≠ 0 al cierre de ese día fueron contados (RESUELTO) ese
 * mismo día — "el Kardex coincide con lo físico" para el pool ENTERO, no
 * solo para el producto que motivó el conteo. Vacíamente `true` cuando el
 * pool entero está en 0 ese día (nada que verificar), pero el día sigue
 * necesitando al menos un `ConteoFisico` real para ser CANDIDATO en
 * primer lugar (eso ya lo filtró el llamador al construir `CandidatoAncla`
 * — un día sin ningún conteo nunca llega hasta acá).
 */
export function esAnclaValida(candidato: CandidatoAncla): boolean {
  for (const par of candidato.paresConSaldo) {
    if (!candidato.paresContados.has(par)) return false;
  }
  return true;
}

export interface Anclas {
  anclaDesde: Date;
  anclaHasta: Date;
}

/**
 * Elige las dos anclas del tramo dentro de la ventana `[desde, hasta]`
 * elegida en el reporte — la ancla-desde es la MÁS TEMPRANA válida en o
 * después de `desde`, la ancla-hasta es la MÁS TARDÍA válida en o antes de
 * `hasta` ("en los dos extremos de la ventana de medición"). `null` si no
 * hay al menos dos anclas válidas DISTINTAS dentro de la ventana — ahí el
 * llamador cae al método COMPRAS (D4): nunca se deja la fila sin ningún
 * número, solo se marca como estimado en vez de medido.
 */
export function elegirAnclas(candidatos: readonly CandidatoAncla[], desde: Date, hasta: Date): Anclas | null {
  const validas = candidatos
    .filter(esAnclaValida)
    .map((c) => c.fecha)
    .sort((a, b) => a.getTime() - b.getTime());

  const anclaDesde = validas.find((f) => f.getTime() >= desde.getTime());
  const candidatasHasta = validas.filter((f) => f.getTime() <= hasta.getTime());
  const anclaHasta = candidatasHasta[candidatasHasta.length - 1];

  if (!anclaDesde || !anclaHasta || anclaDesde.getTime() >= anclaHasta.getTime()) return null;
  return { anclaDesde, anclaHasta };
}

/**
 * Todas las anclas válidas dentro de `[desde, hasta]`, ordenadas — para el
 * caso compartido/regresión (§6 del plan): cada intervalo ENTRE anclas
 * consecutivas es una observación (`y_k`/`X_k`), en vez de una semana fija.
 * `elegirAnclas` (arriba) es el caso particular de tomar solo la primera y
 * la última de esta misma lista — se comparte la misma noción de "ancla
 * válida", solo cambia cuántas hacen falta.
 */
export function anclasValidasEnVentana(candidatos: readonly CandidatoAncla[], desde: Date, hasta: Date): Date[] {
  return candidatos
    .filter(esAnclaValida)
    .map((c) => c.fecha)
    .filter((f) => f.getTime() >= desde.getTime() && f.getTime() <= hasta.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
}

// ---------------------------------------------------------------------------
// El tramo: [fin del día de la ancla-desde, fin del día de la ancla-hasta]
// ---------------------------------------------------------------------------

/** Fin del día calendario (UTC) de `fecha` — 23:59:59.999, mismo criterio que `rangoUtc` de rendimiento-recetas.ts. */
export function finDelDiaUtc(fecha: Date): Date {
  return finDelDiaDe(fecha, ZONA_UTC);
}

/**
 * Los límites reales del tramo, dadas las dos anclas — EXCLUYE el día de
 * `anclaDesde` (esa ancla es el punto de partida ya reconciliado: lo que
 * pasó ESE día ya está "antes" del tramo) e INCLUYE el día de `anclaHasta`
 * completo (el propio ajuste CONTROL que ese conteo pudiera escribir, si
 * hubo diferencia, pasa DENTRO del tramo — escenario B del plan: el
 * CONTROL de -9 fechado el día de la ancla-hasta cuenta).
 */
export function limitesDelTramo({ anclaDesde, anclaHasta }: Anclas): { desde: Date; hasta: Date } {
  return { desde: finDelDiaUtc(anclaDesde), hasta: finDelDiaUtc(anclaHasta) };
}
