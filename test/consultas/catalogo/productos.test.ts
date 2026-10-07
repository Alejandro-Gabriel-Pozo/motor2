import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import {
  obtenerFichaProducto,
  obtenerProductoOpcion,
  obtenerProductoPorId,
  obtenerSeccionHabitualEnSucursal,
  contarSucursales,
} from "../../../src/server/consultas/catalogo/productos";

/**
 * `src/server/consultas/catalogo/productos.ts` (Task #41, Fase D1 — piloto de `server/consultas/`) contra Postgres real.
 *
 * Estas funciones reemplazan, SIN cambiar su forma, las consultas Prisma que hacían en línea la ficha
 * (`/catalogo/productos/[id]`) y la edición (`/catalogo/productos/[id]/editar`) de un producto: acá se fija la forma exacta
 * de lo que devuelven (claves de primer nivel y de cada `include`/`select`), porque es lo que la página serializa al cliente.
 * `obtenerProductoOpcion` (Fase D6) reemplaza la del deep-link `/movimientos/[proceso]?productoId=`: solo `{ id, codigo, nombre }`.
 * Ninguna ordena: `findUnique` por id y `findFirst` sobre `@@unique([sucursalId, productoId])` traen a lo sumo UNA fila.
 */

const ESCALARES_PRODUCTO = Object.keys(Prisma.ProductoScalarFieldEnum).sort();
const RELACIONES_FICHA = ["categoria", "insumo", "proveedorConsignacion", "unidadCompra", "unidadStock"];

