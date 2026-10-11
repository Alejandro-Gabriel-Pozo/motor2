import "server-only";
import { cache } from "react";
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
 *
 * `cache()` de React: dedupea por request — `auth()` valida la sesión
 * contra la tabla `Session` (estrategia database de Auth.js), así que sin
 * esto cada layout/page que llama esta función (y hay muchos: ver
 * `obtenerContextoUsuario`) dispara su propio round-trip a la base para
 * la MISMA sesión dentro del MISMO request. Con Neon (latencia de red +
 * cold start posible), eso se siente como "todo tarda", no solo las
 * pantallas con queries pesadas.
 */
export const getUsuarioActual = cache(async (): Promise<UsuarioActual | null> => {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    nombre: session.user.name ?? null,
  };
});
