import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivaPresentacion, agregarPresentacionAlternativa, asignarInsumoAProducto, sincronizarPrecioGrupoCarta } from "../../src/server/actions/catalogo/productos";

/**
 * Los textos EXACTOS de los caminos de las mutaciones de productos de H4C-11 que ningún test fijaba (Hito 4, bloque 4.3): `productos.test.ts` y
 * `presentaciones.test.ts` miran `ok` y las filas, y la huella de dinero solo los caminos de dinero de las presentaciones. Nació porque la mutación «otro texto de
 * "solo una MP"» de la mudanza de `asignarInsumoAProducto` no la veía ningún test. Fija también el hallazgo conocido de `actualizarActivaPresentacion` (un id que no
 * existe hace lanzar a Prisma: se migró tal cual, se arregla aparte). Verde contra el código de antes de la mudanza y después.
 *
 * H4C-13 suma los rechazos de formato de `sincronizarPrecioGrupoCarta` (el precio que no es un número y la lista vacía, y su orden): la huella de dinero solo
 * fijaba el negativo y «no son del mismo ítem», y la mutación «otro texto del precio que no es un número» no la veía ningún test.
 */
describe("productos: mensajes de asignar insumo y de presentaciones", () => {
  let kgId: string;
  let gId: string;
  let insumoId: string;
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    insumoId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("asignarInsumoAProducto: no encontrado, no es MP, unidad mezclada y éxito", async () => {
    const pv = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId }, sucursalId);
    await sembrarProductoDisponible({ codigo: "MP_HARINA_KG", nombre: "Harina en kg", tipo: "MP", unidadStockId: kgId, insumoId }, sucursalId);
    const enGramos = await sembrarProductoDisponible({ codigo: "MP_HARINA_G", nombre: "Harina en g", tipo: "MP", unidadStockId: gId }, sucursalId);
    const otra = await sembrarProductoDisponible({ codigo: "MP_HARINA_B", nombre: "Harina B", tipo: "MP", unidadStockId: kgId }, sucursalId);

    expect(await asignarInsumoAProducto("no-existe", insumoId)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await asignarInsumoAProducto(pv.id, insumoId)).toEqual({ ok: false, mensaje: "Solo una materia prima (MP) puede tener Insumo asignado." });
    expect(await asignarInsumoAProducto(enGramos.id, insumoId)).toEqual({
      ok: false,
      mensaje:
        'Este Insumo ya tiene productos disponibles con otra unidad de stock (ej. "Harina en kg" en kg) — todos los productos del mismo Insumo deben compartir la misma unidad de stock.',
    });
    expect(await asignarInsumoAProducto(otra.id, insumoId)).toEqual({ ok: true, mensaje: "Insumo asignado." });
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: otra.id } })).insumoId).toBe(insumoId);
  });

  it("agregarPresentacionAlternativa: no encontrado y la unidad de compra por defecto", async () => {
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, unidadCompraId: kgId }, sucursalId);
    expect(await agregarPresentacionAlternativa("no-existe", gId, 1)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
    expect(await agregarPresentacionAlternativa(harina.id, kgId, 1)).toEqual({ ok: false, mensaje: "Esa ya es la unidad de compra por defecto de este producto." });
    expect(await prisma.presentacion.count()).toBe(0);
  });

  it("actualizarActivaPresentacion: activa y desactiva; un id que no existe hace lanzar a Prisma (hallazgo conocido)", async () => {
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, unidadCompraId: kgId }, sucursalId);
    const p = await prisma.presentacion.create({ data: { productoId: harina.id, unidadCompraId: gId, factorConversion: 1 } });
    expect(await actualizarActivaPresentacion(p.id, false)).toEqual({ ok: true, mensaje: "Presentación desactivada." });
    expect(await actualizarActivaPresentacion(p.id, true)).toEqual({ ok: true, mensaje: "Presentación activada." });
    await expect(actualizarActivaPresentacion("no-existe", true)).rejects.toThrow();
  });

  it("sincronizarPrecioGrupoCarta: el precio se valida antes que la lista, y la lista vacía se rechaza", async () => {
    expect(await sincronizarPrecioGrupoCarta([], Number.NaN)).toEqual({ ok: false, mensaje: "El precio de venta no es un número válido." });
    expect(await sincronizarPrecioGrupoCarta([], Number.POSITIVE_INFINITY)).toEqual({ ok: false, mensaje: "El precio de venta no es un número válido." });
    expect(await sincronizarPrecioGrupoCarta([], -1)).toEqual({ ok: false, mensaje: "El precio de venta no puede ser negativo." });
    expect(await sincronizarPrecioGrupoCarta([], 100)).toEqual({ ok: false, mensaje: "No hay productos para actualizar." });
  });
});
