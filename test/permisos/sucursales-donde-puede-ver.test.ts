import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { sucursalesDondeElUsuarioPuedeVer } from "../../src/server/acceso/gate";

/**
 * El gate de una pantalla mira solo la sucursal ACTIVA. Las pantallas que juntan dinero de varias sucursales (/reportes/consolidado y
 * /reportes/rendimiento-recetas/por-sucursal) filtran las suyas con este helper: el rol del usuario en OTRA sucursal puede no tener
 * `reporte_consolidado`, o la Central puede no haberlo habilitado allí.
 */
describe("sucursalesDondeElUsuarioPuedeVer", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("deja solo las sucursales donde el rol de ESA membresía tiene «Ver» en la acción", async () => {
    const base = await sembrarBase();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: norte.id, rolId: base.operador.id } });

    const visibles = await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, norte.id], "reporte_consolidado", prisma);
    expect([...visibles]).toEqual([base.sucursal.id]);
  });

  it("dar «Ver» al rol que tiene en la otra sucursal la suma", async () => {
    const base = await sembrarBase();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: norte.id, rolId: base.operador.id } });
    await prisma.permisoRol.update({
      where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "reporte_salud" } },
      data: { puedeVer: true },
    });

    const visibles = await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, norte.id], "reporte_salud", prisma);
    expect([...visibles].sort()).toEqual([base.sucursal.id, norte.id].sort());
  });

  it("una capacidad que la Central deshabilitó en una sucursal la saca, aunque el rol la tenga", async () => {
    const base = await sembrarBase();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: norte.id, rolId: base.admin.id } });
    await prisma.capacidadSucursal.create({ data: { accionClave: "reporte_consolidado", sucursalId: norte.id, habilitado: false } });

    const visibles = await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, norte.id], "reporte_consolidado", prisma);
    expect([...visibles]).toEqual([base.sucursal.id]);
  });

  it("una sucursal donde el usuario no tiene membresía no aparece nunca", async () => {
    const base = await sembrarBase();
    const ajena = await prisma.sucursal.create({ data: { nombre: "Ajena" } });
    const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });

    const visibles = await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, ajena.id], "reporte_consolidado", prisma);
    expect([...visibles]).toEqual([base.sucursal.id]);
  });
});
