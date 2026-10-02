import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`);
  },
  RedirectType: { replace: "replace", push: "push" },
}));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { __cookiesDeTest, __limpiarCookiesDeTest } from "../setup/next-headers-stub";
import { cambiarEmpresaActiva } from "../../src/server/actions/auth/empresa-activa";
import { cambiarSucursalActiva } from "../../src/server/actions/auth/sucursal-activa";

/** S-18: las cookies de empresa y sucursal activas llevan `secure` en producción (y siguen sin él en desarrollo, que corre en http). */
describe("cookies de empresa/sucursal activa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __limpiarCookiesDeTest();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function escenario() {
    const base = await sembrarBase();
    await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalNorte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } });
    const rolNorte = await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: "norte" } });
    const otraSucursal = await prismaAdmin.sucursal.create({ data: { nombre: "Otra", empresaId: base.sucursal.empresaId } });
    const usuario = await crearUsuarioConMembresia({ email: "multi@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: otraSucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalNorte.id, rolId: rolNorte.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
    return { otraSucursal };
  }

  it("en producción: secure, httpOnly y sameSite lax", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { otraSucursal } = await escenario();

    await expect(cambiarEmpresaActiva("norte")).rejects.toThrow("NEXT_REDIRECT");
    expect(__cookiesDeTest().opciones.get("empresaActivaId")).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });

    __limpiarCookiesDeTest();
    await expect(cambiarSucursalActiva(otraSucursal.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(__cookiesDeTest().opciones.get("sucursalActivaId")).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
  });

  it("fuera de producción: sin secure (desarrollo y tests corren en http)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { otraSucursal } = await escenario();

    await expect(cambiarEmpresaActiva("norte")).rejects.toThrow("NEXT_REDIRECT");
    expect(__cookiesDeTest().opciones.get("empresaActivaId")?.secure).toBe(false);
    __limpiarCookiesDeTest();
    await expect(cambiarSucursalActiva(otraSucursal.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(__cookiesDeTest().opciones.get("sucursalActivaId")?.secure).toBe(false);
  });
});
