import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";
import { aceptarInvitacionDeUsuarioCasoDeUso as aceptarInvitacionDeUsuarioDelToken } from "../../src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario";
import { requierePermiso } from "../../src/server/acceso/gate";
import { enviadorEnMemoriaDelCanal } from "../../src/core/correo/enviar";
import { crearSucursalConAdmin } from "../../src/server/actions/auth/sucursales";

/**
 * ADR-007, A4: todas las altas de usuario crean la pertenencia a la empresa (`UsuarioEmpresa`) junto con la de la sucursal —
 * `obtenerContextoUsuario` no da contexto a quien tiene solo `UsuarioSucursal`. Y lo que un admin puede elegir (rol, sucursal)
 * es siempre de SU empresa.
 */
describe("altas de usuario — pertenencia a la empresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("agregarOActualizarUsuario a un email NUEVO no crea User ni pertenencias: manda una invitación, y al aceptarla crea el UsuarioEmpresa de la empresa del actor (una segunda alta no lo duplica)", async () => {
    vi.stubEnv("AUTH_URL", "https://app.ejemplo.test");
    const correo = enviadorEnMemoriaDelCanal("avisos");
    correo.vaciar();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    expect((await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id })).ok).toBe(true);
    expect(await prismaAdmin.user.findUnique({ where: { email: "nuevo@test.com" } })).toBeNull();
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: base.sucursal.empresaId, usuario: { email: "nuevo@test.com" } } })).toBe(0);
    expect(correo.enviados).toHaveLength(1);
    const token = /#t=(\S+)/.exec(correo.enviados[0].texto)![1];

    // Una segunda alta (otro rol) mientras la invitación sigue pendiente la actualiza y NO manda otro mail.
    expect((await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).ok).toBe(true);
    expect(correo.enviados).toHaveLength(1);

    const nuevo = await prismaAdmin.user.create({ data: { email: "nuevo@test.com" } });
    expect((await aceptarInvitacionDeUsuarioDelToken({ token, usuario: { id: nuevo.id, email: nuevo.email }, ahora: new Date() }, requierePermiso)).ok).toBe(true);
    const pertenencias = await prismaAdmin.usuarioEmpresa.findMany({ where: { usuarioId: nuevo.id } });
    expect(pertenencias).toHaveLength(1);
    expect(pertenencias[0].empresaId).toBe(base.sucursal.empresaId);
    expect(pertenencias[0].activo).toBe(true);
    vi.unstubAllEnvs();
  });

  it("agregarOActualizarUsuario reactiva una pertenencia a la empresa que estaba inactiva", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: operador.id }, data: { activo: false } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    expect((await agregarOActualizarUsuario({ email: operador.email, sucursalId: base.sucursal.id, rolId: base.operador.id })).ok).toBe(true);
    expect((await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: operador.id } })).activo).toBe(true);
  });

  it("agregarOActualizarUsuario rechaza un rol o una sucursal de OTRA empresa y no deja rastro", async () => {
    const base = await sembrarBase();
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalOtra = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "otra" } });
    const rolOtra = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: "otra" } });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const rolAjeno = await agregarOActualizarUsuario({ email: "x@test.com", sucursalId: base.sucursal.id, rolId: rolOtra.id });
    const sucursalAjena = await agregarOActualizarUsuario({ email: "x@test.com", sucursalId: sucursalOtra.id, rolId: base.operador.id });
    expect(rolAjeno.ok).toBe(false);
    expect(sucursalAjena.ok).toBe(false);
    expect(await prismaAdmin.user.findUnique({ where: { email: "x@test.com" } })).toBeNull();
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { empresaId: "otra" } })).toBe(0);
  });

  it("crearSucursalConAdmin crea la sucursal en la empresa del actor y le da al primer admin su UsuarioEmpresa", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "primer-admin@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id }); // E8: ya es parte de la empresa
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const r = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: "primer-admin@test.com" });
    expect(r.ok).toBe(true);

    const nueva = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Nueva" } });
    expect(nueva.empresaId).toBe(base.sucursal.empresaId);
    const primerAdmin = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "primer-admin@test.com" } });
    const pertenencia = await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuarioId: primerAdmin.id } });
    expect(pertenencia.empresaId).toBe(base.sucursal.empresaId);
  });

  it("crearSucursalConAdmin rechaza a alguien que todavía no es parte de la empresa, explica qué hacer y no deja nada (E8)", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const r = await crearSucursalConAdmin({ nombre: "Nueva", emailPrimerAdmin: "desconocido@test.com" });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("invitá");
    expect(await prismaAdmin.sucursal.findFirst({ where: { nombre: "Nueva" } })).toBeNull();
    expect(await prismaAdmin.user.findUnique({ where: { email: "desconocido@test.com" } })).toBeNull();
  });

  it("crearSucursalConAdmin con un admin que ya pertenece a la empresa no duplica su UsuarioEmpresa", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    expect((await crearSucursalConAdmin({ nombre: "Otra", emailPrimerAdmin: "admin@test.com" })).ok).toBe(true);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuarioId: admin.id } })).toBe(1);
  });
});
