"use server";

import { guardComandoEliminarSeccionHabitual, guardComandoSeccionHabitual } from "@/core/features/seccion-habitual/seccion-habitual.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { eliminarSeccionHabitualCasoDeUso } from "./casos-de-uso/eliminar-seccion-habitual";
import { setSeccionHabitualCasoDeUso } from "./casos-de-uso/set-seccion-habitual";

/**
 * Sección HABITUAL de un producto de venta en esta sucursal (docs/plan-seccion-habitual-stock-2026-09-25.md, C1/C2): de qué sección
 * de STOCK sale primero lo que consume al cerrar una cuenta del salón. Fila ausente = sin preferencia (el cierre resuelve solo, por
 * vencimiento). Reusa el permiso `stock_minimo` en vez de crear uno nuevo (mismo criterio que la Frecuencia de conteo reusó
 * `proceso_control`): es configuración de stock por sucursal × producto, la misma gente que fija mínimos.
 *
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-20) las dos mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{set-seccion-habitual,eliminar-seccion-habitual}.ts`; escrituras en server/persistencia/stock/seccion-habitual.ts; el formato en
 * core/features/seccion-habitual/seccion-habitual.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. La lectura (H8) sigue acá con su guarda.
 * Ninguna refresca la vista (como antes).
 */

/** Las filas de esta sucursal — solo las que apuntan a una sección ACTIVA de esta sucursal (una desactivada ya no manda, ver el cierre). */
export async function listarSeccionesHabituales(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "stock_seccion_habitual");
  return ctx.db.seccionHabitualProducto.findMany({
    where: { sucursalId, seccion: { sucursalId, activa: true } },
    // S-15 (plan de endurecimiento, T7): solo lo que el panel dibuja (el `Producto` entero llevaba el costo de consignación a quien invoca la acción a mano). Más campos: se AGREGAN acá (GT-3a).
    select: { id: true, productoId: true, seccionId: true, producto: { select: { codigo: true, nombre: true } }, seccion: { select: { nombre: true } } },
    orderBy: [{ producto: { nombre: "asc" } }],
  });
}

/**
 * Alta o reemplazo (una por sucursal × producto). Solo un PV, y solo una sección activa de esta sucursal.
 *
 * Desde el Hito 4 (H4C-20): permiso → formato (`guardComandoSeccionHabitual`, antes `guardSeccionHabitual`) → caso de uso (`casos-de-uso/set-seccion-habitual.ts`) →
 * `aResultadoAccion`.
 */
export async function setSeccionHabitual(productoId: string, seccionId: string): Promise<ResultadoAccion> {
  return conPermiso("stock_seccion_habitual", async (ctx) => {
    const formato = guardComandoSeccionHabitual({ productoId, seccionId });
    if (!formato.ok) return error(formato.mensaje);
    return aResultadoAccion(await setSeccionHabitualCasoDeUso(ctx, formato.valor));
  });
}

/**
 * Quita la preferencia: el producto vuelve a salir de donde haya stock (por vencimiento).
 *
 * Desde el Hito 4 (H4C-20): permiso → formato (`guardComandoEliminarSeccionHabitual`: un id que no es texto es «no encontrada», sin leer, como antes) → caso de uso
 * (`casos-de-uso/eliminar-seccion-habitual.ts`) → `aResultadoAccion`.
 */
export async function eliminarSeccionHabitual(id: string): Promise<ResultadoAccion> {
  return conPermiso("stock_seccion_habitual", async (ctx) => {
    const comando = guardComandoEliminarSeccionHabitual({ id });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await eliminarSeccionHabitualCasoDeUso(ctx, comando.valor));
  });
}
