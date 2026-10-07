"use server";

import { guardComandoGuardarPermisos, type CambioDeMatriz } from "@/core/features/permisos/matriz.guard";
import { claveEnCatalogo } from "@/core/permisos/acciones";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conEdicionDePermisos } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";
import { guardarPermisosCasoDeUso } from "./casos-de-uso/guardar-permisos";

export async function listarMatrizPermisos() {
  const ctx = await requerirVerDeEmpresa("gestion_permisos");
  const [acciones, roles, permisos] = await Promise.all([
    ctx.db.accion.findMany({ orderBy: { clave: "asc" } }),
    ctx.db.rol.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    ctx.db.permisoRol.findMany(),
  ]);
  return { acciones: acciones.filter((a) => claveEnCatalogo(a.clave)), roles, permisos };
}

/** Un cambio de la matriz (lo que la persona vio y lo que quiere). Vive en `core/features/permisos/matriz.guard.ts` (lo usa también el caso de uso). */
export type CambioPermisoInput = CambioDeMatriz;

/**
 * Guarda TODOS los cambios de la matriz de una vez, o ninguno (modo edición con «Guardar»; decisión 6 de docs/grounding-lista-ver-editar-2026-09-18.md).
 * Reemplaza al guardado instantáneo por clic (`actualizarPermiso`), que dejaba la matriz a medio cambiar si algo fallaba y no avisaba de que otra persona la
 * había modificado.
 *
 * Desde el Hito 3 (Fase I, I.3 de `docs/plan-hito-3-pureza.md`) es un adaptador: `conEdicionDePermisos("gestion_permisos")` (la clave más la política de
 * plataforma, ADR-008) → formato (`guardComandoGuardarPermisos`, DENTRO del envoltorio) → caso de uso (`casos-de-uso/guardar-permisos.ts`: roles y acciones
 * fuera de la transacción a propósito, chequeo optimista contra lo que la persona vio, SERIALIZABLE con reintento, escritura por
 * `server/persistencia/permisos/matriz.ts` y auditoría; agotar los reintentos vuelve como «justo ahora había otro guardado») → `aResultadoAccion`.
 */
export async function guardarPermisos(cambios: CambioPermisoInput[]): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_permisos", async (ctx) => {
    const comando = guardComandoGuardarPermisos(cambios);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await guardarPermisosCasoDeUso(ctx, comando.valor));
  });
}
