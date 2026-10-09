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

  /**
   * M-12 (auditoría intermedia): la matriz regenerada de `caracterizacion-del-acceso` elige las claves de las sondas de este helper por POSICIÓN y dejó de probar `carta_promo_activar`,
   * `proceso_venta` y `reporte_consolidado`. Esas tres son las que hoy filtran sucursales de verdad (activar promos, vender, consolidar): acá se prueban POR NOMBRE, sin depender del orden de la lista.
   */
  describe.each(["carta_promo_activar", "proceso_venta", "reporte_consolidado"] as const)("%s (cobertura por nombre, M-12)", (clave) => {
    it("el admin de las dos sucursales la ve en las dos; una capacidad apagada en una la saca; una sucursal sin membresía no aparece nunca", async () => {
      const base = await sembrarBase();
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const ajena = await prisma.sucursal.create({ data: { nombre: "Ajena" } });
      const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
      await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: norte.id, rolId: base.admin.id } });
      const todas = [base.sucursal.id, norte.id, ajena.id];

      expect([...(await sucursalesDondeElUsuarioPuedeVer(usuario.id, todas, clave, prisma))].sort()).toEqual([base.sucursal.id, norte.id].sort());

      await prisma.capacidadSucursal.create({ data: { accionClave: clave, sucursalId: norte.id, habilitado: false } });
      expect([...(await sucursalesDondeElUsuarioPuedeVer(usuario.id, todas, clave, prisma))]).toEqual([base.sucursal.id]);
    });

    it("el rol de la OTRA membresía manda: sin «Ver» allí, la sucursal no aparece", async () => {
      const base = await sembrarBase();
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const usuario = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
      const rolSinVer = await prisma.rol.create({ data: { nombre: "sin-ver" } });
      await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: norte.id, rolId: rolSinVer.id } });

      expect([...(await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, norte.id], clave, prisma))]).toEqual([base.sucursal.id]);
    });
  });

  it("una sucursal donde el usuario no tiene membresía no aparece nunca", async () => {
    const base = await sembrarBase();
    const ajena = await prisma.sucursal.create({ data: { nombre: "Ajena" } });
    const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });

    const visibles = await sucursalesDondeElUsuarioPuedeVer(usuario.id, [base.sucursal.id, ajena.id], "reporte_consolidado", prisma);
    expect([...visibles]).toEqual([base.sucursal.id]);
  });
});
