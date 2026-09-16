import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/productos";
import { guardarReceta, agregarIngredienteAReceta, actualizarIngredienteDeReceta, obtenerRecetaVigente } from "../../src/server/actions/recetas";

describe("recetas", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let pvId: string;
  let mp1Id: string;
  let mp2Id: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    await darDeAltaProducto({ nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Muzzarella", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    pvId = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } })).id;
    mp1Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina" } })).id;
    mp2Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Muzzarella" } })).id;
  });

  it("crea la v1 y luego una v2 — la v1 sigue existiendo, la vigente es solo v2", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);
    await guardarReceta(pvId, [
      { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
      { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
    ]);

    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
    expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.version).toBe(2);
    // Nunca la unión de v1+v2 — bug real que corrigió construirMapaRecetas_.
    expect(vigente?.ingredientes).toHaveLength(2);
  });

  it("rechaza receta de una MP sin 'se produce'", async () => {
    const resultado = await guardarReceta(mp1Id, [{ insumoProductoId: mp2Id, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un ingrediente que no es MP activa (ej. otro PV)", async () => {
    const resultado = await guardarReceta(pvId, [{ insumoProductoId: pvId, cantidad: 1, unidadId: unidadKgId }]);
    expect(resultado.ok).toBe(false);
  });

  it("agregarIngredienteAReceta preserva los existentes y rechaza duplicado", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);

    const resultado = await agregarIngredienteAReceta(pvId, { insumoProductoId: mp2Id, cantidad: 0.1, unidadId: unidadKgId });
    expect(resultado.ok).toBe(true);

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.ingredientes).toHaveLength(2);

    const duplicado = await agregarIngredienteAReceta(pvId, { insumoProductoId: mp2Id, cantidad: 0.5, unidadId: unidadKgId });
    expect(duplicado.ok).toBe(false);
  });

  it("actualizarIngredienteDeReceta cambia cantidad/unidad de UN ingrediente sin tocar los demás, en una sola versión nueva", async () => {
    await guardarReceta(pvId, [
      { insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId },
      { insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId },
    ]);

    const resultado = await actualizarIngredienteDeReceta(pvId, mp1Id, { cantidad: 0.15, unidadId: unidadGId, mermaPorcentaje: 5 });
    expect(resultado.ok).toBe(true);

    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId } });
    expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]); // un solo cambio = una sola versión nueva, no dos (Quitar + Agregar)

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.ingredientes).toHaveLength(2);
    const editado = vigente!.ingredientes.find((i) => i.insumoProductoId === mp1Id)!;
    expect(Number(editado.cantidad)).toBe(0.15);
    expect(editado.unidadId).toBe(unidadGId);
    expect(Number(editado.mermaPorcentaje)).toBe(5);
    const intacto = vigente!.ingredientes.find((i) => i.insumoProductoId === mp2Id)!;
    expect(Number(intacto.cantidad)).toBe(0.2);
  });

  it("actualizarIngredienteDeReceta rechaza un insumo que no está en la receta vigente", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]);

    const resultado = await actualizarIngredienteDeReceta(pvId, mp2Id, { cantidad: 1, unidadId: unidadKgId });
    expect(resultado.ok).toBe(false);
  });
});
