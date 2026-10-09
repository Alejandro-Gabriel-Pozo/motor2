import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// Ninguna de las dos refresca la vista (se cuenta `refresh` de Next para fijarlo).
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarSeccionHabitual, setSeccionHabitual } from "../../src/server/actions/stock/seccion-habitual";

/**
 * El ORDEN de los chequeos de la sección habitual cuando fallan dos cosas a la vez, el id que no es texto al quitarla y que ninguna de las dos refresca la vista
 * (Hito 4, bloque C, paso H4C-20). `seccion-habitual-action.test.ts` fija cada rechazo por separado. Verde contra el código de antes de la mudanza y después.
 */
describe("sección habitual: orden de los rechazos", () => {
  let pizzaId: string;
  let muzzaId: string;
  let cocinaId: string;
  let ajenaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    pizzaId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId)).id;
    muzzaId = (await sembrarProductoDisponible({ codigo: "MP_MUZZA", nombre: "Muzzarella", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    cocinaId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    ajenaId = (await sembrarSeccion(norte.id, "Barra Norte")).id;
    vi.mocked(refresh).mockClear();
  });

  it("fijar: el formato gana sobre todo; el producto (y que sea PV) gana sobre la sección; la sección ajena gana sobre la inactiva", async () => {
    expect(await setSeccionHabitual("cnoexiste000000000000000", "  ")).toEqual({ ok: false, mensaje: "Elegí la sección habitual." });
    expect(await setSeccionHabitual("cnoexiste000000000000000", ajenaId)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await setSeccionHabitual(muzzaId, ajenaId)).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) tiene sección habitual: «Muzzarella» es una materia prima." });
    await prisma.seccion.update({ where: { id: ajenaId }, data: { activa: false } });
    expect(await setSeccionHabitual(pizzaId, ajenaId)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await setSeccionHabitual(` ${pizzaId} `, ` ${cocinaId}`)).toEqual({ ok: true, mensaje: "Sección habitual de «Pizza»: «Cocina»." });
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("quitar: un id que no es texto es «no encontrada» y no borra nada; no refresca", async () => {
    await setSeccionHabitual(pizzaId, cocinaId);
    expect(await eliminarSeccionHabitual(42 as unknown as string)).toEqual({ ok: false, mensaje: "No se encontró esa sección habitual." });
    expect(await eliminarSeccionHabitual("cnoexiste000000000000000")).toEqual({ ok: false, mensaje: "No se encontró esa sección habitual." });
    expect(await prisma.seccionHabitualProducto.count()).toBe(1);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });
});
