import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { renombrarOFusionarInsumo, previsualizarFusionInsumo } from "../../src/server/actions/catalogo/insumos";

describe("renombrarOFusionarInsumo", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let insumoAId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoAId = catalogo.insumo.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("renombra sin chocar con ningún insumo existente", async () => {
    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina 0000");
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumoAId } })).nombre).toBe("Harina 0000");
  });

  it("previsualizarFusionInsumo devuelve null cuando el nombre no choca con nada", async () => {
    expect(await previsualizarFusionInsumo(insumoAId, "Un nombre nuevo")).toBeNull();
  });

  it("previsualizarFusionInsumo avisa con qué insumo fusionaría, sin tocar nada", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    expect(await previsualizarFusionInsumo(insumoAId, "Harina premium")).toBe("Harina premium");
    // No tocó nada: sigue existiendo el insumo A con su nombre original.
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumoAId } })).nombre).toBe("Harina");
    expect(await prisma.insumo.count()).toBe(2);
    void insumoB;
  });

  it("exige confirmarFusion=true antes de aplicar la fusión — sin eso, no fusiona ni borra nada", async () => {
    await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium");
    expect(resultado.ok).toBe(false);
    expect(await prisma.insumo.count()).toBe(2);
  });

  it("con confirmarFusion=true, mueve los productos del insumo viejo y lo borra", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    expect(await prisma.insumo.findUnique({ where: { id: insumoAId } })).toBeNull();
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina A" } });
    expect(producto.insumoId).toBe(insumoB.id);
  });

  it("rechaza fusionar si mezclaría unidades de stock distintas bajo el mismo insumo (hallazgo de la auditoría)", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });
    await darDeAltaProducto({ nombre: "Harina B", tipo: "MP", unidadStockId: unidadGId, factorConversion: 1, insumoId: insumoB.id });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok).toBe(false);

    // No se movió nada ni se borró el insumo viejo.
    expect(await prisma.insumo.findUnique({ where: { id: insumoAId } })).not.toBeNull();
    const productoA = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina A" } });
    expect(productoA.insumoId).toBe(insumoAId);
  });

  it("permite fusionar cuando ambos insumos comparten la misma unidad de stock", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });
    await darDeAltaProducto({ nombre: "Harina B", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoB.id });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });
});
