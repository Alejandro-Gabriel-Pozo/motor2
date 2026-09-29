import { afterAll, describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../setup/test-db";

/**
 * ADR-007 (A0): la app y los tests corren con un rol SIN privilegios (`motor2_app`), distinto del dueño que migra. Si el rol de
 * ejecución fuese superusuario, tuviese BYPASSRLS o fuese dueño de las tablas, la política RLS de la Migración 2 quedaría anulada
 * sin ningún aviso (con `ENABLE` sin `FORCE`, el dueño también la salta). Este test es esa alarma, y sigue valiendo después de A6.
 */
afterAll(() => prismaAdmin.$disconnect());

async function datosDelRol(cliente: typeof prisma) {
  const [rol] = await cliente.$queryRaw<Array<{ usuario: string; superusuario: boolean; bypassrls: boolean }>>`
    SELECT current_user::text AS usuario, r.rolsuper AS superusuario, r.rolbypassrls AS bypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
  const [{ propias, total }] = await cliente.$queryRaw<Array<{ propias: number; total: number }>>`
    SELECT count(*) FILTER (WHERE tableowner = current_user)::int AS propias, count(*)::int AS total
      FROM pg_tables WHERE schemaname = 'public'`;
  return { ...rol, tablasPropias: propias, tablas: total };
}

describe("rol de ejecución (DATABASE_URL)", () => {
  it("no es superusuario, no tiene BYPASSRLS y no es dueño de ninguna tabla", async () => {
    const rol = await datosDelRol(prisma);
    expect(rol.tablas, "la base de tests no tiene tablas (¿faltó migrate deploy?)").toBeGreaterThan(0);
    expect(rol.superusuario, `${rol.usuario} es superusuario: el RLS no lo frenaría`).toBe(false);
    expect(rol.bypassrls, `${rol.usuario} tiene BYPASSRLS: el RLS no lo frenaría`).toBe(false);
    expect(rol.tablasPropias, `${rol.usuario} es dueño de ${rol.tablasPropias} tablas: sin FORCE, el dueño salta el RLS`).toBe(0);
  });

  it("es un rol distinto del dueño que migra (DIRECT_URL), y el dueño sí es dueño de las tablas", async () => {
    const app = await datosDelRol(prisma);
    const dueno = await datosDelRol(prismaAdmin);
    expect(app.usuario).not.toBe(dueno.usuario);
    expect(dueno.tablasPropias).toBe(dueno.tablas);
  });
});
