"use server";

import { guardComandoGuardarMargenObjetivo } from "@/core/features/reportes/margen-objetivo.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { guardarMargenObjetivoCasoDeUso } from "./casos-de-uso/guardar-margen-objetivo";

/**
 * Food cost objetivo (decisión del dueño, 2026-10-01): lo fija SOLO administración, para toda la empresa (`categoriaId` null) o para una categoría
 * (que gana sobre el de la empresa). Vacío borra el objetivo propio: la categoría vuelve al de la empresa y la empresa al de por defecto
 * (`FOOD_COST_OBJETIVO_PCT`). Gate: `margen_objetivo_editar` (empresa). Es lo que el reporte de Costos usa para «Food cost alto» y el precio sugerido.
 *
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-16) es un adaptador fino: permiso → formato
 * (`guardComandoGuardarMargenObjetivo`, core/features/reportes/margen-objetivo.guard.ts, DENTRO del envoltorio: la categoría y el porcentaje) → caso de uso
 * (`casos-de-uso/guardar-margen-objetivo.ts`: la categoría, el objetivo anterior, y crear, cambiar o borrar con su auditoría en una transacción) → refrescar la
 * vista SOLO si hubo cambio (con el mismo valor no refrescaba, como antes) → `aResultadoAccion`. El archivo está en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function guardarMargenObjetivo(categoriaId: string | null, porcentaje: number | string | null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("margen_objetivo_editar", async (ctx) => {
    const comando = guardComandoGuardarMargenObjetivo({ categoriaId, porcentaje });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarMargenObjetivoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
