import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta). Esta acción nunca refrescó la vista.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { renombrarOFusionarInsumo } from "../../src/server/actions/catalogo/insumos";

/**
 * `renombrarOFusionarInsumo`: el texto EXACTO de cada camino, el ORDEN de los chequeos y que nunca refresca la vista (Hito 4, bloque 4.3, paso H4C-9). Nació
 * porque la mutación «otro texto del renombre» de la mudanza no la veía ningún test (`insumos.test.ts` mira las filas y `ok`, no los mensajes). A propósito NO
 * mira la auditoría: D-9 (commit aparte) la agrega, y este test tiene que dar idéntico antes y después.
 *
 * Orden fijado: el nombre (vacío, caracteres) gana sobre un id que no existe; el insumo inexistente gana sobre el choque de unidades; el choque de unidades gana
 * sobre la falta de confirmación.
 */
describe("renombrarOFusionarInsumo: mensajes y orden de los chequeos", () => {
  let kgId: string;
  let gId: string;
  let harinaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    harinaId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    vi.mocked(refresh).mockClear();
    await sembrarProductoDisponible({ codigo: "MP_HARINA_A", nombre: "Harina A", tipo: "MP", unidadStockId: kgId, insumoId: harinaId }, base.sucursal.id);
  });

  it("el nombre se valida antes que el insumo, y el insumo inexistente se rechaza", async () => {
    expect(await renombrarOFusionarInsumo("no-existe", "   ")).toEqual({ ok: false, mensaje: "El nombre nuevo no puede estar vacío." });
    expect(await renombrarOFusionarInsumo("no-existe", "-Harina")).toEqual({ ok: false, mensaje: 'El nombre del insumo no puede empezar con "-".' });
    expect(await renombrarOFusionarInsumo("no-existe", "Harina 0000")).toEqual({ ok: false, mensaje: "No se encontró el insumo." });
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("renombre: responde con el nombre recortado y no refresca", async () => {
    expect(await renombrarOFusionarInsumo(harinaId, "  Harina 0000  ")).toEqual({ ok: true, mensaje: 'Insumo renombrado a "Harina 0000".' });
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: harinaId } })).nombre).toBe("Harina 0000");
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });

  it("fusión: el choque de unidades gana sobre la confirmación; sin confirmar se rechaza; confirmada, fusiona sin refrescar", async () => {
    const otro = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    const conG = await prisma.producto.create({ data: { codigo: "MP_HARINA_G", nombre: "Harina en gramos", tipo: "MP", unidadStockId: gId, factorConversion: 1, insumoId: otro.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: (await prisma.sucursal.findFirstOrThrow()).id, productoId: conG.id, disponible: true } });
    expect(await renombrarOFusionarInsumo(harinaId, "harina PREMIUM")).toEqual({
      ok: false,
      mensaje:
        'Este Insumo ya tiene productos disponibles con otra unidad de stock (ej. "Harina en gramos" en g) — todos los productos del mismo Insumo deben compartir la misma unidad de stock.',
    });

    await prisma.producto.update({ where: { id: conG.id }, data: { unidadStockId: kgId } });
    expect(await renombrarOFusionarInsumo(harinaId, "harina PREMIUM")).toEqual({
      ok: false,
      mensaje: 'Ya existe el insumo "Harina premium" — hace falta confirmar la fusión antes de aplicarla.',
    });
    expect(await renombrarOFusionarInsumo(harinaId, "harina PREMIUM", true)).toEqual({ ok: true, mensaje: '"Harina" se fusionó con el insumo existente "Harina premium".' });
    expect(await prisma.insumo.findUnique({ where: { id: harinaId } })).toBeNull();
    expect(await prisma.producto.count({ where: { insumoId: otro.id } })).toBe(2);
    expect(vi.mocked(refresh)).not.toHaveBeenCalled();
  });
});