describe("server/consultas/catalogo/productos", () => {
  let sucursalA: string;
  let sucursalB: string;
  let kg: { id: string; nombre: string };
  let bolsa: { id: string; nombre: string };
  let categoriaId: string;
  let grupoId: string;
  let insumoId: string;
  let proveedorId: string;
  let mpCompleto: string;
  let pvSinRelaciones: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
    categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } })).id;
    grupoId = (await prisma.grupo.create({ data: { nombre: "Harinas" } })).id;
    insumoId = (await prisma.insumo.create({ data: { nombre: "Harina", grupoId } })).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_CONS01", nombre: "Molino Consignador" } })).id;

    mpCompleto = (
      await prisma.producto.create({
        data: {
          codigo: "MP_HARINA",
          nombre: "Harina 000",
          tipo: "MP",
          categoriaId,
          unidadCompraId: bolsa.id,
          unidadStockId: kg.id,
          factorConversion: 25,
          insumoId,
          esConsignacion: true,
          proveedorConsignacionId: proveedorId,
          precioConsignacion: 1500,
          observaciones: "Bolsa de 25 kg",
        },
      })
    ).id;
    pvSinRelaciones = (
      await prisma.producto.create({ data: { codigo: "PV_PIZZA", nombre: "Pizza muzza", tipo: "PV", unidadStockId: kg.id, precioVenta: 9000 } })
    ).id;
  });

  describe("obtenerFichaProducto", () => {
    it("trae el producto con EXACTAMENTE las 5 relaciones del include (y el grupo dentro del insumo), con los datos sembrados", async () => {
      const p = await obtenerFichaProducto(mpCompleto, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual([...ESCALARES_PRODUCTO, ...RELACIONES_FICHA].sort());
      expect(p.id).toBe(mpCompleto);
      expect(p.codigo).toBe("MP_HARINA");
      expect(Number(p.factorConversion)).toBe(25);
      expect(Number(p.precioConsignacion)).toBe(1500);

      expect(p.categoria).toMatchObject({ id: categoriaId, nombre: "Almacén" });
      expect(p.unidadCompra).toMatchObject({ id: bolsa.id, nombre: "bolsa" });
      expect(p.unidadStock).toMatchObject({ id: kg.id, nombre: "kg" });
      expect(p.proveedorConsignacion).toMatchObject({ id: proveedorId, nombre: "Molino Consignador" });

      // insumo: sus escalares + `grupo` (include anidado), nada más — ni `productos` ni `sustitutoEn`.
      expect(Object.keys(p.insumo ?? {}).sort()).toEqual([...Object.keys(Prisma.InsumoScalarFieldEnum), "grupo"].sort());
      expect(p.insumo).toMatchObject({ id: insumoId, nombre: "Harina", grupo: { id: grupoId, nombre: "Harinas" } });
    });

    it("las relaciones opcionales vacías vienen como null (siguen presentes como clave)", async () => {
      const p = await obtenerFichaProducto(pvSinRelaciones, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual([...ESCALARES_PRODUCTO, ...RELACIONES_FICHA].sort());
      expect(p.categoria).toBeNull();
      expect(p.unidadCompra).toBeNull();
      expect(p.insumo).toBeNull();
      expect(p.proveedorConsignacion).toBeNull();
      expect(p.unidadStock).toMatchObject({ id: kg.id, nombre: "kg" });
      expect(Number(p.precioVenta)).toBe(9000);
    });

    it("un id que no existe devuelve null (findUnique, no lanza)", async () => {
      await expect(obtenerFichaProducto("no-existe", prisma)).resolves.toBeNull();
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const p = await prisma.$transaction((tx) => obtenerFichaProducto(mpCompleto, tx));
      expect(p?.id).toBe(mpCompleto);
      expect(p?.insumo?.grupo?.nombre).toBe("Harinas");
    });
  });

  describe("obtenerSeccionHabitualEnSucursal", () => {
    it("devuelve SOLO { seccion: { nombre } } de la sección habitual activa en esa sucursal", async () => {
      const cocinaA = await prisma.seccion.create({ data: { sucursalId: sucursalA, nombre: "Cocina A" } });
      const barraB = await prisma.seccion.create({ data: { sucursalId: sucursalB, nombre: "Barra B" } });
      await prisma.seccionHabitualProducto.createMany({
        data: [
          { sucursalId: sucursalA, productoId: pvSinRelaciones, seccionId: cocinaA.id },
          { sucursalId: sucursalB, productoId: pvSinRelaciones, seccionId: barraB.id },
        ],
      });

      const enA = await obtenerSeccionHabitualEnSucursal(sucursalA, pvSinRelaciones, prisma);
      expect(enA).toEqual({ seccion: { nombre: "Cocina A" } });
      expect(Object.keys(enA ?? {})).toEqual(["seccion"]);
      expect(Object.keys(enA?.seccion ?? {})).toEqual(["nombre"]);

      // Filtra por la sucursal pedida: en B trae la de B, no la de A.
      await expect(obtenerSeccionHabitualEnSucursal(sucursalB, pvSinRelaciones, prisma)).resolves.toEqual({ seccion: { nombre: "Barra B" } });
    });

    it("null si el producto no tiene sección habitual en esa sucursal (aunque tenga en otra)", async () => {
      const barraB = await prisma.seccion.create({ data: { sucursalId: sucursalB, nombre: "Barra B" } });
      await prisma.seccionHabitualProducto.create({ data: { sucursalId: sucursalB, productoId: pvSinRelaciones, seccionId: barraB.id } });

      await expect(obtenerSeccionHabitualEnSucursal(sucursalA, pvSinRelaciones, prisma)).resolves.toBeNull();
    });

    it("null si la sección habitual está inactiva", async () => {
      const inactiva = await prisma.seccion.create({ data: { sucursalId: sucursalA, nombre: "Vieja", activa: false } });
      await prisma.seccionHabitualProducto.create({ data: { sucursalId: sucursalA, productoId: pvSinRelaciones, seccionId: inactiva.id } });

      await expect(obtenerSeccionHabitualEnSucursal(sucursalA, pvSinRelaciones, prisma)).resolves.toBeNull();
    });

    it("null si la fila es de esta sucursal pero apunta a una sección de OTRA (dato inconsistente: no se muestra)", async () => {
      const deB = await prisma.seccion.create({ data: { sucursalId: sucursalB, nombre: "Barra B" } });
      await prisma.seccionHabitualProducto.create({ data: { sucursalId: sucursalA, productoId: pvSinRelaciones, seccionId: deB.id } });

      await expect(obtenerSeccionHabitualEnSucursal(sucursalA, pvSinRelaciones, prisma)).resolves.toBeNull();
    });

    it("filtra por producto: la habitual de otro producto no se cuela", async () => {
      const cocinaA = await prisma.seccion.create({ data: { sucursalId: sucursalA, nombre: "Cocina A" } });
      await prisma.seccionHabitualProducto.create({ data: { sucursalId: sucursalA, productoId: mpCompleto, seccionId: cocinaA.id } });

      await expect(obtenerSeccionHabitualEnSucursal(sucursalA, pvSinRelaciones, prisma)).resolves.toBeNull();
      await expect(obtenerSeccionHabitualEnSucursal(sucursalA, mpCompleto, prisma)).resolves.toEqual({ seccion: { nombre: "Cocina A" } });
    });
  });

  describe("obtenerProductoPorId", () => {
    it("trae SOLO los escalares del producto, sin ninguna relación", async () => {
      const p = await obtenerProductoPorId(mpCompleto, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual(ESCALARES_PRODUCTO);
      expect(p).toMatchObject({
        id: mpCompleto,
        codigo: "MP_HARINA",
        nombre: "Harina 000",
        tipo: "MP",
        categoriaId,
        unidadCompraId: bolsa.id,
        unidadStockId: kg.id,
        insumoId,
        esConsignacion: true,
        proveedorConsignacionId: proveedorId,
        observaciones: "Bolsa de 25 kg",
      });
    });

    it("un id que no existe devuelve null (findUnique, no lanza)", async () => {
      await expect(obtenerProductoPorId("no-existe", prisma)).resolves.toBeNull();
    });
  });

  describe("obtenerProductoOpcion", () => {
    it("trae SOLO { id, codigo, nombre } del producto (ningún otro escalar, ninguna relación)", async () => {
      const p = await obtenerProductoOpcion(mpCompleto, prisma);
      expect(p).toEqual({ id: mpCompleto, codigo: "MP_HARINA", nombre: "Harina 000" });
      expect(Object.keys(p ?? {}).sort()).toEqual(["codigo", "id", "nombre"]);

      // Filtra por el id pedido: el otro producto trae lo suyo.
      await expect(obtenerProductoOpcion(pvSinRelaciones, prisma)).resolves.toEqual({ id: pvSinRelaciones, codigo: "PV_PIZZA", nombre: "Pizza muzza" });
    });

    it("un id que no existe devuelve null (findUnique, no lanza)", async () => {
      await expect(obtenerProductoOpcion("no-existe", prisma)).resolves.toBeNull();
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const p = await prisma.$transaction((tx) => obtenerProductoOpcion(mpCompleto, tx));
      expect(p).toEqual({ id: mpCompleto, codigo: "MP_HARINA", nombre: "Harina 000" });
    });
  });

  describe("contarSucursales (H8, D-3: el alta de producto cuenta sin pedir la lista)", () => {
    it("cuenta todas las sucursales de la empresa, también las inactivas (sin filtro, como `listarSucursales().length`)", async () => {
      await prisma.sucursal.update({ where: { id: sucursalB }, data: { activo: false } });
      await expect(contarSucursales(prisma)).resolves.toBe(2);
      expect(sucursalA).toBeTruthy();
    });
  });
});
