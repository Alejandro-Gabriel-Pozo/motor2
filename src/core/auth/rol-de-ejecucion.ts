import type { Db } from "@/lib/db-tipos";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

export interface DatosDelRol {
  usuario: string;
  superusuario: boolean;
  bypassRls: boolean;
  /** Dueño de alguna tabla de `public`, o miembro del rol que la tiene (`pg_has_role`): con `ENABLE` sin `FORCE`, el dueño también salta el RLS. */
  duenio: boolean;
  /** La conexión ya trae `app.empresa_id`, `app.usuario_id` o `app.invitacion_hash` fijados (por `options` del arranque o `ALTER ROLE … SET`): ver `verificarRolDeEjecucion`. */
  contextoPreseteado: boolean;
}

/** Cómo es el rol con el que `db` está conectado (`current_user`), y si la conexión trae un contexto preseteado. */
export async function datosDelRolDeEjecucion(db: Db): Promise<DatosDelRol> {
  const [fila] = await db.$queryRaw<Array<{ usuario: string; superusuario: boolean; bypassrls: boolean; duenio: boolean; preseteado: boolean }>>`
    SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS bypassrls,
           EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND pg_has_role(current_user, tableowner, 'USAGE')) AS duenio,
           (COALESCE(current_setting('app.empresa_id', true), '') <> ''
             OR COALESCE(current_setting('app.usuario_id', true), '') <> ''
             OR COALESCE(current_setting('app.invitacion_hash', true), '') <> '') AS preseteado
      FROM pg_roles r WHERE r.rolname = current_user`;
  return { usuario: fila.usuario, superusuario: fila.superusuario, bypassRls: fila.bypassrls, duenio: fila.duenio, contextoPreseteado: fila.preseteado };
}

/**
 * ¿Se deja operar con un rol que salta el RLS? Solo con `MOTOR2_ROL_ESTRICTO=0` Y fuera de Producción de Vercel (Pureza 0.4, hallazgo H1): en Producción el escape
 * se IGNORA aunque la variable llegara a estar puesta (el arranque, además, se niega: `escapesProhibidosEnProduccion` de `src/env.ts`). Defensa en profundidad:
 * una variable mal puesta no puede apagar el aislamiento entre empresas.
 */
export function permitirRolPrivilegiado(source: Record<string, string | undefined>): boolean {
  return source.MOTOR2_ROL_ESTRICTO === "0" && source.VERCEL_ENV !== "production";
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
    throw new Error(`La conexión del rol "${rol.usuario}" trae app.empresa_id, app.usuario_id o app.invitacion_hash fijados antes de cualquier pedido: dejaría a todos los pedidos en una misma empresa. Quitar ese preset (options del arranque o ALTER ROLE … SET).`);
  }
  if (!rol.superusuario && !rol.bypassRls && !rol.duenio) return;
  const motivo = rol.superusuario ? "es superusuario" : rol.bypassRls ? "tiene BYPASSRLS" : "es dueño de las tablas (o miembro del rol dueño)";
  if (permitirPrivilegiado) {
    await reportarErrorUnaVez("rol-de-ejecucion-privilegiado", new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: se permite por MOTOR2_ROL_ESTRICTO=0 (herramienta de demo), pero no aísla por empresa.`), "rol-de-ejecucion");
    return;
  }
  throw new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: no queda aislado por empresa. Usar el rol motor2_app en DATABASE_URL (MOTOR2_ROL_ESTRICTO=0 solo para herramientas de demo sobre una base descartable).`);
}
