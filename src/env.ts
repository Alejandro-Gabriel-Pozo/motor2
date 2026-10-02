import { z } from "zod";
import { esSlugPublicoValido } from "./core/carta/host";

/**
 * Fase 1.2 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): Zod en env — "el proceso no
 * arranca si falta una variable requerida". Relevado contra el `.env` real y `grep -rhoE "process\.env\.[A-Z0-9_]+" src/` el
 * 2026-09-28 (no contra el ejemplo del checklist, que solo tenía 3 variables y ni `MULTI_TENANT_ENABLED` — que no existe hoy ni
 * tiene propósito definido — ni las reales).
 *
 * A PROPÓSITO no se ejecuta `parseEnv()` a nivel de módulo (nada de `export const env = envSchema.parse(process.env)` corriendo
 * solo con importar este archivo, como sugería el ejemplo del checklist): eso arriesgaría el arranque de dev/build/tests con solo
 * agregar el import en algún lado, sin poder probar antes con cuidado que el schema refleja EXACTAMENTE lo que ya está
 * configurado. `parseEnv()` es una función — quien la llama decide cuándo, y los tests le pasan un `process.env` de prueba en vez
 * de mutar el global. Desde la auditoría de seguridad (S-20) `instrumentation.ts` la conecta al arranque vía
 * `validarEntornoAlArrancar`, y solo en Producción de Vercel (ver abajo): dev, build, tests y e2e no la ejecutan.
 *
 * Requeridas (confirmadas en el `.env` real: sin ellas, Prisma o Auth.js ya fallan hoy, esto solo lo hace explícito y con un
 * mensaje más claro): `DATABASE_URL`/`DIRECT_URL` (Prisma), `AUTH_SECRET`/`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (Auth.js, Google
 * OAuth — único proveedor de login hoy).
 *
 * Opcionales (el proyecto funciona sin ellas, con la feature correspondiente deshabilitada — confirmado en el código real):
 * `ALLOWED_EMAIL_DOMAINS` (`src/core/auth/acceso.ts` — "hoy no hay dominios configurados"), `BOOTSTRAP_ADMIN_EMAILS`
 * (`src/core/auth/bootstrap.ts` — "hoy no hay emails configurados"), `CRON_SECRET` (protege los crons de IPC/dólar),
 * `CARTA_DOMINIO_BASE` (subdominio de la carta pública), `NEXT_PUBLIC_SENTRY_DSN` (Sentry opcional).
 *
 * Fuera de este schema a propósito: `NODE_ENV`/`NEXT_RUNTIME` (los fija Next.js/Node, nunca el usuario) y
 * `MOTOR2_SIN_DOLAR_AUTOMATICO`/`MOTOR2_E2E_DATABASE_URL` (flags de test/e2e, no configuración de la app en sí).
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),

  ALLOWED_EMAIL_DOMAINS: z.string().min(1).optional(),
  BOOTSTRAP_ADMIN_EMAILS: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),

  // Dominio base del subdominio de la carta (`<empresa>.<dominioBase>`, core/carta/host.ts). Sin configurar, la
  // carta pública solo se sirve por path directo (`/carta-publica/...`), sin subdominio (Fase 6 del plan).
  CARTA_DOMINIO_BASE: z.string().min(1).optional(),
  // Add-on (core/carta/carta-empresa-unica.ts): slug de la empresa cuya carta se sirve en el dominio base, sin su slug en la URL. Requiere CARTA_DOMINIO_BASE.
  CARTA_EMPRESA_UNICA: z.string().refine(esSlugPublicoValido, "no es un slug válido").optional(),

  // URL pública de la app para Auth.js: con https decide la cookie de sesión (`sirvePorHttps`, core/auth/cookie-sesion.ts).
  AUTH_URL: z.string().min(1).optional(),
  // "1" se niega a operar con un rol de base que salta el RLS aunque haya una sola empresa (core/auth/rol-de-ejecucion.ts).
  MOTOR2_ROL_ESTRICTO: z.string().min(1).optional(),
  // "1" aplica el chequeo de producción fuera de Vercel; "0" lo relaja al esquema común (`validarEntornoAlArrancar`).
  MOTOR2_ENTORNO_ESTRICTO: z.string().min(1).optional(),
});

/** Las variables que el schema declara: el test de arquitectura exige que todo `process.env.X` del código esté acá o inventariado. */
export const CLAVES_DE_ENTORNO_DECLARADAS: readonly string[] = Object.keys(envSchema.shape);

