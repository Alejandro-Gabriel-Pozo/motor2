import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { emailPuedeIniciarSesion } from "../../src/core/auth/acceso";
import { intentarBootstrapAdmin } from "../../src/core/auth/bootstrap";

/**
 * ADR-007, A6: las lecturas que corren ANTES de tener empresa (login, bootstrap) bajo RLS, con DOS empresas ACTIVE. `UsuarioEmpresa` y
 * `User` no tienen RLS; `UsuarioSucursal` sí y se lee por empresa del usuario, cada una bajo su contexto. Sin esto el login de alguien que
 * solo pertenece a la segunda empresa daría "sin acceso".
 */
afterAll(() => prismaAdmin.$disconnect());

async function empresaNorteConAdmin() {
  await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
  const sucursal = await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } });
  const rol = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: "norte" } });
  return { sucursal, rol };
}

describe("lecturas previas al contexto con dos empresas ACTIVE", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
  });

  it("el gate de login ve la membresía de una empresa que no es la primera", async () => {
    await sembrarBase();
    const norte = await empresaNorteConAdmin();
    const usuario = await prismaAdmin.user.create({ data: { email: "solo-norte@ext.com" } });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rol.id });

    expect(await emailPuedeIniciarSesion("solo-norte@ext.com", undefined)).toBe(true);
  });

  it("no entra si su pertenencia a la empresa está inactiva, o si su membresía de sucursal lo está", async () => {
    await sembrarBase();
    const norte = await empresaNorteConAdmin();
    const usuario = await prismaAdmin.user.create({ data: { email: "baja@ext.com" } });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rol.id });

    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    expect(await emailPuedeIniciarSesion("baja@ext.com", undefined)).toBe(false);

    await prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: usuario.id }, data: { activo: true } });
    await prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: usuario.id }, data: { activo: false } });
    expect(await emailPuedeIniciarSesion("baja@ext.com", undefined)).toBe(false);
  });

  it("un usuario sin ninguna membresía no entra por la vía manual", async () => {
    await sembrarBase();
    await empresaNorteConAdmin();
    await prismaAdmin.user.create({ data: { email: "nadie@ext.com" } });
    expect(await emailPuedeIniciarSesion("nadie@ext.com", undefined)).toBe(false);
  });

  it("el bootstrap con dos empresas activas no adivina empresa: no crea ninguna pertenencia", async () => {
    await sembrarBase();
    await empresaNorteConAdmin();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueno@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueno@negocio.com" } });
    await intentarBootstrapAdmin(usuario.id, usuario.email);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuarioId: usuario.id } })).toBe(0);
    expect(await prisma.usuarioEmpresa.count({ where: { usuarioId: usuario.id } })).toBe(0);
  });
});
