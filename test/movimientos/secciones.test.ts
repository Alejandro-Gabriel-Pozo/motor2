import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSeccion, actualizarActivaSeccion, listarSeccionesActivas } from "../../src/server/actions/secciones";

describe("Secciones", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("crea una sección y la lista entre las activas", async () => {
    const resultado = await crearSeccion("Depósito Central");
    expect(resultado.ok).toBe(true);

    const activas = await listarSeccionesActivas(sucursalId);
    expect(activas.map((s) => s.nombre)).toContain("Depósito Central");
  });

  it("rechaza un nombre duplicado, ignorando mayúsculas/espacios", async () => {
    await crearSeccion("Barra");
    const resultado = await crearSeccion("  barra  ");
    expect(resultado.ok).toBe(false);
  });

  it("desactivar una sección la saca de listarSeccionesActivas sin borrarla", async () => {
    const creada = await crearSeccion("Cocina");
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;

    await actualizarActivaSeccion(creada.id, false);
    const activas = await listarSeccionesActivas(sucursalId);
    expect(activas.map((s) => s.nombre)).not.toContain("Cocina");
  });
});
