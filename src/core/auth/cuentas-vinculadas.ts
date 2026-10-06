export interface CuentaDeGoogleSospechosa {
  usuarioId: string;
  usuarioEmail: string;
  cuentas: { providerAccountId: string; emailEnLaCuenta: string | null }[];
  /** `varias-cuentas`: el usuario tiene más de una cuenta de Google vinculada. `email-distinto`: alguna cuenta es de otro email que el del usuario. */
  motivos: ("varias-cuentas" | "email-distinto")[];
}

/** Email que Google firmó en el `id_token` guardado al vincular la cuenta (solo se lee: no se verifica la firma, es un dato propio). */
function emailDelIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const carga = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof carga.email === "string" ? carga.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Un usuario con sus cuentas de Google vinculadas, tal como lo lee `scripts/lecturas-de-auth.ts`. */
export interface UsuarioConCuentasDeGoogle {
  id: string;
  email: string;
  accounts: { providerAccountId: string; id_token: string | null }[];
}

/**
 * Detección retroactiva del hallazgo S-01: hasta el arreglo de `signIn`, con una sesión abierta cualquier otra cuenta de
 * Google se vinculaba al usuario de esa sesión y desde entonces entraba como él. Dado cada usuario con sus cuentas de Google, lista a los que tienen más de una,
 * o una cuya email firmada por Google no es la del usuario. El que revisa decide: quitar la cuenta ajena (`Account`) o, si es legítima (la misma persona con dos
 * cuentas), dejarla — el gate de `signIn` ya no la deja entrar mientras el email no coincida. Puro: la lectura (solo lectura) es `scripts/lecturas-de-auth.ts`.
 */
export function clasificarCuentasDeGoogle(usuarios: readonly UsuarioConCuentasDeGoogle[]): CuentaDeGoogleSospechosa[] {
  const sospechosos: CuentaDeGoogleSospechosa[] = [];
  for (const u of usuarios) {
    const cuentas = u.accounts.map((a) => ({ providerAccountId: a.providerAccountId, emailEnLaCuenta: emailDelIdToken(a.id_token) }));
    const emailUsuario = u.email.trim().toLowerCase();
    const motivos: CuentaDeGoogleSospechosa["motivos"] = [];
    if (cuentas.length > 1) motivos.push("varias-cuentas");
    if (cuentas.some((c) => c.emailEnLaCuenta !== null && c.emailEnLaCuenta !== emailUsuario)) motivos.push("email-distinto");
    if (motivos.length) sospechosos.push({ usuarioId: u.id, usuarioEmail: u.email, cuentas, motivos });
  }
  return sospechosos;
}
