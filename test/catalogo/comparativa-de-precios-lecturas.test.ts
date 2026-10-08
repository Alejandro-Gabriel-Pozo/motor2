import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { cargarComparativaDePrecios } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Las lecturas de la comparativa de precios (Hito 4, paso A5, O.8a): los productos y los proveedores se leen ACOTADOS POR EL CATÁLOGO, sin una lista `in` de ids tan larga como las
 * ofertas (antes no tenía tope: con muchos productos comprados se acercaba al límite de parámetros). Se espían con `$extends` (`$allOperations` de primer nivel) los argumentos de
 * cada consulta: ningún `where` con `in`, y la misma cantidad de consultas sin importar cuántas ofertas haya.
 */
describe("comparativa de precios: lecturas sin listas `in`", () => {
  let sucursalId: string;
  let seccionId: string;
  let usuarioId: string;
  let kgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
  });

  const espiando = () => {
    const consultas: { quien: string; where: unknown }[] = [];
    const db = prisma.$extends({
      query: {
        $allOperations({ model, operation, args, query }) {
          consultas.push({ quien: model ? `${model}.${operation}` : operation, where: (args as { where?: unknown } | undefined)?.where });
          return query(args);
        },
      },
    }) as unknown as Db;
    return { db, consultas };
  };

  const sembrar = async (productos: number, proveedores: number) => {
    const provs = [];
    for (let v = 0; v < proveedores; v++) provs.push((await prisma.proveedor.create({ data: { codigo: `PRV_${v}`, nombre: `Proveedor ${v}` } })).id);
    for (let p = 0; p < productos; p++) {
      const producto = await sembrarProductoDisponible({ codigo: `MP_${p}`, nombre: `Harina ${p}`, tipo: "MP", unidadStockId: kgId, insumoId }, sucursalId);
      for (const [i, proveedorId] of provs.entries()) {
        await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: producto.id, proveedorId, fecha: "2026-09-10", precioPorUnidadStock: 100 + p + i });
        await prisma.proveedorPorProducto.create({ data: { productoId: producto.id, proveedorId, unidadCompraId: kgId, precioUnitario: 1, precioPorUnidadStock: 1 } });
      }
    }
  };

  it.each([
    [2, 2],
    [6, 3],
  ])("%i productos y %i proveedores: 4 consultas y ningún `where` con `in`", async (productos, proveedores) => {
    await sembrar(productos, proveedores);
    const { db, consultas } = espiando();
    const filas = await cargarComparativaDePrecios(db);

    expect(filas).toHaveLength(1); // todos los productos son del mismo insumo
    expect(filas[0].todas).toHaveLength(productos * proveedores);
    expect(consultas.map((c) => c.quien).sort()).toEqual(["$queryRaw", "Producto.findMany", "Proveedor.findMany", "ProveedorPorProducto.findMany"]);
    for (const c of consultas) expect(JSON.stringify(c.where ?? {}), c.quien).not.toMatch(/"in"/);
  });

  it("sin ofertas: solo la lectura de las ofertas", async () => {
    const { db, consultas } = espiando();
    expect(await cargarComparativaDePrecios(db)).toEqual([]);
    expect(consultas.map((c) => c.quien)).toEqual(["$queryRaw"]);
  });
});
