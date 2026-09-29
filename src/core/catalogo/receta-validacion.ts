import type { Db } from "@/lib/db-tipos";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { validarCantidad } from "@/core/datos/cantidad";
import { whereDisponibleEnAlguna } from "./disponibilidad-producto-consulta";
import { validarUnidadInsumo } from "./producto";

/**
 * Tipos de entrada y validación de datos de `guardarReceta` (server/actions/catalogo/recetas.ts, Task #41 Fase B3).
 *
 * Solo valida los datos que llegan para una versión nueva de la receta — consulta catálogo (Producto/Insumo/Unidad) para
 * eso, pero nunca lee la receta en sí (RecetaVersion/RecetaIngrediente): por eso no figura en `ARCHIVOS_CLASIFICADOS` de
 * `test/arquitectura/lectores-de-receta.test.ts`. La autorización NO vive acá: la pone `guardarReceta` (`conPermiso`)
 * antes de llamar a cualquiera de estas funciones.
 */

export interface IngredienteInput {
  insumoProductoId: string;
  cantidad: number;
  unidadId: string;
  mermaPorcentaje?: number;
  observaciones?: string;
  /**
   * Insumos que reemplazan a este ingrediente cuando él y sus hermanos se agotan en la venta (docs/plan-sustitucion-insumos-receta-
   * 2026-09-26.md, D1), EN ORDEN. Ausente o `[]` = sin sustitutos. Solo aplica a recetas que se consumen al vender (D2) — se
   * rechaza en `validarIngredientes` si el producto de la receta tiene `seProduce`.
   */
  insumoSustitutoIds?: string[];
}

/**
 * Un paso de preparación — grounded contra Tandoor (`Step`) y Fudo
 * (docs/grounding-ficha-tecnica-tandoor.md). `insumoProductoIds` referencia
 * por insumo (no por `RecetaIngrediente.id`, que todavía no existe al
 * momento de armar este input) — opcional, la mayoría de los pasos no lo
 * van a usar (§6 del documento: Fudo ni lo ofrece).
 */
export interface PasoInput {
  orden: number;
  nombre?: string;
  instruccion: string;
  minutos?: number;
  insumoProductoIds?: string[];
}

/** Cabecera informativa de la receta — todo opcional, ver docs/grounding-ficha-tecnica-tandoor.md §6. */
export interface CabeceraRecetaInput {
  rendimientoCantidad?: number;
  rendimientoUnidadId?: string;
  racionesCantidad?: number;
  racionTamano?: number;
  racionUnidadId?: string;
  tiempoPreparacionMinutos?: number;
  tiempoCoccionMinutos?: number;
  comentarios?: string;
  presentacionEmplatado?: string;
  notasAdicionales?: string;
  equipamientoNecesario?: string;
}

/**
 * D8 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): al guardar, cada sustituto declarado tiene que ser un Insumo que
 * existe y está activo, distinto del propio Insumo del ingrediente principal, sin duplicados dentro de la misma línea, y con
 * TODAS sus MP disponibles compartiendo la unidad de stock del ingrediente principal (mismo criterio que `validarUnidadInsumo`,
 * ya usado para un producto suelto y para la fusión de Insumos).
 */
async function validarSustitutosDeIngrediente(db: Db, insumoSustitutoIds: string[], mp: { insumoId: string | null; unidadStockId: string }): Promise<string | null> {
  if (new Set(insumoSustitutoIds).size !== insumoSustitutoIds.length) return "Un ingrediente no puede tener el mismo sustituto declarado dos veces.";
  for (const insumoSustitutoId of insumoSustitutoIds) {
    if (mp.insumoId && insumoSustitutoId === mp.insumoId) return "Un sustituto no puede ser el mismo Insumo que el ingrediente principal.";
    const insumo = await db.insumo.findUnique({ where: { id: insumoSustitutoId } });
    if (!insumo) return "No se encontró uno de los insumos sustitutos.";
    if (!insumo.activo) return `El insumo sustituto "${insumo.nombre}" está inactivo.`;
    const invalidoUnidad = await validarUnidadInsumo(insumoSustitutoId, mp.unidadStockId, undefined, db);
    if (invalidoUnidad) return invalidoUnidad;
  }
  return null;
}

export async function validarIngredientes(db: Db, items: IngredienteInput[], producto: { seProduce: boolean }) {
  if (!items.length) return "La receta necesita al menos un ingrediente.";
  // D2: la sustitución automática solo tiene sentido donde el libro de origen-venta.ts decide la sección (venta de un PV que se
  // vende tal cual) — Producción usa resolverConsumoPorFamilia, que no la conoce (fuera de alcance de este plan).
  if (producto.seProduce && items.some((i) => i.insumoSustitutoIds?.length)) {
    return "La sustitución automática solo aplica a platos que se descuentan al vender (no a recetas que se producen).";
  }
  for (const item of items) {
    if (!(Number(item.cantidad) > 0)) return "Cada ingrediente necesita una cantidad mayor a 0.";
    if (!esNumeroFinito(item.cantidad)) return "Cada ingrediente necesita una cantidad válida.";
    if (Number(item.mermaPorcentaje ?? 0) < 0) return "La merma no puede ser negativa.";
    if (!esNumeroFinito(item.mermaPorcentaje ?? 0)) return "La merma no es un número válido.";
    const mp = await db.producto.findUnique({ where: { id: item.insumoProductoId } });
    if (!mp || mp.tipo !== "MP") {
      return `Cada ingrediente tiene que ser una materia prima (MP) (${mp?.nombre ?? item.insumoProductoId} no lo es).`;
    }
    // Global, no por sucursal (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.6): la receta es del Catálogo
    // Central, compartida entre sucursales — bloquear el editor porque UNA sucursal desactivó esta MP impediría editar
    // una receta de todas. Basta con que esté disponible EN ALGUNA; la aplicación local ya la bloquea en venta.ts/movimientos.ts.
    const disponibleEnAlguna = await db.producto.findFirst({ where: { id: mp.id, ...whereDisponibleEnAlguna() } });
    if (!disponibleEnAlguna) {
      return `Cada ingrediente tiene que ser una materia prima (MP) disponible en alguna sucursal (${mp.nombre} no lo está en ninguna).`;
    }
    if (item.insumoSustitutoIds?.length) {
      const invalidoSustitutos = await validarSustitutosDeIngrediente(db, item.insumoSustitutoIds, mp);
      if (invalidoSustitutos) return invalidoSustitutos;
    }
  }
  return null;
}

