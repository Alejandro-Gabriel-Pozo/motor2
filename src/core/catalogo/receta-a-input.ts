import type { Prisma } from "@prisma/client";
import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "./receta-validacion";

/**
 * Lo que hay que leer de una versión de receta para devolverla como inputs de `guardarReceta`. Lo comparten la receta CENTRAL
 * (`server/actions/catalogo/recetas.ts`) y la PROPIA de una sucursal (`server/actions/catalogo/receta-sucursal.ts`): las dos hacen el
 * mismo round-trip, solo cambia de qué serie sale la versión (la elige el embudo `recetas-vigentes.ts`, no este archivo).
 */
export const INCLUDE_RECETA_COMPLETA = {
  ingredientes: {
    include: { insumoProducto: true, unidad: true, sustitutos: { orderBy: { orden: "asc" as const }, include: { insumoSustituto: true } } },
  },
  pasos: { orderBy: { orden: "asc" as const }, include: { ingredientes: { include: { recetaIngrediente: { include: { insumoProducto: true } } } } } },
  rendimientoUnidad: true,
  racionUnidad: true,
};

export type RecetaCompleta = Prisma.RecetaVersionGetPayload<{ include: typeof INCLUDE_RECETA_COMPLETA }> | null;

/**
 * Round-trip de una versión de receta a los inputs de guardarReceta — usado por cada acción puntual (agregar/editar/quitar UN
 * ingrediente o paso) para no pisar lo que no se está tocando. Copia `insumoSustitutoIds` (ya en su `orden` — la ida y vuelta
 * CRÍTICA de docs/plan-sustitucion-insumos-receta-2026-09-26.md §0.6/D1: sin esto, cualquier edición puntual que no toque el
 * ingrediente sustituido igual le borraría los sustitutos en la próxima versión).
 */
export function mapIngredientesAInput(vigente: RecetaCompleta): IngredienteInput[] {
  if (!vigente) return [];
  return vigente.ingredientes.map((i) => ({
    insumoProductoId: i.insumoProductoId,
    cantidad: Number(i.cantidad),
    unidadId: i.unidadId,
    mermaPorcentaje: Number(i.mermaPorcentaje),
    observaciones: i.observaciones ?? undefined,
    insumoSustitutoIds: i.sustitutos.map((s) => s.insumoSustitutoId),
  }));
}

export function mapPasosAInput(vigente: RecetaCompleta): PasoInput[] {
  if (!vigente) return [];
  return vigente.pasos.map((p) => ({
    orden: p.orden,
    nombre: p.nombre ?? undefined,
    instruccion: p.instruccion,
    minutos: p.minutos ?? undefined,
    insumoProductoIds: p.ingredientes.map((pi) => pi.recetaIngrediente.insumoProductoId),
  }));
}

export function mapCabeceraAInput(vigente: RecetaCompleta): CabeceraRecetaInput {
  if (!vigente) return {};
  return {
    rendimientoCantidad: vigente.rendimientoCantidad ? Number(vigente.rendimientoCantidad) : undefined,
    rendimientoUnidadId: vigente.rendimientoUnidadId ?? undefined,
    racionesCantidad: vigente.racionesCantidad ?? undefined,
    racionTamano: vigente.racionTamano ? Number(vigente.racionTamano) : undefined,
    racionUnidadId: vigente.racionUnidadId ?? undefined,
    tiempoPreparacionMinutos: vigente.tiempoPreparacionMinutos ?? undefined,
    tiempoCoccionMinutos: vigente.tiempoCoccionMinutos ?? undefined,
    comentarios: vigente.comentarios ?? undefined,
    presentacionEmplatado: vigente.presentacionEmplatado ?? undefined,
    notasAdicionales: vigente.notasAdicionales ?? undefined,
    equipamientoNecesario: vigente.equipamientoNecesario ?? undefined,
  };
}
