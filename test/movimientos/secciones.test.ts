import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSeccion, actualizarActivaSeccion, renombrarSeccion, listarSeccionesActivas } from "../../src/server/actions/movimientos/secciones";

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

  describe("renombrarSeccion (hallazgo de la auditoría: antes solo se podía elegir el nombre al crearla)", () => {
    it("renombra una sección existente", async () => {
      const creada = await crearSeccion("Depósito Viejo");
      expect(creada.ok).toBe(true);
      if (!creada.ok) return;

      const resultado = await renombrarSeccion(creada.id, "Depósito Nuevo");
      expect(resultado.ok, resultado.mensaje).toBe(true);
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: creada.id } })).nombre).toBe("Depósito Nuevo");
    });

    it("rechaza renombrar a un nombre que ya usa otra sección de la misma sucursal, ignorando mayúsculas", async () => {
      await crearSeccion("Barra");
      const creada = await crearSeccion("Cocina");
      if (!creada.ok) return;

      const resultado = await renombrarSeccion(creada.id, "barra");
      expect(resultado.ok).toBe(false);
      expect((await prisma.seccion.findUniqueOrThrow({ where: { id: creada.id } })).nombre).toBe("Cocina");
    });

    it("el Kardex ya escrito con esa sección sigue siendo válido tras renombrarla (referencia por FK, no por texto)", async () => {
      const creada = await crearSeccion("Depósito A");
      if (!creada.ok) return;
      const seccionId = creada.id;

      await renombrarSeccion(seccionId, "Depósito B");
      const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
      expect(seccion.id).toBe(seccionId);
      expect(seccion.nombre).toBe("Depósito B");
    });
  });
});
