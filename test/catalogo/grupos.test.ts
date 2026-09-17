import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearOActualizarGrupo } from "../../src/server/actions/catalogo/insumos";
import { creariaCiclo } from "../../src/core/catalogo/grupo";

describe("árbol de grupos", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("rechaza que un grupo sea su propio padre", async () => {
    await crearOActualizarGrupo("Bebidas", null);
    const bebidas = await prisma.grupo.findFirstOrThrow({ where: { nombre: "Bebidas" } });
    expect(await creariaCiclo(bebidas.id, bebidas.id)).toBe(true);
  });

  it("rechaza un ciclo por cadena de ancestros (A→B→C: C no puede ser padre de A)", async () => {
    await crearOActualizarGrupo("A", null);
    const a = await prisma.grupo.findFirstOrThrow({ where: { nombre: "A" } });
    await crearOActualizarGrupo("B", a.id);
    const b = await prisma.grupo.findFirstOrThrow({ where: { nombre: "B" } });
    await crearOActualizarGrupo("C", b.id);
    const c = await prisma.grupo.findFirstOrThrow({ where: { nombre: "C" } });

    expect(await creariaCiclo(a.id, c.id)).toBe(true);

    const resultado = await crearOActualizarGrupo("A", c.id);
    expect(resultado.ok).toBe(false);
  });

  it("permite un árbol válido sin ciclo", async () => {
    await crearOActualizarGrupo("Bebidas", null);
    const bebidas = await prisma.grupo.findFirstOrThrow({ where: { nombre: "Bebidas" } });
    const resultado = await crearOActualizarGrupo("Bebidas sin alcohol", bebidas.id);
    expect(resultado.ok).toBe(true);
  });
});
