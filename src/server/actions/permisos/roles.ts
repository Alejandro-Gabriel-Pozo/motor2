"use server";

import { guardComandoCrearRol } from "@/core/features/permisos/rol.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conEdicionDePermisos } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";
import { crearRolCasoDeUso } from "./casos-de-uso/crear-rol";
import { renombrarRolCasoDeUso } from "./casos-de-uso/renombrar-rol";
import { actualizarActivoRolCasoDeUso } from "./casos-de-uso/actualizar-activo-rol";

/**
 * Roles de la empresa. Desde el Hito 3 (Fase I, I.2 de `docs/plan-hito-3-pureza.md`) las tres mutaciones son adaptadores: `conEdicionDePermisos` (la clave
 * más la política de plataforma, ADR-008) → guard de formato si lo hay, DENTRO del envoltorio → su caso de uso (`casos-de-uso/`, que escribe `Rol` por
 * `server/persistencia/permisos/roles.ts` y audita) → `aResultadoAccion`. Llamar a esos casos de uso fuera de `conEdicionDePermisos` rompe el contrato C5
 * (`escrituras-de-permisos-por-politica.test.ts`, modo ii).
 */

export async function listarRoles() {
  const ctx = await requerirVerDeEmpresa("gestion_roles");
  return ctx.db.rol.findMany({ orderBy: { nombre: "asc" } });
}

/** Equivalente de crearRolDesdePanel (Core.js:968-983). El nombre sigue las reglas de `core/permisos/nombres-de-rol` (los de fábrica están reservados). */
export async function crearRol(nombre: string): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_roles", async (ctx) => {
    const comando = guardComandoCrearRol(nombre);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await crearRolCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Cambia el NOMBRE de un rol (G3). Nunca toca la clave: un rol de sistema («admin», «operador») sigue siendo el mismo con otro nombre, porque el
 * código lo reconoce por la clave. Acción propia (`renombrar_rol`, piso administrador). El nombre nuevo no puede estar tomado por otro rol ni ser uno
 * de los reservados de otro rol; el cambio queda en la auditoría con el nombre anterior y el nuevo (`casos-de-uso/renombrar-rol.ts`).
 */
export async function renombrarRol(rolId: string, nombre: string): Promise<ResultadoAccion> {
  return conEdicionDePermisos("renombrar_rol", async (ctx) => aResultadoAccion(await renombrarRolCasoDeUso(ctx, { rolId, nombre })));
}

/**
 * Equivalente de actualizarActivoRol (Core.js:994-1018): dos salvaguardas de gobierno (G2), un rol de sistema no se desactiva y uno con usuarios activos
 * tampoco, leídas y escritas en la misma transacción serializable (`casos-de-uso/actualizar-activo-rol.ts`).
 */
export async function actualizarActivoRol(rolId: string, activo: boolean): Promise<ResultadoAccion> {
  return conEdicionDePermisos("gestion_roles", async (ctx) => aResultadoAccion(await actualizarActivoRolCasoDeUso(ctx, { rolId, activo })));
}
