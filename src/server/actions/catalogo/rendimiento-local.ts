"use server";

import type { OrigenCalibracionInput } from "@/core/catalogo/public";
import { guardComandoFijarRendimientoLocal } from "@/core/features/catalogo/rendimiento-local.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { fijarRendimientoLocalCasoDeUso } from "./casos-de-uso/fijar-rendimiento-local";
import { volverAlRendimientoCentralCasoDeUso } from "./casos-de-uso/volver-al-rendimiento-central";

/**
 * D4 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): calibra el rendimiento (cantidad y/o merma) de UNA línea
 * de receta EN LA SUCURSAL ACTIVA — nunca recibe `sucursalId` por parámetro, siempre `ctx.sucursalId` (elimina de raíz el
 * bug original del reporte, que navegaba al editor CENTRAL con `?sugerido=`). Valida que la línea siga siendo la VIGENTE
 * de su receta (si cambió mientras se miraba el reporte, se rechaza en vez de calibrar una versión vieja). SERIALIZABLE
 * con reintento: si choca con un `guardarReceta` concurrente que arrastra/descarta esta misma línea, una de las dos
 * transacciones pierde la carrera de forma limpia (D3).
 *
 * DECISIÓN DEL DUEÑO (D4): "cantidad" es SIEMPRE el estimado NETO ya congelado (mismo criterio que hoy escribe la
 * receta), y `origen` (si viene de una sugerencia) trae la merma EFECTIVA que se usó para calcularlo — las dos se
 * guardan juntas ("la merma se congela junto con la cantidad").
 *
 * Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-5) es un adaptador fino: permiso (`conPermiso("calibrar_rendimiento_local")`) → formato de los valores y
 * del origen (`guardComandoFijarRendimientoLocal`, core/features/catalogo/rendimiento-local.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/fijar-rendimiento-local.ts`: la transacción serializable, la línea vigente, la escritura en server/persistencia/catalogo/rendimiento-local.ts, la
 * auditoría y el conflicto agotado) → refrescar la vista si salió bien (antes se refrescaba dentro del callback, en ese mismo camino) → `aResultadoAccion`.
 */
export async function fijarRendimientoLocal(
  recetaIngredienteId: string,
  valores: { cantidad: number | null; mermaPorcentaje: number | null },
  origen?: OrigenCalibracionInput
): Promise<ResultadoAccion> {
  return conPermiso("calibrar_rendimiento_local", async (ctx) => {
    const comando = guardComandoFijarRendimientoLocal({ recetaIngredienteId, valores, origen, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarRendimientoLocalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/**
 * D4: "Volver al valor central" — pone los dos campos en `null` (NO borra la fila, mismo criterio append-only del resto del proyecto) y lo audita.
 *
 * Desde el Hito 4 (H4C-5): permiso → caso de uso (`casos-de-uso/volver-al-rendimiento-central.ts`) → refrescar la vista SOLO si hubo cambio
 * (`datos.huboCambio`: si la línea ya usaba el valor central no se refrescaba) → `aResultadoAccion`. Sin guard (`SIN_GUARD`: solo recibe el id).
 */
export async function volverAlRendimientoCentral(recetaIngredienteId: string): Promise<ResultadoAccion> {
  return conPermiso("calibrar_rendimiento_local", async (ctx) => {
    const resultado = await volverAlRendimientoCentralCasoDeUso(ctx, { recetaIngredienteId });
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
