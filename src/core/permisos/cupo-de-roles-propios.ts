/**
 * El cupo de roles PROPIOS de una empresa (frente 4, P2; «como pedernal,», 2026-11-16): cuenta solo los roles propios (sin clave de sistema) ACTIVOS; archivar uno libera cupo y reactivarlo vuelve a contarlo; los de
 * sistema («admin», «operador») no cuentan. Puro: sin base. Lo decide el servidor, dentro de la transacción y con el candado de la empresa (`server/persistencia/permisos/roles.ts`).
 * Bajar el tope o nacer en 0 NO desactiva ni edita ningún rol que ya exista: solo impide CREAR y REACTIVAR.
 */
export function hayCupoDeRolPropio(rolesPropiosMax: number, rolesPropiosActivos: number): boolean {
  return Number.isInteger(rolesPropiosMax) && Number.isInteger(rolesPropiosActivos) && rolesPropiosActivos >= 0 && rolesPropiosActivos < rolesPropiosMax;
}
