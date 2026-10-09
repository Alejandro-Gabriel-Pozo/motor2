import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// Ninguna de las dos refresca la vista (se cuenta `refresh` de Next para fijarlo).
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarStockMinimo, setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";

/**
 * Los textos EXACTOS de las dos mutaciones del stock mínimo, el ORDEN de sus chequeos (el mínimo se valida ANTES de leer el producto; el producto antes que la
 * sección), las filas que quedan (una global y una por sección, sin duplicar) y que ninguna refresca la vista (Hito 4, bloque C, paso H4C-21). `stock-minimo.test.ts`
 * mira la resolución del mínimo y `ok`, pero ningún texto. NO mira la auditoría a propósito: 4.4 (H4C-22) la agrega y este test tiene que seguir dando idéntico.
 * Verde contra el código de antes de la mudanza y después.
 */
describe("stock mínimo: mensajes, orden de los chequeos y filas", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    vi.mocked(refresh).mockClear();
  });

  const filas = async () =>
    (await prisma.stockMinimoProducto.findMany({ orderBy: [{ seccionId: "asc" }] })).map((f) => ({ seccionId: f.seccionId, minimo: Number(f.minimo) }));

  it("fijar: el mínimo inválido gana sobre un producto que no existe; el producto gana sobre la sección; la sección ajena; éxitos global y de sección", async () => {
    expect(await setStockMinimoProducto("cnoexiste000000000000000", -1, "cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "El mínimo no puede ser negativo." });
    expect(await setStockMinimoProducto(mpId, Number.NaN)).toEqual({ ok: false, mensaje: "El mínimo no puede ser negativo." });
    expect(await setStockMinimoProducto(mpId, 2e9)).toEqual({ ok: false, mensaje: "El mínimo no puede superar 1000000000." });
    expect(await setStockMinimoProducto("cnoexiste000000000000000", 5, "cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await sembrarSeccion(norte.id, "Barra Norte");
    expect(await setStockMinimoProducto(mpId, 5, ajena.id)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await filas()).toEqual([]);

    expect(await setStockMinimoProducto(mpId, 5)).toEqual({ ok: true, mensaje: 'Stock mínimo (global) de "Sal" actualizado.' });
    expect(await setStockMinimoProducto(mpId, 7.5, "")).toEqual({ ok: true, mensaje: 'Stock mínimo (global) de "Sal" actualizado.' });
    expect(await setStockMinimoProducto(mpId, 3, seccionId)).toEqual({ ok: true, mensaje: 'Stock mínimo de "Sal" en "Depósito" actualizado.' });
    expect(await setStockMinimoProducto(mpId, 0, seccionId)).toEqual({ ok: true, mensaje: 'Stock mínimo de "Sal" en "Depósito" actualizado.' });
    expect(await filas()).toEqual([
      { seccionId, minimo: 0 },
      { seccionId: null, minimo: 7.5 },
    ]);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("eliminar: la fila de OTRA sucursal no se encuentra (y no se borra); éxito", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await prisma.stockMinimoProducto.create({ data: { sucursalId: norte.id, productoId: mpId, minimo: 1 } });
    expect(await eliminarStockMinimo(ajena.id)).toEqual({ ok: false, mensaje: "No se encontró esa fila de Stock Mínimo." });
    await setStockMinimoProducto(mpId, 5);
    const propia = await prisma.stockMinimoProducto.findFirstOrThrow({ where: { sucursalId } });
    expect(await eliminarStockMinimo(propia.id)).toEqual({ ok: true, mensaje: "Stock mínimo eliminado." });
    expect(await prisma.stockMinimoProducto.count()).toBe(1);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });
});
