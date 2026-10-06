export interface MedicionDePrecargados {
  totalDeUsuarios: number;
  /** Usuarios con al menos una cuenta de Google vinculada: ya entraron alguna vez. */
  conGoogle: number;
  /** Usuarios precargados (los dio de alta un admin por email) que todavía no entraron con Google: los que `allowDangerousEmailAccountLinking` deja entrar. */
  precargadosSinGoogle: number;
  /** De los anteriores, los que no están desactivados a nivel sistema (`activoGlobal`): los que de verdad hay que migrar a invitaciones. */
  precargadosActivosSinGoogle: number;
  /** Emails de los precargados activos sin Google, ordenados (solo se imprimen con `--detalle`). */
  emailsPendientes: string[];
}

/** Un usuario con la cantidad de cuentas de Google vinculadas, tal como lo lee `scripts/lecturas-de-auth.ts` (ordenados por email). */
export interface UsuarioParaMedirPrecargados {
  email: string;
  activoGlobal: boolean;
  cuentasDeGoogle: number;
}

/**
 * Mide cuántos usuarios precargados todavía no entraron con Google. Es el número que dice cuánto cuesta apagar
 * `allowDangerousEmailAccountLinking`: cada uno es un usuario más a pasar a invitaciones antes de apagarlo. Puro: la lectura (solo lectura) es `scripts/lecturas-de-auth.ts`.
 */
export function medirPrecargados(usuarios: readonly UsuarioParaMedirPrecargados[]): MedicionDePrecargados {
  const sinGoogle = usuarios.filter((u) => u.cuentasDeGoogle === 0);
  const activos = sinGoogle.filter((u) => u.activoGlobal);
  return {
    totalDeUsuarios: usuarios.length,
    conGoogle: usuarios.length - sinGoogle.length,
    precargadosSinGoogle: sinGoogle.length,
    precargadosActivosSinGoogle: activos.length,
    emailsPendientes: activos.map((u) => u.email),
  };
}
