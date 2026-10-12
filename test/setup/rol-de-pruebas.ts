import { hostsDeUnaConexion } from "../../src/core/auth/hosts-de-conexion";

/**
 * El ROL DE PRUEBAS (M.3-A8, plan `plan-m3-rls-por-sucursal`): con las políticas por sucursal de la Fase B (`TO motor2_app`), un fixture que siembra como `motor2_app` vería solo su alcance. Los
 * fixtures de test siembran, en cambio, con `motor2_app_pruebas` (login, sin superusuario, sin BYPASSRLS, con los mismos privilegios que `motor2_app` y NO miembro de él: las políticas no lo
 * alcanzan), mientras que el código bajo prueba sigue corriendo como `motor2_app` por el camino de la app (`DATABASE_URL`, `baseDeTest`). El rol existe SOLO en bases locales y de CI
 * (`scripts/operaciones/crear-rol-motor2-app.sql`); ningún archivo de `src/` ni script pensado para Neon lo nombra (`test/arquitectura/rol-de-pruebas-solo-local.test.ts`).
 *
 * Este módulo es PURO (no abre conexiones): decide con qué URL siembran los fixtures. Sin la variable cae a la URL de la app (el comportamiento de siempre) y devuelve un aviso.
 */
export const ROL_DE_PRUEBAS = "motor2_app_pruebas";
/** Vitest: la URL del rol de pruebas sobre la MISMA base que `DATABASE_URL`. */
export const VARIABLE_DE_PRUEBAS = "MOTOR2_PRUEBAS_DATABASE_URL";
/** Playwright: la URL del rol de pruebas sobre la MISMA base `_e2e` que `MOTOR2_E2E_APP_DATABASE_URL` (no se comparte con la de Vitest: un `.env` con la de `motor2_dev` sembraría en la base equivocada). */
export const VARIABLE_DE_PRUEBAS_E2E = "MOTOR2_E2E_PRUEBAS_DATABASE_URL";

export interface UrlDeSembrado {
  /** La URL con la que siembran los fixtures. */
  url: string;
  /** `true` si es la del rol de pruebas; `false` si cayó a la de la app. */
  conRolDePruebas: boolean;
  /** Qué avisar (una vez) cuando cayó a la de la app; `null` si no hace falta. */
  aviso: string | null;
}

/** El aviso de «falta la variable»: dice qué pasa, por qué importa y qué hacer, sin ninguna URL ni clave. */
export function avisoSinRolDePruebas(variable: string): string {
  return `[tests] ${variable} no está definida: los fixtures siembran con el rol de la app (motor2_app), como hasta ahora. Cuando existan las políticas por sucursal (M.3, Fase B) eso dejará de alcanzar: creá el rol con scripts/operaciones/crear-rol-motor2-app.sql (-v clave_pruebas=…) y definí la variable (ver .env.example).`;
}

/** A dónde conecta de verdad una URL: todos sus hosts (incluidos `?host=`/`?hostaddr=`), el puerto y la base. Para comparar dos URL sin volcar nunca una de ellas a un mensaje (llevan la clave). */
function destinoDe(url: URL): string {
  return `${hostsDeUnaConexion(url).join(",")}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`;
}

/**
 * Con qué URL siembran los fixtures. Sin `urlDePruebas` (ausente o vacía): la de la app, con aviso. Con ella: tiene que ser URL, de usuario EXACTAMENTE `motor2_app_pruebas` y de la MISMA base
 * (hosts, puerto y nombre) que `urlDeLaApp`; si no, LANZA (falla cerrado: sembrar con el dueño saltaría el RLS, y en otra base escribiría donde no se mira). Los mensajes nombran la variable, nunca la URL.
 */
export function resolverUrlDeSembrado(entrada: { urlDePruebas: string | undefined; urlDeLaApp: string | undefined; variable: string }): UrlDeSembrado {
  const { urlDePruebas, urlDeLaApp, variable } = entrada;
  if (!urlDePruebas) return { url: urlDeLaApp ?? "", conRolDePruebas: false, aviso: avisoSinRolDePruebas(variable) };
  let pruebas: URL;
  try {
    pruebas = new URL(urlDePruebas);
  } catch {
    throw new Error(`${variable} no es una URL válida.`);
  }
  if (decodeURIComponent(pruebas.username) !== ROL_DE_PRUEBAS) throw new Error(`${variable} tiene que conectar con el rol ${ROL_DE_PRUEBAS}.`);
  if (!urlDeLaApp) throw new Error(`${variable} está definida pero falta DATABASE_URL para comprobar que apuntan a la misma base.`);
  let app: URL;
  try {
    app = new URL(urlDeLaApp);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.");
  }
  if (destinoDe(pruebas) !== destinoDe(app)) throw new Error(`${variable} tiene que apuntar a la misma base (hosts, puerto y nombre) que DATABASE_URL.`);
  return { url: urlDePruebas, conRolDePruebas: true, aviso: null };
}

/** Lo que usa Vitest: resuelve con el entorno del proceso y, si cae a la app, emite el aviso (una vez por archivo de test: cada archivo carga sus propios módulos). */
export function urlDeSembradoDeVitest(env: Record<string, string | undefined> = process.env): string {
  const r = resolverUrlDeSembrado({ urlDePruebas: env[VARIABLE_DE_PRUEBAS], urlDeLaApp: env.DATABASE_URL, variable: VARIABLE_DE_PRUEBAS });
  if (r.aviso) console.warn(r.aviso);
  return r.url;
}
