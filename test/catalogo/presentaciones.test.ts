import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { agregarPresentacionAlternativa, actualizarActivaPresentacion, listarPresentaciones } from "../../src/server/actions/catalogo/productos";

describe("Presentaciones de compra alternativas", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const producto = await prisma.producto.create({
      data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, factorConversion: 1 },
    });
    productoId = producto.id;
  });

  it("listarPresentaciones devuelve vacío cuando el producto no tiene ninguna alternativa cargada (el circuito nunca se abrió)", async () => {
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("agregarPresentacionAlternativa la crea, y listarPresentaciones la refleja", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 20);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const presentaciones = await listarPresentaciones(productoId);
    expect(presentaciones).toHaveLength(1);
    expect(presentaciones[0]).toMatchObject({ unidadCompraId: unidadGId, factorConversion: 20, activa: true });
  });

  it("rechaza agregar la misma unidad que ya es la unidad de compra por defecto del producto", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadKgId, 1);
    expect(resultado.ok).toBe(false);
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("rechaza un factor de conversión que no sea mayor a 0", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 0);
    expect(resultado.ok).toBe(false);
  });

  it("actualizarActivaPresentacion la desactiva sin borrarla — sigue listada, ya no activa", async () => {
    await agregarPresentacionAlternativa(productoId, unidadGId, 20);
    const presentacion = (await listarPresentaciones(productoId))[0];

    const resultado = await actualizarActivaPresentacion(presentacion.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const presentaciones = await listarPresentaciones(productoId);
    expect(presentaciones).toHaveLength(1);
    expect(presentaciones[0].activa).toBe(false);
  });
});
