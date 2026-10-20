import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { escribirPrecioLocal, leerPrecioLocal } from "../../src/server/persistencia/movimientos/precio-local";

/**
 * `leerPrecioLocal` (ola «precio y carta», Fase 2, paso A0): la fila del precio local TAL COMO ESTÁ (habilitada o no), que el caso de uso compara con lo que
 * vio la pantalla dentro de su transacción. Contra Postgres real.
 */
describe("leerPrecioLocal", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "PV_A", nombre: "A", tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, sucursalId)).id;
  });

  it("sin fila → null; con fila → precio (number) y habilitado, también apagada; solo la de esa sucursal", async () => {
    expect(await prisma.$transaction((tx) => leerPrecioLocal(tx, { sucursalId, productoId }))).toBeNull();
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId, precio: "3500.50", habilitado: false } });
    expect(await prisma.$transaction((tx) => leerPrecioLocal(tx, { sucursalId, productoId }))).toEqual({ precio: 3500.5, habilitado: false });
    expect(await prisma.$transaction((tx) => leerPrecioLocal(tx, { sucursalId: otraSucursalId, productoId }))).toBeNull();
  });

  it("escribirPrecioLocal devuelve como `anterior` lo mismo que leerPrecioLocal veía antes de escribir", async () => {
    const primera = await prisma.$transaction((tx) => escribirPrecioLocal(tx, { sucursalId, productoId, precio: 1200, habilitado: true }));
    expect(primera.anterior).toBeNull();
    const segunda = await prisma.$transaction((tx) => escribirPrecioLocal(tx, { sucursalId, productoId, precio: 1300, habilitado: false }));
    expect(segunda.anterior).toEqual({ precio: 1200, habilitado: true });
    expect(await prisma.$transaction((tx) => leerPrecioLocal(tx, { sucursalId, productoId }))).toEqual({ precio: 1300, habilitado: false });
  });
});
