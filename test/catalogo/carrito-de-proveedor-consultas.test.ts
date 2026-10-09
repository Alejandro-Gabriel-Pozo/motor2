import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion, crearUsuarioConMembresia } from "../setup/test-db";
import { cargarProductosDeProveedorParaElCarrito } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Cuántas consultas hace la precarga del carrito de una Compra (`cargarProductosDeProveedorParaElCarrito`, Hito 4, paso A3 de `docs/plan-hito-4-pureza.md` §4) y que NO crecen
 * con la cantidad de productos ni de sucursales. Se cuenta con `$extends` y `$allOperations` de PRIMER nivel (en Prisma 7 ya ve las de modelo y las crudas; sumarle `$allModels`
 * contaría dos veces), cada una como `modelo.operación` (o `$queryRaw` para el SQL crudo), ordenadas (las dos lecturas de ofertas van en paralelo).
 *
 * Dos escenarios por tamaño: con la fila de `ProveedorPorProducto` de cada par (lo normal desde 2026-10-07: toda compra con proveedor la escribe) y sin ninguna (compras viejas:
 * el lector lee además la unidad de compra de los productos). Nació (paso A3) fijando el conteo de entonces: 5 y 7, con DOS lecturas de ofertas (la de la empresa y la filtrada
 * por la sucursal). O.5 (paso A4) las fusionó en una (`precioDeLaSucursal`): 3 y 4, igual con 2 y 5 productos y 2 y 5 sucursales.
 */
describe("carrito de una Compra: consultas de la precarga por proveedor", () => {
  let sucursalId: string;
  let seccionId: string;
  let usuarioId: string;
  let kgId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } })).id;
  });

  /** `productos` productos comprados al proveedor en `sucursales` sucursales (la de la sesión incluida); con o sin la fila de la tabla de cada par. */
  async function sembrar(productos: number, sucursales: number, conFila: boolean) {
    const otras: { sucursalId: string; seccionId: string }[] = [];
    for (let s = 1; s < sucursales; s++) {
      const id = (await prisma.sucursal.create({ data: { nombre: `Sucursal ${s}` } })).id;
      otras.push({ sucursalId: id, seccionId: (await sembrarSeccion(id, `Depósito ${s}`)).id });
    }
    for (let p = 0; p < productos; p++) {
      const producto = await sembrarProductoDisponible({ codigo: `MP_${p}`, nombre: `Insumo ${p}`, tipo: "MP", unidadStockId: kgId }, sucursalId);
      // Los pares sin compra en ESTA sucursal toman el precio de la empresa (otra sucursal): se alternan para cubrir los dos orígenes.
      if (p % 2 === 0) await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: producto.id, proveedorId, fecha: "2026-09-01", precioPorUnidadStock: 100 + p });
      for (const o of otras) await sembrarCompraDeKardex({ ...o, usuarioId, productoId: producto.id, proveedorId, fecha: "2026-09-05", precioPorUnidadStock: 200 + p });
      if (conFila) await prisma.proveedorPorProducto.create({ data: { productoId: producto.id, proveedorId, unidadCompraId: kgId, precioUnitario: 1, precioPorUnidadStock: 1 } });
    }
  }

  const contando = () => {
    const consultas: string[] = [];
    const db = prisma.$extends({
      query: {
        $allOperations({ model, operation, args, query }) {
          consultas.push(model ? `${model}.${operation}` : operation);
          return query(args);
        },
      },
    }) as unknown as Db;
    return { db, consultas };
  };

  describe.each([
    [2, 2],
    [5, 2],
    [2, 5],
    [5, 5],
  ])("%i productos, %i sucursales", (productos, sucursales) => {
    it("con la fila de cada par en la tabla: 3 consultas (UNA lectura de ofertas con la sucursal adentro + su tabla + los productos)", async () => {
      await sembrar(productos, sucursales, true);
      const { db, consultas } = contando();
      const filas = await cargarProductosDeProveedorParaElCarrito(db, proveedorId, sucursalId);
      expect(filas).toHaveLength(productos);
      expect(new Set(filas.map((f) => f.origenDelPrecio))).toEqual(new Set(["SUCURSAL", "EMPRESA"])); // los dos orígenes del precio
      expect(consultas.sort()).toEqual(["$queryRaw", "Producto.findMany", "ProveedorPorProducto.findMany"]);
    });

    it("sin filas en la tabla (compras viejas): 4 consultas (la lectura de ofertas suma la unidad de los productos)", async () => {
      await sembrar(productos, sucursales, false);
      const { db, consultas } = contando();
      const filas = await cargarProductosDeProveedorParaElCarrito(db, proveedorId, sucursalId);
      expect(filas).toHaveLength(productos);
      expect(consultas.sort()).toEqual(["$queryRaw", "Producto.findMany", "Producto.findMany", "ProveedorPorProducto.findMany"]);
    });
  });
});
