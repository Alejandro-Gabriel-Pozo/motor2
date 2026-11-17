import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, darDeAltaProducto } from "../../src/server/actions/catalogo/productos";

/**
 * El alta como Pedernal (decisión del dueño, 2026-11-17: «¿cuál está el problema en replicar las pantallas de Pedernal?») ya no pide categoría, insumo, unidad de compra, factor de conversión, paso de venta ni
 * consignación. Contra Postgres real: el pedido que arma el formulario del alta SIN esos campos crea el producto con los valores por defecto (sin categoría, sin insumo, sin unidad de compra, factor 1, sin
 * paso de venta, sin consignación), y la edición posterior (con la clave `producto_campos_sensibles`) puede completarlos. Idempotencia y concurrencia del alta: `alta-con-clase.test.ts`.
 */
describe("alta sin categoría, insumo, unidad de compra, factor, paso de venta ni consignación", () => {
  let kgId: string;
  let gId: string;
  let categoriaId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    categoriaId = catalogo.categoria.id;
    insumoId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Lo que manda el formulario del alta como Pedernal (`producto-form.tsx`): sin esos campos el cliente manda los valores neutros de siempre. */
  const pedidoDelAlta = (nombre: string, tipo: "MP" | "PV", extra: Record<string, unknown> = {}) =>
    ({
      nombre, tipo, categoriaId: null, insumoId: null, pasoVenta: null, seProduce: false, esConsignacion: false, proveedorConsignacionId: null, precioConsignacion: 0,
      unidadCompraId: null, unidadStockId: kgId, factorConversion: 1, precioVenta: 0, activoEnTodasLasSucursales: true, ...extra,
    }) as Parameters<typeof darDeAltaProducto>[0];

  it.each([["MP", "Harina del alta"], ["PV", "Milanesa del alta"]] as const)("un %s se crea con los valores por defecto", async (tipo, nombre) => {
    const r = await darDeAltaProducto(pedidoDelAlta(nombre, tipo));
    expect(r.ok, r.mensaje).toBe(true);
    const p = await prismaAdmin.producto.findFirstOrThrow({ where: { nombre } });
    expect({
      categoriaId: p.categoriaId, insumoId: p.insumoId, unidadCompraId: p.unidadCompraId, factor: Number(p.factorConversion), pasoVenta: p.pasoVenta, esConsignacion: p.esConsignacion,
      proveedorConsignacionId: p.proveedorConsignacionId, precioConsignacion: Number(p.precioConsignacion), precioVenta: Number(p.precioVenta), unidadStockId: p.unidadStockId,
    }).toEqual({ categoriaId: null, insumoId: null, unidadCompraId: null, factor: 1, pasoVenta: null, esConsignacion: false, proveedorConsignacionId: null, precioConsignacion: 0, precioVenta: 0, unidadStockId: kgId });
  });

  it("la edición posterior (con la clave) completa categoría, insumo, unidad de compra y factor de una materia prima", async () => {
    expect((await darDeAltaProducto(pedidoDelAlta("Harina a completar", "MP"))).ok).toBe(true);
    const p = await prismaAdmin.producto.findFirstOrThrow({ where: { nombre: "Harina a completar" } });
    const r = await actualizarProducto(p.id, {
      nombre: p.nombre, tipo: "MP", categoriaId, insumoId, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, seProduce: false, precioVentaVisto: 0,
    } as Parameters<typeof actualizarProducto>[1]);
    expect(r.ok, r.mensaje).toBe(true);
    const despues = await prismaAdmin.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect({ categoriaId: despues.categoriaId, insumoId: despues.insumoId, unidadCompraId: despues.unidadCompraId, factor: Number(despues.factorConversion) }).toEqual({ categoriaId, insumoId, unidadCompraId: gId, factor: 25 });
  });
});
