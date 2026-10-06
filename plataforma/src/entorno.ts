import { z } from "zod";

/**
 * Configuración de la consola de plataforma (ADR-012, ADR-019). NO se confunde con `src/env.ts` (la de la aplicación): la consola es otro proyecto de
 * Vercel con otras variables, y la regla central es que NUNCA cae en `DATABASE_URL`: si falta `PLATAFORMA_DATABASE_URL`, no hay conexión (cerrado por
 * defecto), y si la URL no es del rol `motor2_plataforma` (por ejemplo, la del dueño o la de la aplicación) tampoco.
 *
 * UNA consola, varias instalaciones (ADR-012 §4, ADR-025): `PLATAFORMA_DATABASE_URL` es la instalación PRINCIPAL —en ella viven los administradores, las sesiones y los códigos de ingreso—
 * y cada instalación adicional se declara con una entrada SIN secretos en `PLATAFORMA_INSTALACIONES_ADICIONALES` y su propia variable de conexión `PLATAFORMA_DATABASE_URL_<ID>`
 * (rotar la clave de una base toca una sola variable, y un error de tipeo en el JSON no puede filtrar una clave).
 */
export const ROL_DE_PLATAFORMA = "motor2_plataforma";

function usuarioDeLaUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

/** Dirección pública de la app de empresas: https, o http solo en localhost (desarrollo y E2E). Sin barra final. */
function esUrlDeLaApp(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.search !== "" || u.hash !== "" || u.pathname.replace(/\/+$/, "") !== "") return false;
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

const claveDe32Bytes = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "tiene que ser una clave de 32 bytes en base64 (openssl rand -base64 32)");

/** El id de una instalación va en la URL y en el nombre de su variable de conexión: solo minúsculas y dígitos. */
const ID_DE_INSTALACION = /^[a-z][a-z0-9]{1,29}$/;

const esquema = z.object({
  PLATAFORMA_DATABASE_URL: z.string().min(1).refine((v) => usuarioDeLaUrl(v) === ROL_DE_PLATAFORMA, `tiene que conectar con el rol ${ROL_DE_PLATAFORMA}`),
  // Secreto del servidor con el que se firma el hash de los códigos de ingreso (6 dígitos: sin secreto, la base sola permitiría adivinarlos).
  PLATAFORMA_SECRETO_CODIGOS: z.string().min(32, "tiene que tener al menos 32 caracteres"),
  // Clave con la que se cifra el secreto TOTP de cada administrador en la base.
  PLATAFORMA_CLAVE_TOTP: claveDe32Bytes,
  // A dónde apuntan los enlaces de las invitaciones (E5): la app de empresas de ESTA instalación.
  PLATAFORMA_URL_APP: z.string().refine(esUrlDeLaApp, "tiene que ser la dirección de la app de empresas: https://… (o http://localhost…), sin ruta"),
  // Cómo se llama la instalación principal en las URLs y en el selector (por defecto `principal`).
  PLATAFORMA_INSTALACION_ID: z.string().regex(ID_DE_INSTALACION, "minúsculas y dígitos, 2 a 30 caracteres, empieza con una letra").optional(),
  PLATAFORMA_INSTALACION_NOMBRE: z.string().trim().min(1).max(60).optional(),
  // Las demás instalaciones: un JSON SIN secretos `[{"id":"stockhneuquen","nombre":"Stock Neuquén","urlApp":"https://…"}]`; cada una con su `PLATAFORMA_DATABASE_URL_<ID EN MAYÚSCULAS>`.
  PLATAFORMA_INSTALACIONES_ADICIONALES: z.string().optional(),
});

export type EntornoDePlataforma = z.infer<typeof esquema>;

/** Las variables OBLIGATORIAS de la consola (las opcionales de instalaciones se listan aparte). */
export const CLAVES_DE_ENTORNO_DE_PLATAFORMA: readonly string[] = ["PLATAFORMA_DATABASE_URL", "PLATAFORMA_SECRETO_CODIGOS", "PLATAFORMA_CLAVE_TOTP", "PLATAFORMA_URL_APP"];

/** Las opcionales: nombre e id de la principal y la lista de las adicionales (más una `PLATAFORMA_DATABASE_URL_<ID>` por cada una). */
export const CLAVES_OPCIONALES_DE_ENTORNO_DE_PLATAFORMA: readonly string[] = ["PLATAFORMA_INSTALACION_ID", "PLATAFORMA_INSTALACION_NOMBRE", "PLATAFORMA_INSTALACIONES_ADICIONALES"];

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

// ---- Instalaciones (ADR-025) ----

const ID_DE_LA_INSTALACION_POR_DEFECTO = "principal";
const MAXIMO_DE_INSTALACIONES = 10;

