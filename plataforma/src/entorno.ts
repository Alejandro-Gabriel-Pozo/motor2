import { z } from "zod";

/**
 * Configuración de la consola de plataforma (ADR-012, ADR-019). NO se confunde con `src/env.ts` (la de la aplicación): la consola es otro proyecto de
 * Vercel con otras variables, y la regla central es que NUNCA cae en `DATABASE_URL`: si falta `PLATAFORMA_DATABASE_URL`, no hay conexión (cerrado por
 * defecto), y si la URL no es del rol `motor2_plataforma` (por ejemplo, la del dueño o la de la aplicación) tampoco.
 *
 * Una variable de conexión por instalación: esta consola administra la instalación a la que apunta esa URL.
 */
export const ROL_DE_PLATAFORMA = "motor2_plataforma";

function usuarioDeLaUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

const claveDe32Bytes = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "tiene que ser una clave de 32 bytes en base64 (openssl rand -base64 32)");

const esquema = z.object({
  PLATAFORMA_DATABASE_URL: z.string().min(1).refine((v) => usuarioDeLaUrl(v) === ROL_DE_PLATAFORMA, `tiene que conectar con el rol ${ROL_DE_PLATAFORMA}`),
  // Secreto del servidor con el que se firma el hash de los códigos de ingreso (6 dígitos: sin secreto, la base sola permitiría adivinarlos).
  PLATAFORMA_SECRETO_CODIGOS: z.string().min(32, "tiene que tener al menos 32 caracteres"),
  // Clave con la que se cifra el secreto TOTP de cada administrador en la base.
  PLATAFORMA_CLAVE_TOTP: claveDe32Bytes,
});

export type EntornoDePlataforma = z.infer<typeof esquema>;

export const CLAVES_DE_ENTORNO_DE_PLATAFORMA: readonly string[] = Object.keys(esquema.shape);

/** Valida el entorno. Los mensajes dicen QUÉ variable está mal y por qué, nunca su valor. */
export function leerEntornoDePlataforma(source: Record<string, string | undefined>): EntornoDePlataforma {
  const resultado = esquema.safeParse(source);
  if (resultado.success) return resultado.data;
  const problemas = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new Error(`Configuración de la consola de plataforma inválida:\n- ${problemas.join("\n- ")}`);
}

let entorno: EntornoDePlataforma | undefined;

/** El entorno del proceso, validado al primer uso (no al importar: `next build` no tiene las variables). */
export function entornoDePlataforma(): EntornoDePlataforma {
  entorno ??= leerEntornoDePlataforma(process.env);
  return entorno;
}
