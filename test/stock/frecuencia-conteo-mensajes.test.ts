import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// Ninguna de las dos refresca la vista (se cuenta `refresh` de Next para fijarlo).
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarFrecuenciaConteo, setFrecuenciaConteo } from "../../src/server/actions/stock/frecuencia-conteo";

/**
 * Los textos EXACTOS de las dos mutaciones de la agenda de conteo y el ORDEN de sus chequeos (la frecuencia se valida ANTES de leer el producto), y que ninguna
 * refresca la vista (Hito 4, bloque C, paso H4C-19). `frecuencia-conteo-action.test.ts` mira `ok` y las filas, y solo un pedazo de un texto. Verde contra el código
 * de antes de la mudanza y después.
 */
describe("frecuencia de conteo: mensajes y orden de los chequeos", () => {
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    vi.mocked(refresh).mockClear();
  });

  it("fijar: la frecuencia inválida gana sobre un producto que no existe; el tope; no encontrado; éxito con 0 y con N", async () => {
    const NO_ENTERA = "La frecuencia tiene que ser un número entero de días, 0 o más.";
    expect(await setFrecuenciaConteo("cnoexiste000000000000000", -1)).toEqual({ ok: false, mensaje: NO_ENTERA });
    expect(await setFrecuenciaConteo(mpId, 2.5)).toEqual({ ok: false, mensaje: NO_ENTERA });
    expect(await setFrecuenciaConteo(mpId, Number.NaN)).toEqual({ ok: false, mensaje: NO_ENTERA });
    expect(await setFrecuenciaConteo(mpId, 100_001)).toEqual({ ok: false, mensaje: "La frecuencia no puede superar 100000." });
    expect(await setFrecuenciaConteo("cnoexiste000000000000000", 7)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await setFrecuenciaConteo(mpId, 7)).toEqual({ ok: true, mensaje: 'Agenda de conteo de "Sal" fijada cada 7 día(s).' });
    expect(await setFrecuenciaConteo(mpId, 0)).toEqual({ ok: true, mensaje: 'Agenda de conteo de "Sal" desactivada.' });
    expect(await prisma.frecuenciaConteoProducto.findMany({ select: { frecuenciaDias: true } })).toEqual([{ frecuenciaDias: 0 }]);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("eliminar: una fila de OTRA sucursal no se encuentra (y no se borra); éxito", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await prisma.frecuenciaConteoProducto.create({ data: { sucursalId: norte.id, productoId: mpId, frecuenciaDias: 3 } });
    expect(await eliminarFrecuenciaConteo(ajena.id)).toEqual({ ok: false, mensaje: "No se encontró esa fila de Frecuencia de conteo." });
    expect(await prisma.frecuenciaConteoProducto.count()).toBe(1);
    await setFrecuenciaConteo(mpId, 7);
    const propia = await prisma.frecuenciaConteoProducto.findFirstOrThrow({ where: { NOT: { id: ajena.id } } });
    expect(await eliminarFrecuenciaConteo(propia.id)).toEqual({ ok: true, mensaje: "Fila de Frecuencia de conteo eliminada." });
    expect(await prisma.frecuenciaConteoProducto.count()).toBe(1);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });
});
