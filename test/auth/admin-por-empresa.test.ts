import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { actualizarActivoMembresia } from "../../src/server/actions/auth/usuarios";

/** ADR-007, A5: "nunca queda la empresa sin ningún admin activo" se cuenta DENTRO de la empresa; el admin de otra empresa no salva a esta. */
describe("último admin activo — por empresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("el admin de OTRA empresa no cuenta: no se puede desactivar al único admin de la propia", async () => {
    const base = await sembrarBase();
    await prisma.empresa.create({ data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
    const sucursalNorte = await prisma.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } });
    const rolNorte = await prisma.rol.create({ data: { nombre: "admin", empresaId: "norte" } });
    const unico = await crearUsuarioConMembresia({ email: "unico@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ajeno = await crearUsuarioConMembresia({ email: "ajeno@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: ajeno.id } });
    await crearMembresia({ usuarioId: ajeno.id, sucursalId: sucursalNorte.id, rolId: rolNorte.id });
    await mockearUsuarioActual({ id: unico.id, email: unico.email, nombre: null });

    const membresia = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: unico.id } });
    const resultado = await actualizarActivoMembresia(membresia.id, false);
    expect(resultado.ok).toBe(false);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);
  });
});
