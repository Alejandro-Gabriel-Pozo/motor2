import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
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
    const usuario = await prisma.user.create({ data: { email: "dueño@negocio.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prisma.usuarioSucursal.findFirst({
      where: { usuarioId: usuario.id },
      include: { rol: true },
    });
    expect(membresia?.rol.nombre).toBe("admin");
    expect(membresia?.activo).toBe(true);
  });

  it("NO hace nada si el email no está en la allowlist", async () => {
    await sembrarBase();
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prisma.user.create({ data: { email: "otro@gmail.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prisma.usuarioSucursal.findFirst({ where: { usuarioId: usuario.id } });
    expect(membresia).toBeNull();
  });

  it("NO hace nada si ya existe un admin activo — la allowlist deja de tener efecto", async () => {
    const { admin, sucursal } = await sembrarBase();
    await crearUsuarioConMembresia({ email: "admin-existente@negocio.com", sucursalId: sucursal.id, rolId: admin.id });

    process.env.BOOTSTRAP_ADMIN_EMAILS = "otro-dueño@negocio.com";
    const usuario = await prisma.user.create({ data: { email: "otro-dueño@negocio.com" } });

    await intentarBootstrapAdmin(usuario.id, usuario.email);

    const membresia = await prisma.usuarioSucursal.findFirst({ where: { usuarioId: usuario.id } });
    expect(membresia).toBeNull();
  });

  it("no revienta si el seed todavía no corrió (sin rol admin ni sucursal)", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = "dueño@negocio.com";
    const usuario = await prisma.user.create({ data: { email: "dueño@negocio.com" } });

    await expect(intentarBootstrapAdmin(usuario.id, usuario.email)).resolves.not.toThrow();
  });
});
