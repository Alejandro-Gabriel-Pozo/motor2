import type { Db } from "@/lib/db-tipos";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

export interface DatosDelRol {
  usuario: string;
  superusuario: boolean;
  bypassRls: boolean;
  /** Dueño de alguna tabla de `public`, o miembro del rol que la tiene (`pg_has_role`): con `ENABLE` sin `FORCE`, el dueño también salta el RLS. */
  duenio: boolean;
  /** La conexión ya trae `app.empresa_id`, `app.usuario_id`, `app.invitacion_hash`, `app.sucursales_lectura` o `app.sucursales_escritura` fijados (por `options` del arranque o `ALTER ROLE … SET`): ver `verificarRolDeEjecucion`. */
  contextoPreseteado: boolean;
}

/** Cómo es el rol con el que `db` está conectado (`current_user`), y si la conexión trae un contexto preseteado. */
export async function datosDelRolDeEjecucion(db: Db): Promise<DatosDelRol> {
  const [fila] = await db.$queryRaw<Array<{ usuario: string; superusuario: boolean; bypassrls: boolean; duenio: boolean; preseteado: boolean }>>`
    SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS bypassrls,
           EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND pg_has_role(current_user, tableowner, 'USAGE')) AS duenio,
           (COALESCE(current_setting('app.empresa_id', true), '') <> ''
             OR COALESCE(current_setting('app.usuario_id', true), '') <> ''
             OR COALESCE(current_setting('app.invitacion_hash', true), '') <> ''
             OR COALESCE(current_setting('app.sucursales_lectura', true), '') <> ''
             OR COALESCE(current_setting('app.sucursales_escritura', true), '') <> '') AS preseteado
      FROM pg_roles r WHERE r.rolname = current_user`;
  return { usuario: fila.usuario, superusuario: fila.superusuario, bypassRls: fila.bypassrls, duenio: fila.duenio, contextoPreseteado: fila.preseteado };
}

/** Los nombres de base que son de uso descartable (desarrollo, e2e, demo, benchmark): ninguna tiene datos reales. */
const SUFIJOS_DE_BASE_DESCARTABLE = ["_dev", "_e2e", "_demo", "_bench"];
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Todos los hosts a los que la URL conecta de verdad (M-29 de la auditoría intermedia): el de la URL más los de `host=` y `hostaddr=` de la query (`pg` y libpq dan prioridad a esos sobre el de
 * la URL; admiten listas con comas). Es la MISMA lógica que `hostsDeUnaConexion` de `hosts-de-conexion.ts`, repetida acá a propósito: este archivo lo alcanza la carta pública y la frontera
 * `ALCANCE_CARTA_PUBLICA` de `.dependency-cruiser.cjs` es una lista cerrada de archivos (un archivo nuevo en su alcance es un cambio de frontera, que no se hace por una guarda de host). El test
 * `test/auth/hosts-de-conexion.test.ts` fija que las dos hagan lo mismo.
 */
function hostsDeLaConexion(u: URL): string[] {
  const salida = [u.hostname.toLowerCase()];
  for (const clave of ["host", "hostaddr"]) {
    for (const valor of u.searchParams.getAll(clave)) {
      for (const h of valor.split(",")) if (h.trim()) salida.push(h.trim().toLowerCase());
    }
  }
  return salida;
}

/**
 * ¿La `DATABASE_URL` apunta a una base descartable? Sí si el host es local o el NOMBRE de la base termina en `_dev`, `_e2e`, `_demo` o `_bench`. Sin URL, con una que no se entiende o con
 * otro protocolo: no (falla cerrado). Mira el host y el nombre, no cualquier parte del texto (`?application_name=motor2_dev` no cuenta).
 */
