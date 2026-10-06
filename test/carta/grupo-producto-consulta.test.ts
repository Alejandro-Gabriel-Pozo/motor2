import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, replicarCartaDeSucursal, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { ofrecerSincronizarPrecio, resolverGrupoDeProducto } from "../../src/core/carta/grupo-producto-consulta";

/**
 * `resolverGrupoDeProducto` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8), contra Postgres real: la única lectura de las
 * tablas de carta desde Catálogo/Precio Local. Devuelve null si el producto no está agrupado; si lo está, sus hermanos con su precio
 * global y el de la carta EN la sucursal pedida. `ofrecerSincronizarPrecio` (pura) decide si hay algo para ofrecer: con hermanos al
 * mismo precio, null (nada que sincronizar).
 */
describe("resolverGrupoDeProducto", () => {
  let central: string;
  let otra: string;
  let ids: Record<string, string>;
  let agId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const cat = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const pv = async (codigo: string, nombre: string, precioVenta: number) =>
      (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", categoriaId: cat, precioVenta, unidadStockId: u.id }, central)).id;
    ids = {
      coca: await pv("GPC_COCA", "Coca-Cola 500cc", 5000),
      sprite: await pv("GPC_SPRITE", "Sprite 500cc", 5000),
      fanta: await pv("GPC_FANTA", "Fanta 500cc", 5000),
      suelto: await pv("GPC_SUELTO", "Tónica 500cc", 5000),
    };
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol" } });
    agId = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Gaseosa 500 CC", seccionCartaId: seccion.id } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [ids.coca, ids.sprite, ids.fanta].map((productoId, orden) => ({ sucursalId: central, itemAgrupadoCartaId: agId, productoId, orden })),
    });
  });

  it("un producto no agrupado → null (y no hay nada para ofrecer)", async () => {
    expect(await resolverGrupoDeProducto(ids.suelto, central, prisma)).toBeNull();
    expect(ofrecerSincronizarPrecio(null, 5500, "global")).toBeNull();
  });

  it("agrupado con hermanos al MISMO precio → el grupo con sus hermanos (sin él mismo), y nada para ofrecer", async () => {
    const grupo = await resolverGrupoDeProducto(ids.fanta, central, prisma);
    expect(grupo).toEqual({
      itemAgrupadoCartaId: agId,
      nombreItem: "Gaseosa 500 CC",
      hermanos: [
        { productoId: ids.coca, nombre: "Coca-Cola 500cc", precioVenta: 5000, precioActual: 5000 },
        { productoId: ids.sprite, nombre: "Sprite 500cc", precioVenta: 5000, precioActual: 5000 },
      ],
    });
    expect(ofrecerSincronizarPrecio(grupo, 5000, "global")).toBeNull();
    expect(ofrecerSincronizarPrecio(grupo, 5000, "enSucursal")).toBeNull();
  });

  it("hermanos a OTRO precio → se listan con su precio real en esa sucursal (el local habilitado cuenta)", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: central, productoId: ids.sprite, precio: 5200, habilitado: true } });
    const grupo = await resolverGrupoDeProducto(ids.fanta, central, prisma);
    expect(grupo!.hermanos.find((h) => h.productoId === ids.sprite)).toEqual({ productoId: ids.sprite, nombre: "Sprite 500cc", precioVenta: 5000, precioActual: 5200 });

    // Fanta pasa a $5500: "global" compara contra el precio de venta global de cada hermano; "enSucursal", contra el de la carta acá.
    expect(ofrecerSincronizarPrecio(grupo, 5500, "global")).toEqual({
      itemAgrupadoCartaId: agId,
      nombreItem: "Gaseosa 500 CC",
      precioNuevo: 5500,
      hermanos: [
        { productoId: ids.coca, nombre: "Coca-Cola 500cc", precioActual: 5000 },
        { productoId: ids.sprite, nombre: "Sprite 500cc", precioActual: 5000 },
      ],
    });
    expect(ofrecerSincronizarPrecio(grupo, 5200, "enSucursal")!.hermanos).toEqual([{ productoId: ids.coca, nombre: "Coca-Cola 500cc", precioActual: 5000 }]);
  });

  it("el precio local de OTRA sucursal no afecta", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: otra, productoId: ids.coca, precio: 9999, habilitado: true } });
    const grupo = await resolverGrupoDeProducto(ids.fanta, central, prisma);
    expect(grupo!.hermanos.map((h) => h.precioActual)).toEqual([5000, 5000]);
    expect(ofrecerSincronizarPrecio(grupo, 5000, "enSucursal")).toBeNull();
    // En la otra sucursal, sí (con su carta propia: ADR-009, C3).
    await replicarCartaDeSucursal(central, otra);
    expect((await resolverGrupoDeProducto(ids.fanta, otra, prisma))!.hermanos.find((h) => h.productoId === ids.coca)!.precioActual).toBe(9999);
  });

  it("solo lee: no cambia nada", async () => {
    const contar = () => Promise.all([prisma.opcionItemAgrupadoCarta.count(), prisma.itemAgrupadoCarta.count(), prisma.producto.count(), prisma.precioLocalProducto.count()]);
    const antes = await contar();
    await resolverGrupoDeProducto(ids.coca, central, prisma);
    expect(await contar()).toEqual(antes);
  });
});
