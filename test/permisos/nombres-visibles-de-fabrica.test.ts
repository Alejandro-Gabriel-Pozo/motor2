import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { sembrarEmpresa } from "../../plataforma/src/servidor/sembrar-empresa";
import { ROLES_DE_FABRICA } from "../../src/core/permisos/roles-de-fabrica";

/**
 * P3 (plan de roles y permisos, «como Pedernal» / «Sí, «Administrador»», dueño 2026-11-16): los roles de fábrica nacen con el nombre visible «administrador» y «empleado», pero su CLAVE sigue siendo
 * «admin» / «operador» (lo que el código compara). Con base real: la siembra de una empresa nueva.
 */
beforeEach(() => limpiarBaseDeTest());
afterAll(() => prismaAdmin.$disconnect());

describe("nombres visibles de los roles de fábrica", () => {
  it("la tabla de fábrica separa el identificador de código del nombre visible", () => {
    expect(ROLES_DE_FABRICA.map((r) => [r.nombre, r.nombreInicial, r.clave])).toEqual([["admin", "administrador", "admin"], ["operador", "empleado", "operador"]]);
  });

  it("sembrar una empresa crea «administrador» (clave admin) y «empleado» (clave operador)", async () => {
    await prismaAdmin.empresa.create({ data: { id: "nueva", nombre: "Nueva", slug: "nueva", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', 'nueva', true)`;
      await sembrarEmpresa(tx, "nueva", "Central");
    });
    const roles = await prismaAdmin.rol.findMany({ where: { empresaId: "nueva" }, orderBy: { clave: "asc" } });
    expect(roles.map((r) => [r.nombre, r.clave])).toEqual([["administrador", "admin"], ["empleado", "operador"]]);
  });
});
