import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  },
}));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __cookiesDeTest, __limpiarCookiesDeTest, __setCookieDeTestParaEmpresa, __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import { obtenerContextoUsuario } from "../../src/core/auth/contexto";
import { cambiarEmpresaActiva } from "../../src/server/actions/auth/empresa-activa";

/**
 * ADR-007, A4: la empresa activa de la sesión y su selector. Un usuario con pertenencia a DOS empresas ("principal", la de
 * siempre, y "norte") trabaja en una por vez; la cookie de empresa nunca se confía a ciegas.
 */
async function crearEmpresa(id: string, estado: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  return prisma.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
}

/** Una empresa nueva con su sucursal y su rol admin (con más de una empresa el `empresaId` de las tablas por empresa va explícito). */
async function empresaConSucursal(id: string, estado: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  await crearEmpresa(id, estado);
  const sucursal = await prisma.sucursal.create({ data: { nombre: `Sucursal ${id}`, empresaId: id } });
  const rolAdmin = await prisma.rol.create({ data: { nombre: "admin", empresaId: id } });
  return { sucursal, rolAdmin };
}

describe("obtenerContextoUsuario — empresa activa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __limpiarCookiesDeTest();
  });

  it("con una sola empresa el contexto la trae y no hay nada que elegir (empresas de largo 1)", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(base.sucursal.empresaId);
    expect(ctx?.empresaSlug).toBe("principal");
    expect(ctx?.empresas).toHaveLength(1);
    expect(ctx?.rolEmpresa).toBeNull();
  });

  it("con dos empresas y sin cookie usa la más antigua; sucursal y membresías son solo de esa empresa", async () => {
    const base = await sembrarBase();
    const norte = await empresaConSucursal("norte");
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rolAdmin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(base.sucursal.empresaId);
    expect(ctx?.sucursalId).toBe(base.sucursal.id);
    expect(ctx?.membresias.map((m) => m.sucursalId)).toEqual([base.sucursal.id]);
    expect(ctx?.empresas.map((e) => e.empresaSlug).sort()).toEqual(["norte", "principal"]);
  });

  it("la cookie de empresa cambia la empresa activa y con ella la sucursal (la cookie de sucursal de la otra empresa se ignora)", async () => {
    const base = await sembrarBase();
    const norte = await empresaConSucursal("norte");
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rolAdmin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaEmpresa("norte");
    __setCookieDeTestParaSucursal(base.sucursal.id); // sucursal de la OTRA empresa: no vale en "norte"
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe("norte");
    expect(ctx?.empresaSlug).toBe("norte");
    expect(ctx?.sucursalId).toBe(norte.sucursal.id);
    expect(ctx?.rolNombre).toBe("admin");
    expect(ctx?.membresias.map((m) => m.sucursalId)).toEqual([norte.sucursal.id]);
  });

  it("una cookie de empresa a la que el usuario NO pertenece se ignora — nunca se confía a ciegas", async () => {
    const base = await sembrarBase();
    await empresaConSucursal("ajena");
    const usuario = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaEmpresa("ajena");
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(base.sucursal.empresaId);
    expect(ctx?.empresas).toHaveLength(1);
  });

  it("una membresía de sucursal SIN pertenencia a la empresa (UsuarioEmpresa) no da contexto", async () => {
    const base = await sembrarBase();
    const usuario = await prisma.user.create({ data: { email: "sin-empresa@test.com" } });
    await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId: base.sucursal.id, rolId: base.admin.id, activo: true } });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    expect(await obtenerContextoUsuario()).toBeNull();
  });

  it("una pertenencia inactiva, o a una empresa suspendida, no cuenta: ni por defecto ni por cookie", async () => {
    const base = await sembrarBase();
    const suspendida = await empresaConSucursal("suspendida", "SUSPENDED");
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: suspendida.sucursal.id, rolId: suspendida.rolAdmin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaEmpresa("suspendida");
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(base.sucursal.empresaId);
    expect(ctx?.empresas.map((e) => e.empresaId)).toEqual([base.sucursal.empresaId]);

    await prisma.usuarioEmpresa.updateMany({ where: { usuarioId: usuario.id, empresaId: base.sucursal.empresaId }, data: { activo: false } });
    expect(await obtenerContextoUsuario()).toBeNull();
  });

  it("una empresa donde el usuario no tiene ninguna sucursal activa no se ofrece", async () => {
    const base = await sembrarBase();
    const norte = await empresaConSucursal("norte");
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rolAdmin.id, activo: false });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    __setCookieDeTestParaEmpresa("norte");
    const ctx = await obtenerContextoUsuario();
    expect(ctx?.empresaId).toBe(base.sucursal.empresaId);
    expect(ctx?.empresas).toHaveLength(1);
  });

  it("rolEmpresa de la pertenencia llega al contexto", async () => {
    const base = await sembrarBase();
    const usuario = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.usuarioEmpresa.updateMany({ where: { usuarioId: usuario.id }, data: { rolEmpresa: "gerente" } });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    expect((await obtenerContextoUsuario())?.rolEmpresa).toBe("gerente");
  });
});

