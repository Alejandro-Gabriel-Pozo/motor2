import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { requierePermiso, requierePermisoDeEmpresa, requierePermisoVer, obtenerMiNivelPermiso } from "../../src/core/permisos/gate";

// Especificación migrada desde Tests.js (~testRequierePermiso*/testSucursalTieneCapacidad*)
// — mismos casos borde de negocio, contra el schema Postgres nuevo en vez
// de mocks de Apps Script (ver plan, "Estrategia de testing").

describe("gate de permisos", () => {
  let sucursalId: string;
  let rolAdminId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
  });

  it("admin puede editar una acción admin-only (proceso_ajuste)", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: rolAdminId });
    const resultado = await requierePermiso(admin.id, sucursalId, "proceso_ajuste", prisma);
    expect(resultado.ok).toBe(true);
  });

  it("operador NO puede editar una acción admin-only (proceso_ajuste)", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: rolOperadorId });
    const resultado = await requierePermiso(operador.id, sucursalId, "proceso_ajuste", prisma);
    expect(resultado.ok).toBe(false);
  });

  it("operador SÍ puede editar una acción abierta (proceso_venta)", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador2@test.com", sucursalId, rolId: rolOperadorId });
    const resultado = await requierePermiso(operador.id, sucursalId, "proceso_venta", prisma);
    expect(resultado.ok).toBe(true);
  });

  it("membresía inactiva queda denegada aunque el rol sea admin", async () => {
    const admin = await crearUsuarioConMembresia({
      email: "admin-inactivo@test.com",
      sucursalId,
      rolId: rolAdminId,
      activo: false,
    });
    const resultado = await requierePermiso(admin.id, sucursalId, "proceso_venta", prisma);
    expect(resultado.ok).toBe(false);
  });

  it("rol desactivado queda denegado aunque la membresía siga activa", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin-rol-off@test.com", sucursalId, rolId: rolAdminId });
    await prisma.rol.update({ where: { id: rolAdminId }, data: { activo: false } });
    const resultado = await requierePermiso(admin.id, sucursalId, "proceso_venta", prisma);
    expect(resultado.ok).toBe(false);
  });

  it("capacidad de sucursal deshabilitada bloquea incluso a admin", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin3@test.com", sucursalId, rolId: rolAdminId });
    await prisma.capacidadSucursal.create({
      data: { accionClave: "proceso_venta", sucursalId, habilitado: false },
    });
    const resultado = await requierePermiso(admin.id, sucursalId, "proceso_venta", prisma);
    expect(resultado.ok).toBe(false);
  });

  it("'capacidades_sucursal' nunca puede autobloquearse (auto-protección)", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin4@test.com", sucursalId, rolId: rolAdminId });
    // Intento (inválido en la práctica, la server action lo rechaza) de
    // deshabilitar la propia matriz de capacidades para esta sucursal.
    await prisma.capacidadSucursal.create({
      data: { accionClave: "capacidades_sucursal", sucursalId, habilitado: false },
    });
    const { empresaId } = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
    const resultado = await requierePermisoDeEmpresa(admin.id, empresaId, "capacidades_sucursal", prisma);
    expect(resultado.ok).toBe(true);
  });

  it("sin fila de PermisoRol para el par (rol, acción) → denegado por defecto", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin5@test.com", sucursalId, rolId: rolAdminId });
    await prisma.permisoRol.delete({
      where: { rolId_accionClave: { rolId: rolAdminId, accionClave: "proceso_venta" } },
    });
    const resultado = await requierePermiso(admin.id, sucursalId, "proceso_venta", prisma);
    expect(resultado.ok).toBe(false);
  });

  it("requierePermisoVer respeta puedeVer independientemente de puedeEditar", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador3@test.com", sucursalId, rolId: rolOperadorId });
    // 'reporte_salud' (piso operario): operador no puede editar, pero se le habilita Ver.
    await prisma.permisoRol.update({
      where: { rolId_accionClave: { rolId: rolOperadorId, accionClave: "reporte_salud" } },
      data: { puedeVer: true, puedeEditar: false },
    });
    const ver = await requierePermisoVer(operador.id, sucursalId, "reporte_salud", prisma);
    const editar = await requierePermiso(operador.id, sucursalId, "reporte_salud", prisma);
    expect(ver.ok).toBe(true);
    expect(editar.ok).toBe(false);
  });

  it("obtenerMiNivelPermiso nunca da {editar:true, ver:false}", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin6@test.com", sucursalId, rolId: rolAdminId });
    const nivel = await obtenerMiNivelPermiso(admin.id, sucursalId, "proceso_ajuste", prisma);
    expect(nivel.editar).toBe(true);
    expect(nivel.ver).toBe(true);
  });
});
