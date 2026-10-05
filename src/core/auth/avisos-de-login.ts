/**
 * Los avisos que el login muestra cuando `signIn` redirige a `/login?aviso=<codigo>` (E8, ADR-024). El código viene de la URL, así que solo se muestra TEXTO FIJO por código:
 * un código desconocido no muestra nada, y nunca se refleja texto de la URL.
 */
const AVISOS: Readonly<Record<string, string>> = {
  "falta-invitacion":
    "Tu usuario existe, pero esta cuenta de Google todavía no está vinculada. Abrí el enlace de tu invitación (te lo mandó un administrador de tu empresa por mail) o pedí que te lo reenvíen.",
  "cuenta-desactivada":
    "Tu cuenta está desactivada. Si creés que es un error, contactá a la plataforma.",
  "cuenta-distinta":
    "Esta cuenta de Google no es la que tenías vinculada a tu usuario. Por seguridad no se puede vincular otra: avisale a la plataforma para que lo resuelva.",
};

export function textoDeAvisoDeLogin(codigo: string | undefined): string | null {
  return codigo !== undefined && Object.hasOwn(AVISOS, codigo) ? AVISOS[codigo] : null;
}