function esBaseDescartable(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return false;
    // Local solo si TODOS los hosts a los que conecta de verdad lo son: `postgresql://u@localhost/x?host=<remoto>` conecta al remoto (M-29).
    if (hostsDeLaConexion(u).every((h) => HOSTS_LOCALES.has(h))) return true;
    const nombre = decodeURIComponent(u.pathname.replace(/^\//, ""));
    return SUFIJOS_DE_BASE_DESCARTABLE.some((sufijo) => nombre.endsWith(sufijo));
  } catch {
    return false;
  }
}

/**
 * ¿Se deja operar con un rol que salta el RLS? Solo con `MOTOR2_ROL_ESTRICTO=0`, FUERA de Vercel (en ningún entorno: ni Producción ni Preview ni Development, S-32; Pureza 0.4, hallazgo
 * H1) y sobre una BASE DESCARTABLE (host local o nombre `_dev`/`_e2e`/`_demo`/`_bench`: `esBaseDescartable` de `DATABASE_URL`). El escape es de las herramientas de demo; un entorno
 * menos confiable (un Preview, que comparte la base de producción, ADR-007) nunca puede ejecutar con el privilegio de uno más confiable. En Vercel el escape se IGNORA aunque la
 * variable llegara a estar puesta (el arranque, además, se niega: `escapesProhibidosEnProduccion` de `src/env.ts`). Defensa en profundidad: una variable mal puesta no puede apagar el
 * aislamiento entre empresas.
 */
export function permitirRolPrivilegiado(source: Record<string, string | undefined>): boolean {
  // Vercel fija `VERCEL=1` y `VERCEL_ENV`; basta que haya cualquiera de las dos (el mismo criterio que `escapesProhibidosEnProduccion` de `src/env.ts`: lo fija el guard `entornos-y-escapes`).
  if (source.MOTOR2_ROL_ESTRICTO !== "0" || source.VERCEL || source.VERCEL_ENV) return false;
  // Tampoco con el entorno estricto pedido (`MOTOR2_ENTORNO_ESTRICTO=1`, un despliegue fuera de Vercel): ahí el aislamiento por empresa no se apaga (auditoría de la Fase 0, 0.4).
  if (source.MOTOR2_ENTORNO_ESTRICTO === "1") return false;
  return esBaseDescartable(source.DATABASE_URL);
}

/**
 * Autochequeo del rol de ejecución (ADR-007 A5, endurecido por ADR-022). Dos negativas:
 *  1. Si el rol salta el RLS (superusuario, BYPASSRLS o dueño de las tablas), el aislamiento por empresa no existe y NO se opera. Desde ADR-022 es siempre así, haya una empresa o
 *     cien: ya no hay «una sola empresa» que lo disculpe. `permitirPrivilegiado` (`MOTOR2_ROL_ESTRICTO=0`) es el escape explícito para herramientas de demo que corren como
 *     dueño sobre una base descartable: no cuenta nada, avisa a Sentry (una vez por arranque) y sigue.
 *  2. Si la conexión trae un contexto preseteado, tampoco, y SIN escape: dejaría a TODOS los pedidos en la empresa preseteada (una puerta trasera que el aislamiento por
 *     pedido no ve). Solo los fixtures de prueba lo hacen, y no pasan por acá.
 * `datos` permite reusar la lectura del rol (no cambia mientras dura el proceso).
 */
export async function verificarRolDeEjecucion(db: Db, datos?: DatosDelRol, permitirPrivilegiado = false): Promise<void> {
  const rol = datos ?? (await datosDelRolDeEjecucion(db));
  if (rol.contextoPreseteado) {
    throw new Error(`La conexión del rol "${rol.usuario}" trae app.empresa_id, app.usuario_id, app.invitacion_hash, app.sucursales_lectura o app.sucursales_escritura fijados antes de cualquier pedido: dejaría a todos los pedidos en una misma empresa o en las mismas sucursales. Quitar ese preset (options del arranque o ALTER ROLE … SET).`);
  }
  if (!rol.superusuario && !rol.bypassRls && !rol.duenio) return;
  const motivo = rol.superusuario ? "es superusuario" : rol.bypassRls ? "tiene BYPASSRLS" : "es dueño de las tablas (o miembro del rol dueño)";
  if (permitirPrivilegiado) {
    await reportarErrorUnaVez("rol-de-ejecucion-privilegiado", new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: se permite por MOTOR2_ROL_ESTRICTO=0 (herramienta de demo), pero no aísla por empresa.`), "rol-de-ejecucion");
    return;
  }
  throw new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: no queda aislado por empresa. Usar el rol motor2_app en DATABASE_URL (MOTOR2_ROL_ESTRICTO=0 solo para herramientas de demo sobre una base descartable).`);
}