export interface Instalacion {
  id: string;
  nombre: string;
  /** Conexión con el rol `motor2_plataforma`. NUNCA se muestra ni se escribe en un mensaje. */
  databaseUrl: string;
  /** La dirección pública de la app de empresas de ESTA instalación: a ella apuntan los enlaces de los mails. */
  urlApp: string;
  principal: boolean;
}

const entradaAdicional = z
  .object({ id: z.string().regex(ID_DE_INSTALACION), nombre: z.string().trim().min(1).max(60), urlApp: z.string().refine(esUrlDeLaApp) })
  .strict();

/** El nombre de la variable de conexión de una instalación adicional. Se arma SOLO acá, nunca a partir de un dato del pedido. */
export function variableDeConexionDe(id: string): string {
  return `PLATAFORMA_DATABASE_URL_${id.toUpperCase()}`;
}

/** Misma base aunque una URL use el pooler de Neon (`-pooler` en el primer tramo del host): host sin pooler, puerto y nombre de la base. */
function huellaDeBase(url: string): string {
  const u = new URL(url);
  return `${u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "")}:${u.port || "5432"}${u.pathname}`;
}

function falla(problemas: string[]): never {
  throw new Error(`Configuración de la consola de plataforma inválida:\n- ${problemas.join("\n- ")}`);
}

/**
 * Las instalaciones que la consola administra, la principal primero. Falla cerrado ante cualquier incoherencia y los mensajes nombran la variable, nunca el valor
 * (ni el texto del JSON, ni una URL de conexión).
 */
export function leerInstalaciones(source: Record<string, string | undefined>): Instalacion[] {
  const base = leerEntornoDePlataforma(source);
  const idPrincipal = base.PLATAFORMA_INSTALACION_ID ?? ID_DE_LA_INSTALACION_POR_DEFECTO;
  const principal: Instalacion = {
    id: idPrincipal,
    nombre: base.PLATAFORMA_INSTALACION_NOMBRE ?? idPrincipal,
    databaseUrl: base.PLATAFORMA_DATABASE_URL,
    urlApp: base.PLATAFORMA_URL_APP,
    principal: true,
  };
  const crudo = base.PLATAFORMA_INSTALACIONES_ADICIONALES?.trim();
  if (!crudo) return [principal];

  const problemas: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return falla(["PLATAFORMA_INSTALACIONES_ADICIONALES: no es un JSON válido"]);
  }
  const lista = z.array(entradaAdicional).max(MAXIMO_DE_INSTALACIONES - 1).safeParse(json);
  if (!lista.success) {
    return falla(["PLATAFORMA_INSTALACIONES_ADICIONALES: tiene que ser una lista (hasta 9) de {id, nombre, urlApp} y nada más (las conexiones van cada una en su variable PLATAFORMA_DATABASE_URL_<ID>)"]);
  }

  const adicionales: Instalacion[] = lista.data.map((e) => {
    const variable = variableDeConexionDe(e.id);
    const url = source[variable];
    if (!url) problemas.push(`${variable}: falta (la conexión de la instalación «${e.id}»)`);
    else if (usuarioDeLaUrl(url) !== ROL_DE_PLATAFORMA) problemas.push(`${variable}: tiene que conectar con el rol ${ROL_DE_PLATAFORMA}`);
    return { id: e.id, nombre: e.nombre, databaseUrl: url ?? "", urlApp: e.urlApp, principal: false };
  });
  const todas = [principal, ...adicionales];

  const repetidos = (valores: string[]) => valores.some((v, i) => valores.indexOf(v) !== i);
  if (repetidos(todas.map((i) => i.id))) problemas.push("PLATAFORMA_INSTALACIONES_ADICIONALES: hay ids repetidos (o uno igual al de la principal)");
  if (repetidos(todas.map((i) => i.urlApp.replace(/\/+$/, "")))) problemas.push("PLATAFORMA_INSTALACIONES_ADICIONALES: hay direcciones de app repetidas");
  if (problemas.length === 0) {
    let huellas: string[] = [];
    try {
      huellas = todas.map((i) => huellaDeBase(i.databaseUrl));
    } catch {
      problemas.push("alguna PLATAFORMA_DATABASE_URL* no es una URL válida");
    }
    if (huellas.length && repetidos(huellas)) problemas.push("dos instalaciones apuntan a la misma base de datos");
  }
  if (problemas.length) falla(problemas);
  return todas;
}

let instalaciones: Instalacion[] | undefined;

/** Las instalaciones del proceso, validadas al primer uso (no al importar: `next build` no tiene las variables). */
export function instalacionesConfiguradas(): Instalacion[] {
  instalaciones ??= leerInstalaciones(process.env);
  return instalaciones;
}

/** La instalación con ese id exacto, o `null`. Un id desconocido NO cae en la principal: dos instalaciones pueden tener una empresa con el mismo id. */
export function instalacionPorId(lista: readonly Instalacion[], id: string): Instalacion | null {
  return lista.find((i) => i.id === id) ?? null;
}