export function validarPasos(pasos: PasoInput[], items: IngredienteInput[]): string | null {
  const insumoIdsValidos = new Set(items.map((i) => i.insumoProductoId));
  const ordenesVistos = new Set<number>();
  for (const p of pasos) {
    if (!texto(p.instruccion)) return "Cada paso necesita una instrucción.";
    if (!(Number(p.orden) > 0)) return "Cada paso necesita un orden mayor a 0.";
    if (ordenesVistos.has(p.orden)) return `Hay dos pasos con el mismo orden (${p.orden}).`;
    ordenesVistos.add(p.orden);
    if (p.minutos !== undefined && Number(p.minutos) < 0) return "Los minutos de un paso no pueden ser negativos.";
    if (p.minutos !== undefined && !esNumeroFinito(p.minutos)) return "Los minutos de un paso no son un número válido.";
    for (const insumoProductoId of p.insumoProductoIds ?? []) {
      if (!insumoIdsValidos.has(insumoProductoId)) return "Un paso no puede marcar un ingrediente que no está en esta misma receta.";
    }
  }
  return null;
}

/**
 * Cabecera informativa: nunca se validaba (bug real — un texto inválido en el cliente llegaba como `NaN` directo a
 * `prisma.recetaVersion.create`, sin ningún `esNumeroFinito` ni control de rango). `rendimientoCantidad`/`racionTamano`
 * son cantidades CON unidad — se validan con el módulo central (`validarCantidad`), a los decimales de la unidad elegida
 * (`rendimientoUnidadId`/`racionUnidadId` respectivamente; sin unidad elegida no hay forma de saber cuántos decimales
 * admite, así que se rechaza). Las tres restantes son enteros >= 0 sin unidad — mismo criterio que ya usaba `validarPasos`
 * más arriba para los minutos de un paso.
 */
export async function validarCabecera(db: Db, cabecera: CabeceraRecetaInput): Promise<string | null> {
  if (cabecera.rendimientoCantidad !== undefined) {
    if (!cabecera.rendimientoUnidadId) return "Falta la unidad del rendimiento.";
    const unidad = await db.unidad.findUnique({ where: { id: cabecera.rendimientoUnidadId }, select: { nombre: true, decimales: true } });
    if (!unidad) return "No se encontró la unidad del rendimiento.";
    const resultado = validarCantidad(cabecera.rendimientoCantidad, unidad, { etiqueta: "El rendimiento" });
    if (!resultado.ok) return resultado.mensaje;
  }
  if (cabecera.racionTamano !== undefined) {
    if (!cabecera.racionUnidadId) return "Falta la unidad del tamaño de ración.";
    const unidad = await db.unidad.findUnique({ where: { id: cabecera.racionUnidadId }, select: { nombre: true, decimales: true } });
    if (!unidad) return "No se encontró la unidad del tamaño de ración.";
    const resultado = validarCantidad(cabecera.racionTamano, unidad, { etiqueta: "El tamaño de ración" });
    if (!resultado.ok) return resultado.mensaje;
  }
  if (cabecera.racionesCantidad !== undefined) {
    if (cabecera.racionesCantidad < 0) return "La cantidad de raciones no puede ser negativa.";
    if (!esNumeroFinito(cabecera.racionesCantidad)) return "La cantidad de raciones no es un número válido.";
    if (!Number.isInteger(cabecera.racionesCantidad)) return "La cantidad de raciones tiene que ser un número entero.";
  }
  if (cabecera.tiempoPreparacionMinutos !== undefined) {
    if (cabecera.tiempoPreparacionMinutos < 0) return "El tiempo de preparación no puede ser negativo.";
    if (!esNumeroFinito(cabecera.tiempoPreparacionMinutos)) return "El tiempo de preparación no es un número válido.";
    if (!Number.isInteger(cabecera.tiempoPreparacionMinutos)) return "El tiempo de preparación tiene que ser un número entero.";
  }
  if (cabecera.tiempoCoccionMinutos !== undefined) {
    if (cabecera.tiempoCoccionMinutos < 0) return "El tiempo de cocción no puede ser negativo.";
    if (!esNumeroFinito(cabecera.tiempoCoccionMinutos)) return "El tiempo de cocción no es un número válido.";
    if (!Number.isInteger(cabecera.tiempoCoccionMinutos)) return "El tiempo de cocción tiene que ser un número entero.";
  }
  return null;
}
