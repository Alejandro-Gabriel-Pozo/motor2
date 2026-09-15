import "server-only";
import { auth } from "@/lib/auth";

export interface UsuarioActual {
  id: string;
  email: string;
  nombre: string | null;
}

/**
 * Único punto que lee la sesión — equivalente directo de
 * `Session.getActiveUser().getEmail()` (Core.js), pero server-only y
 * tipado. Ningún server action / server component debería leer la sesión
 * de otra forma.
 */
export async function getUsuarioActual(): Promise<UsuarioActual | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    nombre: session.user.name ?? null,
  };
}
