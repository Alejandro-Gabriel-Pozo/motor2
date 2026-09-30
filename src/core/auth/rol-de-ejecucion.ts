import type { Db } from "@/lib/db-tipos";

export interface DatosDelRol {
  usuario: string;
  superusuario: boolean;
  bypassRls: boolean;
  /** Dueño de alguna tabla de `public`: con `ENABLE` sin `FORCE`, el dueño también salta el RLS. */
  duenio: boolean;
}

/** Cómo es el rol con el que `db` está conectado (`current_user`). */
export async function datosDelRolDeEjecucion(db: Db): Promise<DatosDelRol> {
  const [fila] = await db.$queryRaw<Array<{ usuario: string; superusuario: boolean; bypassrls: boolean; duenio: boolean }>>`
    SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS bypassrls,
           EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS duenio
      FROM pg_roles r WHERE r.rolname = current_user`;
  return { usuario: fila.usuario, superusuario: fila.superusuario, bypassRls: fila.bypassrls, duenio: fila.duenio };
}

/**
 * Autochequeo del rol de ejecución (ADR-007, A5): si `db` se conecta como superusuario, con BYPASSRLS o como dueño de las tablas, el RLS
 * de la Migración 2 no lo frena. Con UNA empresa activa eso no tiene consecuencias (no hay con quién mezclarse) y se tolera; con MÁS de una
 * se niega a operar, en vez de mezclar datos de empresas sin ningún aviso. `datos` permite reusar la lectura del rol (no cambia mientras dura el proceso).
 * `empresasNuevas` suma las que la operación en curso va a dejar activas (`crearEmpresa`: 1): dar de alta una segunda empresa con un rol que salta el RLS es justo lo que se rechaza.
 */
export async function verificarRolDeEjecucion(db: Db, datos?: DatosDelRol, empresasNuevas = 0): Promise<void> {
  const rol = datos ?? (await datosDelRolDeEjecucion(db));
  if (!rol.superusuario && !rol.bypassRls && !rol.duenio) return;
  const empresasActivas = (await db.empresa.count({ where: { estado: "ACTIVE" } })) + empresasNuevas;
  if (empresasActivas <= 1) return;
  const motivo = rol.superusuario ? "es superusuario" : rol.bypassRls ? "tiene BYPASSRLS" : "es dueño de las tablas";
  throw new Error(`El rol de ejecución "${rol.usuario}" ${motivo}: no queda aislado por empresa y hay ${empresasActivas} empresas activas. Usar el rol motor2_app en DATABASE_URL.`);
}
