import { beforeEach, describe, expect, it, vi } from "vitest";

// Todavía no hay ninguna acción de piso gerente en el catálogo: se simula que «unidades» lo es, para probar la regla del gate antes de que exista la primera.
vi.mock("../../src/core/permisos/acciones", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/permisos/acciones")>();
  const orden = { operario: 0, administrador: 1, gerente: 2 } as const;
  const piso = (clave: string) => (clave === "unidades" ? ("gerente" as const) : real.nivelMinimoDeAccion(clave as never));
  return {
    ...real,
    nivelMinimoDeAccion: piso,
    rolAlcanzaLaAccion: (rol: string, clave: string) => orden[real.nivelDeRol(rol)] >= orden[piso(clave)],
  };
});

import {
  accionesDelMenuQueElUsuarioPuedeVer,
  obtenerMiNivelPermisoDeEmpresa,
  requierePermisoDeEmpresa,
  requierePermisoVerDeEmpresa,
} from "../../src/core/permisos/gate";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";

/**
 * Una acción de piso gerente la tiene SOLO quien es gerente de la empresa (`UsuarioEmpresa.rolEmpresa`): ningún rol de sucursal la alcanza, ni el
 * «admin», por más que la matriz tenga la fila. El gerente la tiene sin matriz.
 */
describe("el gate y una acción de piso gerente", () => {
  let sucursalId: string;
  let adminId: string;
  let gerenteId: string;
  let mozoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const mozoRol = await prisma.rol.create({ data: { nombre: "mozo" } });
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    gerenteId = (await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId, rolId: base.admin.id })).id;
    mozoId = (await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId, rolId: mozoRol.id })).id;
    await prismaAdmin.usuarioEmpresa.update({
      where: { usuarioId_empresaId: { usuarioId: gerenteId, empresaId: EMPRESA_POR_DEFECTO_ID } },
      data: { rolEmpresa: "gerente" },
    });
    // La matriz le da la acción a todos los roles, como un dato viejo o un descuido: el piso manda.
    for (const rolId of [base.admin.id, mozoRol.id]) {
      await prisma.permisoRol.upsert({
        where: { rolId_accionClave: { rolId, accionClave: "unidades" } },
        update: { puedeVer: true, puedeEditar: true },
        create: { rolId, accionClave: "unidades", puedeVer: true, puedeEditar: true },
      });
    }
  });

  it("el gerente la tiene (ver y editar), sin importar la matriz", async () => {
    expect((await requierePermisoDeEmpresa(gerenteId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(true);
    expect((await requierePermisoVerDeEmpresa(gerenteId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(true);
    expect(await obtenerMiNivelPermisoDeEmpresa(gerenteId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).toEqual({ ver: true, editar: true });
    expect([...(await accionesDelMenuQueElUsuarioPuedeVer(gerenteId, EMPRESA_POR_DEFECTO_ID, sucursalId, ["unidades"], prisma))]).toEqual(["unidades"]);
  });

  it("el admin que NO es gerente no la tiene, aunque su rol tenga la fila", async () => {
    expect((await requierePermisoDeEmpresa(adminId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(false);
    expect((await requierePermisoVerDeEmpresa(adminId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(false);
    expect(await obtenerMiNivelPermisoDeEmpresa(adminId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).toEqual({ ver: false, editar: false });
    expect((await accionesDelMenuQueElUsuarioPuedeVer(adminId, EMPRESA_POR_DEFECTO_ID, sucursalId, ["unidades"], prisma)).size).toBe(0);
  });

  it("un rol personalizado tampoco", async () => {
    expect((await requierePermisoDeEmpresa(mozoId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(false);
  });

  it("un gerente cuya membresía de sucursal está inactiva no la tiene (sin acceso a la empresa)", async () => {
    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: gerenteId }, data: { activo: false } });
    expect((await requierePermisoDeEmpresa(gerenteId, EMPRESA_POR_DEFECTO_ID, "unidades", prisma)).ok).toBe(false);
  });
});
