import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { intentarBootstrapAdmin } from "../../src/core/auth/bootstrap";

describe("bootstrap del primer admin", () => {
  const envOriginal = process.env.BOOTSTRAP_ADMIN_EMAILS;

  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  afterEach(() => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = envOriginal;
  });

  it("da de alta admin si el email está en la allowlist y no hay ningún admin todavía", async () => {
    await sembrarBase();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prismaAdmin.usuarioSucursal.findFirst({
      where: { usuarioId: usuario.id },
      include: { rol: true },
    });
    expect(membresia?.rol.nombre).toBe("admin");
    expect(membresia?.activo).toBe(true);
    // ADR-007, A4: con la pertenencia a la empresa — sin ella el admin recién creado no tendría contexto.
    const pertenencia = await prismaAdmin.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id, activo: true } });
    expect(pertenencia?.empresaId).toBe(membresia?.empresaId);
  });

  it("quien crea la empresa (su primer admin) queda como gerente de la empresa", async () => {
    await sembrarBase();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const pertenencia = await prismaAdmin.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id } });
    expect(pertenencia?.rolEmpresa).toBe("gerente");
  });

  it("el bootstrap no pisa un rol de empresa que el usuario ya tuviera cargado", async () => {
    const { sucursal } = await sembrarBase();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId: sucursal.empresaId, rolEmpresa: "auditor", activo: false } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const pertenencia = await prismaAdmin.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id } });
    expect(pertenencia?.rolEmpresa).toBe("auditor");
    expect(pertenencia?.activo).toBe(true);
  });


  it("el chequeo de \"todavía no hay admin\" es por empresa: un admin de otra empresa no bloquea el bootstrap de la primera sucursal", async () => {
    await sembrarBase();
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalOtra = await prismaAdmin.sucursal.create({ data: { nombre: "Otra sucursal", empresaId: "otra" } });
    const rolOtra = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: "otra" } });
    await crearUsuarioConMembresia({ email: "admin-otra@negocio.com", sucursalId: sucursalOtra.id, rolId: rolOtra.id });

    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });
    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prismaAdmin.usuarioSucursal.findFirst({ where: { usuarioId: usuario.id }, include: { sucursal: true } });
    expect(membresia?.sucursal.nombre).toBe("Central");
    expect(membresia?.empresaId).not.toBe("otra");
  });

  it("con DOS empresas activas no adivina a cuál sumar al usuario y no hace nada (ADR-007, A6: corre sin empresa y bajo RLS)", async () => {
    await sembrarBase();
    await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });
    await intentarBootstrapAdmin(usuario.id, usuario.email);

    expect(await prismaAdmin.usuarioSucursal.count({ where: { usuarioId: usuario.id } })).toBe(0);
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuarioId: usuario.id } })).toBe(0);
  });

  it("NO hace nada si el email no está en la allowlist", async () => {
    await sembrarBase();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "otro@gmail.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prismaAdmin.usuarioSucursal.findFirst({ where: { usuarioId: usuario.id } });
    expect(membresia).toBeNull();
  });

  it("NO hace nada si ya existe un admin activo — la allowlist deja de tener efecto", async () => {
    const { admin, sucursal } = await sembrarBase();
    await crearUsuarioConMembresia({ email: "admin-existente@negocio.com", sucursalId: sucursal.id, rolId: admin.id });

    process.env.BOOTSTRAP_ADMIN_EMAILS = "otro-dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "otro-dueño@negocio.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prismaAdmin.usuarioSucursal.findFirst({ where: { usuarioId: usuario.id } });
    expect(membresia).toBeNull();
  });

  it("no revienta si el seed todavía no corrió (sin rol admin ni sucursal)", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prismaAdmin.user.create({ data: { email: "dueño@negocio.com" } });

    await expect(intentarBootstrapAdmin(usuario.id, usuario.email)).resolves.not.toThrow();
  });
});
