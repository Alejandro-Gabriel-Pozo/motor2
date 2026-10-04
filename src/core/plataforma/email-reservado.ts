/**
 * El administrador de plataforma NO es gerente ni usuario de ninguna empresa (ADR-012 §1): su email no puede ser invitado como gerente ni dado de alta
 * como primer admin de una empresa. La comparación es por la forma canónica (sin espacios, en minúsculas), la misma con la que se guardan los emails.
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `true` si `email` es el de algún administrador de plataforma (`emailsDeAdmins` son los que hay en la base de identidad). */
export function esEmailReservadoDeAdminPlataforma(email: string, emailsDeAdmins: Iterable<string>): boolean {
  const buscado = normalizarEmail(email);
  for (const admin of emailsDeAdmins) if (normalizarEmail(admin) === buscado) return true;
  return false;
}

export const MENSAJE_EMAIL_RESERVADO = "Ese email es de un administrador de la plataforma y no puede ser gerente de una empresa. Usá otro.";
