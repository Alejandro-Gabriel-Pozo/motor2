import { claveEnCatalogo, moduloDeAccion } from "./acciones";
import { esModuloDelCatalogo, moduloDelCatalogo } from "../modulos/catalogo";

export interface GrupoDeAcciones<T> {
  id: string;
  nombre: string;
  acciones: T[];
}

/** El grupo de las claves que no están en el catálogo de acciones (o cuyo módulo no está en el catálogo de módulos): nunca se pierden ni rompen la pantalla. */
export const GRUPO_OTRAS = "otras";

/**
 * Agrupa las acciones de las matrices de administración («Permisos» y «Capacidades por sucursal») por módulo, en el orden de primera aparición, para plegarlas (Frente 6, paso 3).
 * Robusta ante módulos nuevos: cada acción cae en el grupo de SU módulo según el catálogo, sin lista a mano; una clave desconocida va a «Otras». Toda acción aparece en exactamente un grupo
 * (lo comprueba `test/permisos/agrupar-acciones-por-modulo.test.ts` con el catálogo real). Pura: no toca la base.
 */
export function agruparAccionesPorModulo<T extends { clave: string }>(acciones: readonly T[]): GrupoDeAcciones<T>[] {
  const grupos = new Map<string, GrupoDeAcciones<T>>();
  for (const a of acciones) {
    const modulo = claveEnCatalogo(a.clave) ? moduloDeAccion(a.clave) : null;
    const id = modulo !== null && esModuloDelCatalogo(modulo) ? modulo : GRUPO_OTRAS;
    const grupo = grupos.get(id) ?? { id, nombre: id === GRUPO_OTRAS ? "Otras" : moduloDelCatalogo(id).nombre, acciones: [] };
    grupo.acciones.push(a);
    grupos.set(id, grupo);
  }
  return [...grupos.values()];
}
