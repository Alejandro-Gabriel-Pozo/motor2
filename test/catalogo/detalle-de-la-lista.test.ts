import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { detalleDeLaLista } from "../../src/server/consultas/catalogo/detalle-de-la-lista";
import { seccionDeCartaDeLosProductos } from "../../src/server/consultas/carta/seccion-de-productos";

/**
 * El precio y la clase de cada fila de la lista de Productos (docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D1), contra Postgres real: el precio es el de la sucursal ACTIVA (el propio vigente o el central),
 * «Según medida» para el producto por opción, «Sin precio» con 0 y nada para lo que no se vende; la clase sale de tipo, se produce y respaldo.
 */
describe("detalleDeLaLista", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    unidadKgId = (await sembrarCatalogoBase()).kg.id;
  });

  it("precio central, «Según medida», «Sin precio» y nada para lo que no se vende; y la clase de cada uno", async () => {
    const directo = await sembrarProductoDisponible({ codigo: "PV_PRE1", nombre: "Con precio", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 9500 }, sucursalId);
    const sin = await sembrarProductoDisponible({ codigo: "PV_PRE2", nombre: "Sin precio", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 0 }, sucursalId);
    const porOpcion = await sembrarProductoDisponible({ codigo: "PV_PRE3", nombre: "Por opcion", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 4000 }, sucursalId);
    await prisma.$executeRaw`UPDATE "Producto" SET "modoDeVenta" = 'BASE_CONFIGURABLE' WHERE id = ${porOpcion.id}`;
    const harina = await sembrarProductoDisponible({ codigo: "MP_PRE4", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, precioVenta: 0 }, sucursalId);
    const salsa = await prisma.producto.create({ data: { codigo: "MP_PRE5", nombre: "Salsa", tipo: "MP", unidadStockId: unidadKgId, seProduce: true } });

    const d = await detalleDeLaLista(prisma, sucursalId, [directo.id, sin.id, porOpcion.id, harina.id, salsa.id]);
    expect(d.get(directo.id)).toEqual({ precio: "$ 9.500,00", clase: "venta" });
    expect(d.get(sin.id)).toEqual({ precio: "Sin precio", clase: "venta" });
    expect(d.get(porOpcion.id)).toEqual({ precio: "Según medida", clase: "venta" });
    expect(d.get(harina.id)).toEqual({ precio: null, clase: "materia-prima" });
    expect(d.get(salsa.id)).toEqual({ precio: null, clase: "se-produce" });
  });

  it("con la capacidad precio_local prendida rige el de ESTA sucursal; apagada, el central; el de otra sucursal nunca se mezcla", async () => {
    const p = await sembrarProductoDisponible({ codigo: "PV_PRE6", nombre: "Con local", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 1000 }, sucursalId);
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: p.id, precio: 1234, habilitado: true } });
    await prisma.precioLocalProducto.create({ data: { sucursalId: otraSucursalId, productoId: p.id, precio: 9999, habilitado: true } });
    const capacidad = await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId, habilitado: true } });
    expect((await detalleDeLaLista(prisma, sucursalId, [p.id])).get(p.id)!.precio).toBe("$ 1.234,00");
    await prisma.capacidadSucursal.update({ where: { id: capacidad.id }, data: { habilitado: false } });
    expect((await detalleDeLaLista(prisma, sucursalId, [p.id])).get(p.id)!.precio).toBe("$ 1.000,00");
  });

  it("la sección de la carta es la de ESTA sucursal: solo figuran los que la tienen; ni la de otra sucursal ni la de otra empresa", async () => {
    const conSeccion = await sembrarProductoDisponible({ codigo: "PV_SEC1", nombre: "En platos", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const sinSeccion = await sembrarProductoDisponible({ codigo: "PV_SEC2", nombre: "Sin sección", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const soloEnOtra = await sembrarProductoDisponible({ codigo: "PV_SEC3", nombre: "Carta de otra", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: conSeccion.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: sinSeccion.id, visibleEnCarta: false, seccionCartaId: null } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: otraSucursalId, productoId: soloEnOtra.id, visibleEnCarta: true, seccionCartaId: platos.id } });
    const m = await seccionDeCartaDeLosProductos(prisma, sucursalId, [conSeccion.id, sinSeccion.id, soloEnOtra.id]);
    expect([...m.entries()]).toEqual([[conSeccion.id, "Platos"]]);
    expect((await seccionDeCartaDeLosProductos(prisma, sucursalId, [])).size).toBe(0);
  });

  it("sin ids no consulta nada", async () => {
    expect((await detalleDeLaLista(prisma, sucursalId, [])).size).toBe(0);
  });
});
