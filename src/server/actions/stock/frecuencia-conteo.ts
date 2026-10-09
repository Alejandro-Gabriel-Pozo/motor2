"use server";

import { guardComandoSetFrecuenciaConteo } from "@/core/features/stock/frecuencia-conteo.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { eliminarFrecuenciaConteoCasoDeUso } from "./casos-de-uso/eliminar-frecuencia-conteo";
import { setFrecuenciaConteoCasoDeUso } from "./casos-de-uso/set-frecuencia-conteo";

/**
 * Agenda de conteo físico periódico por sucursal × producto (sub-plan S,
 * docs/plan-rendimiento-recetas-2026-09-22.md §E). Reusa el permiso
 * `proceso_control` ("Registrar un Conteo Físico") en vez de crear uno
 * nuevo (decisión S2 del plan): quien cuenta es quien configura cada
 * cuánto — mismo criterio que ya gatea `/reportes/conteos` y
 * `/stock/reclasificar`.
 *
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-19) las dos mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{set-frecuencia-conteo,eliminar-frecuencia-conteo}.ts`; escrituras en server/persistencia/stock/frecuencia-conteo.ts): el archivo entero está en
 * `ACCIONES_CON_CASO_DE_USO`. La lectura (H8) sigue acá con su guarda. Ninguna de las dos refresca la vista (como antes).
 */
export async function listarFrecuenciasConteo(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "conteo_frecuencia");
  return ctx.db.frecuenciaConteoProducto.findMany({
    where: { sucursalId },
    // S-15 (plan de endurecimiento, T7): solo lo que la agenda dibuja (el `Producto` entero llevaba el costo de consignación a quien invoca la acción a mano). Más campos: se AGREGAN acá (GT-3a).
    select: { id: true, productoId: true, frecuenciaDias: true, producto: { select: { codigo: true, nombre: true } } },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/**
 * `frecuenciaDias === 0` desactiva la agenda de este producto (se conserva la fila, mismo criterio "0 es un valor real" de setStockMinimoProducto — no se borra, se pisa).
 *
 * Desde el Hito 4 (H4C-19): permiso → formato (`guardComandoSetFrecuenciaConteo`, core/features/stock/frecuencia-conteo.guard.ts, DENTRO del envoltorio) → caso de
 * uso (`casos-de-uso/set-frecuencia-conteo.ts`: el producto y el alta o reemplazo de la fila) → `aResultadoAccion`.
 */
export async function setFrecuenciaConteo(productoId: string, frecuenciaDias: number): Promise<ResultadoAccion> {
  return conPermiso("conteo_frecuencia", async (ctx) => {
    const comando = guardComandoSetFrecuenciaConteo({ productoId, frecuenciaDias });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await setFrecuenciaConteoCasoDeUso(ctx, comando.valor));
  });
}

/** Desde el Hito 4 (H4C-19): permiso → caso de uso (`casos-de-uso/eliminar-frecuencia-conteo.ts`) → `aResultadoAccion`. Sin guard (`SIN_GUARD`: solo recibe un id). */
export async function eliminarFrecuenciaConteo(id: string): Promise<ResultadoAccion> {
  return conPermiso("conteo_frecuencia", async (ctx) => {
    return aResultadoAccion(await eliminarFrecuenciaConteoCasoDeUso(ctx, { id }));
  });
}