export type Env = z.infer<typeof envSchema>;

const schemaDeProduccion = envSchema.extend({
  AUTH_SECRET: z.string().min(32, "debe tener al menos 32 caracteres"),
  CRON_SECRET: z.string().min(1),
});

/**
 * No lee `process.env` por defecto a propósito (ver el docstring del módulo) — quien la llama pasa la fuente explícita.
 * `produccion` agrega lo que solo se exige en un despliegue real: `AUTH_SECRET` de al menos 32 caracteres y `CRON_SECRET` presente.
 */
export function parseEnv(source: Record<string, string | undefined>, produccion = false): Env {
  return (produccion ? schemaDeProduccion : envSchema).parse(source);
}

const entornoEstricto = (source: Record<string, string | undefined>) => source.VERCEL_ENV === "production" || source.MOTOR2_ENTORNO_ESTRICTO === "1";

/**
 * Fail-fast del arranque (`instrumentation.ts`): en un despliegue de Producción de Vercel (`VERCEL_ENV=production`) o con
 * `MOTOR2_ENTORNO_ESTRICTO=1`, el proceso no arranca con una variable requerida ausente. Fuera de eso (local, `next start` del e2e,
 * Preview) no hace nada. El error lista solo los nombres de las variables, nunca sus valores.
 */
export function validarEntornoAlArrancar(source: Record<string, string | undefined> = process.env): void {
  if (!entornoEstricto(source)) return;
  const resultado = (source.MOTOR2_ENTORNO_ESTRICTO === "0" ? envSchema : schemaDeProduccion).safeParse(source);
  if (resultado.success) return;
  const detalle = resultado.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ");
  throw new Error(`Configuración inválida: ${detalle}. El proceso no arranca.`);
}

/**
 * `CARTA_DOMINIO_BASE` se lee en DOS momentos: al compilar (`next.config.ts`: reescrituras, redirecciones y CSP de la carta) y al correr
 * (`proxy.ts`: el 404 del resto en el host de la carta). Si difieren —se cargó la variable después del build, o se cambió sin volver a
 * desplegar— la carta queda a medias (el proxy cree que hay zona de cartas y las reglas compiladas no existen, o al revés), sin ningún error.
 * `compilado` es la copia que `next.config.ts` deja dentro del bundle (`CARTA_DOMINIO_BASE_COMPILADO`); `undefined` = no hay bundle compilado
 * (tests, `next dev`) y no hay nada que comparar. Mismo criterio de entorno estricto que `validarEntornoAlArrancar`.
 */
export function validarDominioCartaAlArrancar(source: Record<string, string | undefined>, compilado: string | undefined): void {
  if (!entornoEstricto(source) || compilado === undefined) return;
  const normalizar = (v: string | undefined) => v?.trim().toLowerCase() ?? "";
  if (normalizar(source.CARTA_DOMINIO_BASE) === normalizar(compilado)) return;
  throw new Error(
    `CARTA_DOMINIO_BASE difiere entre el build (${normalizar(compilado) ? "con valor" : "vacía"}) y el arranque (${normalizar(source.CARTA_DOMINIO_BASE) ? "con valor" : "vacía"}): las reglas de la carta se fijan al compilar. Volvé a desplegar con la variable en el entorno del build. El proceso no arranca.`,
  );
}

/**
 * Lo mismo para el add-on `CARTA_EMPRESA_UNICA` (core/carta/carta-empresa-unica.ts): las reglas y el proxy usan la copia compilada
 * (`CARTA_EMPRESA_UNICA_COMPILADO`); si el arranque ve otro valor, el host del dominio base se serviría distinto de lo compilado.
 */
export function validarEmpresaUnicaAlArrancar(source: Record<string, string | undefined>, compilado: string | undefined): void {
  if (!entornoEstricto(source) || compilado === undefined) return;
  const normalizar = (v: string | undefined) => v?.trim() ?? "";
  if (normalizar(source.CARTA_EMPRESA_UNICA) === normalizar(compilado)) return;
  throw new Error(
    `CARTA_EMPRESA_UNICA difiere entre el build (${normalizar(compilado) ? "con valor" : "vacía"}) y el arranque (${normalizar(source.CARTA_EMPRESA_UNICA) ? "con valor" : "vacía"}): las reglas de la carta se fijan al compilar. Volvé a desplegar con la variable en el entorno del build. El proceso no arranca.`,
  );
}
