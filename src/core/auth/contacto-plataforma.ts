import { z } from "zod";

/**
 * Email al que escribir cuando una empresa está suspendida (E6, ADR-021): `CONTACTO_PLATAFORMA_EMAIL`, opcional. Sin configurar (o con un valor que no es un email) no se
 * muestra ninguno: la pantalla solo dice que hay que contactar a la plataforma. Nunca se inventa un valor.
 */
export function emailDeContactoDePlataforma(env: Record<string, string | undefined>): string | null {
  const valor = env.CONTACTO_PLATAFORMA_EMAIL?.trim();
  if (!valor) return null;
  return z.email().safeParse(valor).success ? valor : null;
}
