import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { actualizarDisponibilidadProducto, actualizarProducto, sincronizarPrecioGrupoCarta } from "../../src/server/actions/catalogo/productos";

/**
 * La carta pública se cachea 5 minutos (ISR). Lo que ella muestra (nombre, precio, disponibilidad de un producto) también se cambia desde
 * el catálogo: esas acciones tienen que invalidar el caché al instante, igual que las del módulo carta, o un producto agotado o con otro
 * precio se sigue ofreciendo hasta 5 minutos.
 */
describe("el catálogo invalida la carta pública al cambiar lo que ella muestra", () => {
  let sucursalId: string;
  let unidadId: string;
  let productoId: string;
  let hermanoId: string;

  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa" } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "RV_1", nombre: "Coca", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidadId }, sucursalId)).id;
    hermanoId = (await sembrarProductoDisponible({ codigo: "RV_2", nombre: "Sprite", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidadId }, sucursalId)).id;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [productoId, hermanoId].map((id, orden) => ({ sucursalId, itemAgrupadoCartaId: item.id, productoId: id, orden })) });
  });

  it("actualizarProducto", async () => {
    const r = await actualizarProducto(productoId, { nombre: "Coca", tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta: 1200 });
    expect(r.ok).toBe(true);
    expect(revalidarCartasPublicas).toHaveBeenCalledTimes(1);
  });

  it("sincronizarPrecioGrupoCarta", async () => {
    expect((await sincronizarPrecioGrupoCarta([productoId, hermanoId], 1500)).ok).toBe(true);
    expect(revalidarCartasPublicas).toHaveBeenCalledTimes(1);
  });

  it("actualizarDisponibilidadProducto", async () => {
    expect((await actualizarDisponibilidadProducto(productoId, false)).ok).toBe(true);
    expect(revalidarCartasPublicas).toHaveBeenCalledTimes(1);
  });

  it("una acción que falla no invalida nada", async () => {
    expect((await actualizarDisponibilidadProducto("no-existe", false)).ok).toBe(false);
    expect((await sincronizarPrecioGrupoCarta([], 10)).ok).toBe(false);
    expect(revalidarCartasPublicas).not.toHaveBeenCalled();
  });
});
