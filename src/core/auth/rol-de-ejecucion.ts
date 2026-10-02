import type { Db } from "@/lib/db-tipos";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

export interface DatosDelRol {
  usuario: string;
  superusuario: boolean;
  bypassRls: boolean;
  /** Dueño de alguna tabla de `public`, o miembro del rol que la tiene (`pg_has_role`): con `ENABLE` sin `FORCE`, el dueño también salta el RLS. */
  duenio: boolean;
}

/** Cómo es el rol con el que `db` está conectado (`current_user`). */
export async function datosDelRolDeEjecucion(db: Db): Promise<DatosDelRol> {
  const [fila] = await db.$queryRaw<Array<{ usuario: string; superusuario: boolean; bypassrls: boolean; duenio: boolean }>>`
    SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS bypassrls,
           EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND pg_has_role(current_user, tableowner, 'USAGE')) AS duenio
      FROM pg_roles r WHERE r.rolname = current_user`;
  return { usuario: fila.usuario, superusuario: fila.superusuario, bypassRls: fila.bypassrls, duenio: fila.duenio };
}

/**
 * Autochequeo del rol de ejecución (ADR-007, A5): si `db` se conecta como superusuario, con BYPASSRLS o como dueño de las tablas, el RLS
 * de la Migración 2 no lo frena. Con UNA empresa eso no tiene consecuencias (no hay con quién mezclarse) y se tolera; con MÁS de una
 * se niega a operar, en vez de mezclar datos de empresas sin ningún aviso. Cuentan todas las empresas salvo las que están naciendo
 * (`PROVISIONING`): una suspendida o en baja sigue teniendo sus datos en las tablas. `datos` permite reusar la lectura del rol (no cambia mientras dura el proceso).
 * `empresasNuevas` suma las que la operación en curso va a dejar activas (`crearEmpresa`: 1): dar de alta una segunda empresa con un rol que salta el RLS es justo lo que se rechaza.
 * `estricto` (`MOTOR2_ROL_ESTRICTO=1`) se niega con un rol que salta el RLS aunque haya una sola empresa.
 * Tolerar no es callar: con una sola empresa se avisa (una vez por arranque) a Sentry, porque instalar el rol equivocado en producción no
 * rompe nada a la vista y se descubriría recién al sumar la segunda empresa.
 */
export async function verificarRolDeEjecucion(db: Db, datos?: DatosDelRol, empresasNuevas = 0, estricto = false): Promise<void> {
  const rol = datos ?? (await datosDelRolDeEjecucion(db));
  if (!rol.superusuario && !rol.bypassRls && !rol.duenio) return;
  const motivo = rol.superusuario ? "es superusuario" : rol.bypassRls ? "tiene BYPASSRLS" : "es dueño de las tablas (o miembro del rol dueño)";
  if (estricto) throw new Error(`El rol de ejecución "${rol.usuario}" ${motivo} y MOTOR2_ROL_ESTRICTO=1 exige un rol sin privilegios. Usar el rol motor2_app en DATABASE_URL.`);
  const empresas = (await db.empresa.count({ where: { estado: { not: "PROVISIONING" } } })) + empresasNuevas;
  if (empresas <= 1) {
    await reportarErrorUnaVez("rol-de-ejecucion-privilegiado", new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: se tolera porque hay una sola empresa, pero no aísla por empresa. Usar el rol motor2_app en DATABASE_URL.`), "rol-de-ejecucion");
    return;
  }
  throw new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: no queda aislado por empresa y hay ${empresas} empresas. Usar el rol motor2_app en DATABASE_URL.`);
}
