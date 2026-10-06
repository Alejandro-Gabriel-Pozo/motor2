import type { PrismaClient } from "@prisma/client";

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

/**
 * Detección retroactiva del hallazgo S-01 (solo lectura): hasta el arreglo de `signIn`, con una sesión abierta cualquier otra cuenta de
 * Google se vinculaba al usuario de esa sesión y desde entonces entraba como él. Lista a los usuarios con más de una cuenta de Google, o con
 * una cuenta cuyo email firmado por Google no es el del usuario. El que revisa decide: quitar la cuenta ajena (`Account`) o, si es legítima
 * (la misma persona con dos cuentas), dejarla — el gate de `signIn` ya no la deja entrar mientras el email no coincida.
 */
export async function detectarCuentasDeGoogleSospechosas(db: Pick<PrismaClient, "user">): Promise<CuentaDeGoogleSospechosa[]> {
  const usuarios = await db.user.findMany({
    where: { accounts: { some: { provider: "google" } } },
    select: { id: true, email: true, accounts: { where: { provider: "google" }, select: { providerAccountId: true, id_token: true } } },
    orderBy: { email: "asc" },
  });

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
