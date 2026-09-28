import type { AccionConteo } from "@prisma/client";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «conteo físico» (Task #41, Fase M, M13e1 — docs/arquitectura-casos-de-uso-2026-09-27.md). El comando y el
 * resultado del caso de uso de `src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico.ts`.
 *
 * Migración PARCIAL a propósito en M13e1 (como P1 con `recetas.ts`): esta feature cubrió SOLO `registrarConteoFisico`/
 * `registrarConteosFisicos`. `resolverConteoPendiente`/`cancelarConteoFisico` migraron en M13e2 (tipos propios en
 * `resolver-conteo.schema.ts`/`cancelar-conteo.schema.ts`) y `obtenerHistorialConteosFisicos` se mudó a
 * `src/server/actions/movimientos/lecturas-conteo-fisico.ts` — ver docs/arquitectura-casos-de-uso-2026-09-27.md, M13e2.
 */

/**
 * Comando «registrar un conteo físico»: lo que recibe `registrarConteoFisicoCasoDeUso`, YA validado por `guardComandoConteoFisico`
 * (formato: sección en blanco — la ÚNICA validación puramente de formato que corría en línea antes de la transacción). El resto
 * (producto, disponibilidad en la sucursal, "tiene stock real", formato/signo/decimales del conteo tecleado) depende de datos de base
 * recién conocidos dentro de la transacción — se queda en el caso de uso, mismo criterio que `reclasificarStockCasoDeUso` (M13d).
 */
export interface ComandoConteoFisico {
  productoId: string;
  seccionId: string;
  /** El LOTE contado (null/undefined = "total, sin lote puntual" — misma semántica que Stock.js). */
  loteVencimiento?: Date | null;
  conteoReal: number;
  fechaConteo: Date;
  accion: AccionConteo;
  detalle?: string;
}

/** Por qué no se pudo registrar el conteo (la sección en blanco la rechaza antes el guard). */
export type CodigoConteoFisico = "SECCION_NO_ENCONTRADA" | "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_NO_DISPONIBLE" | "SIN_STOCK_REAL" | "CANTIDAD_INVALIDA";

/** `datos` de un conteo registrado con éxito. */
export interface DatosRegistrarConteoFisico {
  conteoId: string;
  diferencia: number;
  /** true si la diferencia se ajustó de verdad en el Kardex (accion AJUSTAR y diferencia != 0) — false para FALTA_MOVIMIENTO/DESCARTAR o diferencia 0. */
  ajustado: boolean;
}

export type ResultadoConteoFisico = ResultadoCaso<DatosRegistrarConteoFisico, CodigoConteoFisico>;
