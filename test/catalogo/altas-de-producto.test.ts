import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto, darDeAltaProductoRapido } from "../../src/server/actions/catalogo/productos";

/**
 * Las dos altas de producto, en lo que ningún test unitario fijaba (Hito 4, bloque 4.3, paso H4C-12, para que su mudanza a casos de uso tenga red). Verde contra el
 * código de antes de la mudanza y después.
 *  - `darDeAltaProductoRapido` (el alta inline de una MP desde el wizard de compra): ningún test unitario la recorría (solo el e2e del wizard). Fija los textos y
 *    el orden de los rechazos (el nombre antes que la unidad), la fila que crea (MP, factor 1, sin precio, código `MP_` + 6 caracteres del azar), que la deja
 *    disponible en TODAS las sucursales, que un nombre de un producto disponible se rechaza sin distinguir mayúsculas, y que el alta no deja filas de auditoría.
 *  - `darDeAltaProducto`: el texto del código manual repetido (la mutación «otro texto del código repetido» no la veía ningún test).
 */
describe("darDeAltaProducto: código manual repetido", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("un código que ya es de otro producto se rechaza con su texto, sin crear nada", async () => {
    const kgId = (await sembrarCatalogoBase()).kg.id;
    expect((await darDeAltaProducto({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, factorConversion: 1 })).ok).toBe(true);
    expect(await darDeAltaProducto({ codigo: "MP_HARINA", nombre: "Otra harina", tipo: "MP", unidadStockId: kgId, factorConversion: 1 })).toEqual({
      ok: false,
      mensaje: "Ya existe un producto con ese código.",
    });
    expect(await prismaAdmin.producto.count()).toBe(1);
  });
});

describe("darDeAltaProductoRapido", () => {
  let kgId: string;
  let sucursalIds: string[];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const otra = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    sucursalIds = [base.sucursal.id, otra.id].sort();
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("rechaza el nombre (vacío, caracteres) antes que la unidad de stock, sin crear nada", async () => {
    expect(await darDeAltaProductoRapido("   ", "")).toEqual({ ok: false, mensaje: "El nombre no puede estar vacío." });
    expect(await darDeAltaProductoRapido("-Harina", "")).toEqual({ ok: false, mensaje: 'El nombre no puede empezar con "-".' });
    expect(await darDeAltaProductoRapido("Harina", "")).toEqual({ ok: false, mensaje: "La unidad de stock es obligatoria." });
    expect(await prismaAdmin.producto.count()).toBe(0);
  });

  it("crea la MP con factor 1 y código MP_, disponible en todas las sucursales, sin auditoría", async () => {
    const r = await darDeAltaProductoRapido("  Harina 000  ", kgId);
    const p = await prismaAdmin.producto.findFirstOrThrow();
    expect(r).toEqual({ ok: true, mensaje: `Producto "Harina 000" (${p.codigo}) creado.`, id: p.id, nombre: "Harina 000" });
    expect(p.codigo).toMatch(/^MP_[0-9a-f-]{6}$/);
    expect({ tipo: p.tipo, nombre: p.nombre, unidadStockId: p.unidadStockId, factor: Number(p.factorConversion), precio: Number(p.precioVenta), insumoId: p.insumoId, categoriaId: p.categoriaId }).toEqual({
      tipo: "MP",
      nombre: "Harina 000",
      unidadStockId: kgId,
      factor: 1,
      precio: 0,
      insumoId: null,
      categoriaId: null,
    });
    const disponibilidad = await prismaAdmin.disponibilidadProducto.findMany({ where: { productoId: p.id }, orderBy: { sucursalId: "asc" } });
    expect(disponibilidad.map((d) => [d.sucursalId, d.disponible])).toEqual(sucursalIds.map((s) => [s, true]));
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("un producto disponible con el mismo nombre (sin distinguir mayúsculas) se rechaza", async () => {
    expect((await darDeAltaProductoRapido("Harina 000", kgId)).ok).toBe(true);
    expect(await darDeAltaProductoRapido("HARINA 000", kgId)).toEqual({ ok: false, mensaje: 'Ya existe un producto disponible llamado "HARINA 000".' });
    expect(await prismaAdmin.producto.count()).toBe(1);
  });
});