describe("cambiarEmpresaActiva", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __limpiarCookiesDeTest();
  });

  async function usuarioEnDosEmpresas() {
    const base = await sembrarBase();
    const norte = await empresaConSucursal("norte");
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: norte.sucursal.id, rolId: norte.rolAdmin.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
    return { base, norte, usuario };
  }

  it("a una empresa donde pertenece: guarda la cookie, borra la de sucursal y redirige a /", async () => {
    await usuarioEnDosEmpresas();

    await expect(cambiarEmpresaActiva("norte")).rejects.toThrow("NEXT_REDIRECT:/");
    expect(__cookiesDeTest().escritas.get("empresaActivaId")).toBe("norte");
    expect(__cookiesDeTest().borradas).toContain("sucursalActivaId");
  });

  it("a una empresa donde NO pertenece: no hace nada (no confía en lo que manda el cliente)", async () => {
    await usuarioEnDosEmpresas();
    await empresaConSucursal("ajena");

    await expect(cambiarEmpresaActiva("ajena")).resolves.toBeUndefined();
    expect(__cookiesDeTest().escritas.size).toBe(0);
  });

  it("a una empresa suspendida, o con la pertenencia inactiva: no hace nada", async () => {
    const { usuario } = await usuarioEnDosEmpresas();
    await prisma.empresa.update({ where: { id: "norte" }, data: { estado: "SUSPENDED" } });
    await expect(cambiarEmpresaActiva("norte")).resolves.toBeUndefined();

    await prisma.empresa.update({ where: { id: "norte" }, data: { estado: "ACTIVE" } });
    await prisma.usuarioEmpresa.updateMany({ where: { usuarioId: usuario.id, empresaId: "norte" }, data: { activo: false } });
    await expect(cambiarEmpresaActiva("norte")).resolves.toBeUndefined();
    expect(__cookiesDeTest().escritas.size).toBe(0);
  });

  it("a una empresa donde pertenece pero sin ninguna sucursal activa suya: no hace nada", async () => {
    const { norte } = await usuarioEnDosEmpresas();
    await prisma.usuarioSucursal.updateMany({ where: { sucursalId: norte.sucursal.id }, data: { activo: false } });

    await expect(cambiarEmpresaActiva("norte")).resolves.toBeUndefined();
    expect(__cookiesDeTest().escritas.size).toBe(0);
  });

  it("sin sesión no hace nada", async () => {
    const { getUsuarioActual } = await import("../../src/core/auth/session");
    vi.mocked(getUsuarioActual).mockResolvedValue(null);

    await expect(cambiarEmpresaActiva("norte")).resolves.toBeUndefined();
    expect(__cookiesDeTest().escritas.size).toBe(0);
  });
});
