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

  it("audita el factor de conversión de la presentación: el alta (anterior null), el cambio y NO un reenvío sin cambio (Pureza 0.7)", async () => {
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 25)).ok).toBe(true);

    const presentacion = await prisma.presentacion.findFirstOrThrow({ where: { productoId, unidadCompraId: unidadGId } });
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "Presentacion", entidadId: presentacion.id }, orderBy: { creadoEn: "asc" } });
    expect(registros.map((r) => [r.campo, r.valorAnterior, r.valorNuevo])).toEqual([
      ["factorConversion", null, "20"],
      ["factorConversion", "20", "25"],
    ]);
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

  it("rechaza un factor de conversión con más decimales de los que admite la unidad de stock del producto (kg admite 2)", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 1.234);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toMatch(/decimales/);
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("rechaza un factor de conversión gigantesco", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 1e15);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toMatch(/grande/);
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
