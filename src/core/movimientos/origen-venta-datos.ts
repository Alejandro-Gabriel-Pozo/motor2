import type { LibroDeStock, SeccionCandidata } from "@/core/movimientos/origen-venta";

/**
 * TIPOS del origen de la venta (Pureza Fase 4, tramo A): de qué sección sale cada consumo (`OrigenVenta`), el paso previo (`OrigenPreparado`) y lo que el núcleo puro
 * `origen-venta.ts` necesita para decidir (`DatosDeOrigen`). Los cargadores con Prisma (`prepararOrigen`, `cargarDatosDeOrigen`) viven en
 * `server/persistencia/movimientos/cargar-origen-de-venta.ts`.
 */

export type OrigenVenta = { tipo: "seccion"; seccionId: string } | { tipo: "automatico" };

/** Paso previo, ANTES de validar las líneas: resuelve las secciones candidatas o devuelve el error listo para mostrar. */
export type OrigenPreparado =
  | { ok: true; tipo: "seccion"; fija: SeccionCandidata }
  | { ok: true; tipo: "automatico"; activas: (SeccionCandidata & { sirveDeRespaldoEnVentas: boolean })[] }
  | { ok: false; mensaje: string };

export interface DatosDeOrigen {
  libro: LibroDeStock;
  /** El insumo y sus hermanos disponibles en la sucursal (él mismo incluido); sin insumo, solo él. */
  familiaDe(mpId: string): string[];
  /**
   * D8 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): las MP de un Insumo declarado como SUSTITUTO en alguna línea de
   * receta, ya filtradas por defensa — disponibles en la sucursal, `Insumo.activo`, y con la MISMA unidad de stock que se pide
   * (la del ingrediente principal al que sustituyen). El dedupe contra la familia principal de ESA línea lo hace el núcleo puro
   * (`asignarConsumosDeVenta`), no acá — esta función no conoce "la línea", solo el Insumo y la unidad.
   */
  familiaSustitutaDe(insumoId: string, unidadStockId: string): string[];
  /** Sección habitual del PV (en modo sección: la elegida). */
  habitualDe(pvId: string): SeccionCandidata | null;
  /** Secciones activas que sirven de respaldo automático (`sirveDeRespaldoEnVentas`; en modo sección: ninguna). */
  respaldos: SeccionCandidata[];
  /** Sección del último movimiento del producto entre las de respaldo, o null. */
  referenciaDe(productoId: string): string | null;
  /** Última opción cuando nada más decide la sección (en modo sección: la elegida; en automático: el primer respaldo por nombre). */
  seccionPorDefectoId: string;
  nombreDeSeccion(seccionId: string): string;
}
