/**
 * Rol de empresa (`UsuarioEmpresa.rolEmpresa`): la autoridad sobre lo que abarca a TODA la empresa y no a una sola sucursal
 * (usuarios y sus roles, cambios de empresa en la auditoría). Hoy el único rol de empresa documentado es «gerente».
 */
export const ROL_EMPRESA_GERENTE = "gerente";

export function esGerenteDeEmpresa(rolEmpresa: string | null): boolean {
  return rolEmpresa === ROL_EMPRESA_GERENTE;
}
