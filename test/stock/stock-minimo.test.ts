import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setStockMinimoProducto, eliminarStockMinimo, listarStockMinimo } from "../../src/server/actions/stock/stock-minimo";
import { resolverStockMinimo } from "../../src/core/stock/stock-minimo";

describe("Stock Mínimo", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    mpId = mp.id;
  });

  it("sin ninguna fila cargada, resolverStockMinimo da null (no 0 — son cosas distintas)", async () => {
    expect(await resolverStockMinimo(sucursalId, mpId, seccionId, prisma)).toBeNull();
  });

  it("fija el mínimo global y se resuelve para cualquier sección sin fila propia", async () => {
    await setStockMinimoProducto(mpId, 5);
    expect(await resolverStockMinimo(sucursalId, mpId, seccionId, prisma)).toBe(5);
    expect(await resolverStockMinimo(sucursalId, mpId, null, prisma)).toBe(5);
  });

  it("una fila por sección gana sobre la global", async () => {
    await setStockMinimoProducto(mpId, 5);
    await setStockMinimoProducto(mpId, 20, seccionId);
    expect(await resolverStockMinimo(sucursalId, mpId, seccionId, prisma)).toBe(20);

    const otraSeccion = await sembrarSeccion(sucursalId, "Otra");
    expect(await resolverStockMinimo(sucursalId, mpId, otraSeccion.id, prisma)).toBe(5); // sin fila propia, cae al global
  });

  it("volver a fijar el global actualiza la misma fila (no duplica)", async () => {
    await setStockMinimoProducto(mpId, 5);
    await setStockMinimoProducto(mpId, 8);
    const filas = await listarStockMinimo(sucursalId);
    expect(filas.filter((f) => f.productoId === mpId && f.seccionId === null)).toHaveLength(1);
    expect(Number(filas.find((f) => f.seccionId === null)?.minimo)).toBe(8);
  });

  it("eliminarStockMinimo saca la fila", async () => {
    await setStockMinimoProducto(mpId, 5, seccionId);
    const fila = (await listarStockMinimo(sucursalId)).find((f) => f.seccionId === seccionId)!;

    const resultado = await eliminarStockMinimo(fila.id);
    expect(resultado.ok).toBe(true);
    expect(await resolverStockMinimo(sucursalId, mpId, seccionId, prisma)).toBeNull();
  });
});
