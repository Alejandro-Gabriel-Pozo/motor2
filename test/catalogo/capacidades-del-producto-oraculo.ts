/**
 * ORÁCULO de `capacidadesDelProducto` (docs/diseno-reventa-e4-2026-11-17.md §3 y §8; regla de combinaciones del 2026-10-28): lo que un producto puede hacer, ESCRITO APARTE del código como tabla legible. No importa
 * nada de `src/core/catalogo/capacidades-del-producto.ts` más que los TIPOS (para recorrer): si importara la lógica, el test compararía el código consigo mismo.
 *
 * Una fila por forma del producto, una columna por pregunta de negocio. Cada celda es lo que HOY deciden los literales de `tipo`/`seProduce` repartidos por el código (verificado el 2026-11-17 contra la rama
 * `main`; la columna «dónde se decide hoy» de cada capacidad). E4-0 no cambia ningún resultado: la tabla de MP y PV es la de hoy. REVENTA es la única fila nueva.
 */
import type { CapacidadesDelProducto } from "@/core/catalogo/capacidades-del-producto";

/** Dónde se decide hoy cada capacidad (para que quien migre un circuito sepa qué literal reemplaza). */
export const DONDE_SE_DECIDE_HOY: Readonly<Record<keyof CapacidadesDelProducto, string>> = {
  seCompra: "core/movimientos/transiciones.ts (`proceso === 'COMPRA' && tipo !== 'MP'`), core/movimientos/ui-config.ts (selector de COMPRA `{tipo:'MP'}`)",
  seVende: "core/movimientos/linea-de-venta.ts (`tipo !== 'PV'`), server/actions/pos/casos-de-uso/agregar-items.ts, las siete acciones de carta `NO_ES_PV`",
  tieneStockPropio: "core/movimientos/transiciones.ts (`tieneStockReal`: MP, o PV que se produce)",
  sePuedeProducir: "core/movimientos/transiciones.ts (`PRODUCCION` ⇔ `seProduce`, sin mirar el tipo)",
  llevaReceta: "server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts (PV siempre; MP solo si se produce)",
  esIngredienteDeReceta: "core/catalogo/receta-validacion.ts (E4-3b: el ingrediente es MP o Reventa), core/movimientos/linea-de-venta.ts (`revisarMateriaPrima`), selectores y `whereEsIngredienteDeReceta`",
  loConsumeUnaOpcion: "server/actions/catalogo/casos-de-uso/opciones-de-venta-en-tx.ts (E4-3b: el consumo de una opción es MP o Reventa), core/movimientos/linea-de-venta.ts, listas de opciones y `whereLoConsumeUnaOpcion`",
};

const NADA: CapacidadesDelProducto = { seCompra: false, seVende: false, tieneStockPropio: false, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: false, loConsumeUnaOpcion: false };

/** Las cuatro formas que existen hoy (tipo × se produce) y la nueva (REVENTA). */
export const MP_QUE_NO_SE_PRODUCE: CapacidadesDelProducto = { seCompra: true, seVende: false, tieneStockPropio: true, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: true, loConsumeUnaOpcion: true };
export const MP_QUE_SE_PRODUCE: CapacidadesDelProducto = { seCompra: true, seVende: false, tieneStockPropio: true, sePuedeProducir: true, llevaReceta: true, esIngredienteDeReceta: true, loConsumeUnaOpcion: true };
export const PV_QUE_NO_SE_PRODUCE: CapacidadesDelProducto = { seCompra: false, seVende: true, tieneStockPropio: false, sePuedeProducir: false, llevaReceta: true, esIngredienteDeReceta: false, loConsumeUnaOpcion: false };
export const PV_QUE_SE_PRODUCE: CapacidadesDelProducto = { seCompra: false, seVende: true, tieneStockPropio: true, sePuedeProducir: true, llevaReceta: true, esIngredienteDeReceta: false, loConsumeUnaOpcion: false };
/** REVENTA (E4, §3 y R1 a R3 y R7 del diseño): se compra, se vende, lleva stock propio; sin receta, no se produce, y SÍ es ingrediente de receta y la consume una opción (R7 CONFIRMADA el 2026-11-17, E4-3b). */
export const REVENTA_COHERENTE: CapacidadesDelProducto = { seCompra: true, seVende: true, tieneStockPropio: true, sePuedeProducir: false, llevaReceta: false, esIngredienteDeReceta: true, loConsumeUnaOpcion: true };
export const NADA_PUEDE: CapacidadesDelProducto = NADA;

/** Lo esperado para una combinación cualquiera (la tabla, no el código): lo desconocido no puede nada. */
export function esperadoPara(tipo: string, seProduce: boolean, claseDeUso: string | null | undefined): CapacidadesDelProducto {
  if (claseDeUso === "REVENTA") return tipo === "PV" && !seProduce ? REVENTA_COHERENTE : NADA_PUEDE;
  if (tipo === "MP") return seProduce ? MP_QUE_SE_PRODUCE : MP_QUE_NO_SE_PRODUCE;
  if (tipo === "PV") return seProduce ? PV_QUE_SE_PRODUCE : PV_QUE_NO_SE_PRODUCE;
  return NADA_PUEDE;
}
