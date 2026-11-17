/**
 * El cupo de roles PROPIOS de una empresa (frente 4, P2; «como pedernal,», 2026-11-16): cuenta solo los roles propios (sin clave de sistema) ACTIVOS; archivar uno libera cupo y reactivarlo vuelve a contarlo; los de
 * sistema («admin», «operador») no cuentan. Puro: sin base. Lo decide el servidor, dentro de la transacción y con el candado de la empresa (`server/persistencia/permisos/roles.ts`).
 * Bajar el tope o nacer en 0 NO desactiva ni edita ningún rol que ya exista: solo impide CREAR y REACTIVAR.
 */
export function hayCupoDeRolPropio(rolesPropiosMax: number, rolesPropiosActivos: number): boolean {
  return Number.isInteger(rolesPropiosMax) && Number.isInteger(rolesPropiosActivos) && rolesPropiosActivos >= 0 && rolesPropiosActivos < rolesPropiosMax;
}

/** Un rol PROPIO es el que no tiene clave de sistema (los de sistema, «admin» y «operador», la tienen). La clave de un rol se lee solo desde `core/permisos` (regla 4 de `acceso-solo-por-el-guard`). */
export function esRolPropio(rol: { clave: string | null }): boolean {
  return rol.clave === null;
}

/** El filtro de los roles propios ACTIVOS (los que cuentan para el cupo), para la consulta de la persistencia. */
export const FILTRO_DE_ROLES_PROPIOS_ACTIVOS = { clave: null, activo: true } as const;

