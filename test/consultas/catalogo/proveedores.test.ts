import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { listarProductosQueLeCompran, obtenerFichaProveedor, obtenerProveedorPorId } from "../../../src/server/consultas/catalogo/proveedores";

/**
 * `src/server/consultas/catalogo/proveedores.ts` (Task #41, Fase D2) contra Postgres real.
 *
 * Estas funciones reemplazan, SIN cambiar su forma, las consultas Prisma que hacían en línea la ficha
 * (`/catalogo/proveedores/[id]`) y la edición (`/catalogo/proveedores/[id]/editar`) de un proveedor: acá se fija la forma exacta
 * de lo que devuelven (claves de primer nivel y de cada `include`), el filtro por proveedor y el orden por nombre de producto
 * de "lo que se le compra". `productosConsignados` no lleva `orderBy` en la consulta original: se compara como conjunto.
 */

const ESCALARES_PROVEEDOR = Object.keys(Prisma.ProveedorScalarFieldEnum).sort();
const ESCALARES_PRODUCTO = Object.keys(Prisma.ProductoScalarFieldEnum).sort();
const ESCALARES_UNIDAD = Object.keys(Prisma.UnidadScalarFieldEnum).sort();
const ESCALARES_PROVEEDOR_POR_PRODUCTO = Object.keys(Prisma.ProveedorPorProductoScalarFieldEnum).sort();

describe("server/consultas/catalogo/proveedores", () => {
  let kg: { id: string; nombre: string };
  let bolsa: { id: string; nombre: string };
  let molino: string;
  let otroProveedor: string;
  let sinNada: string;
  let harina: string;
  let azucar: string;
  let yerba: string;
  let consignadoA: string;
  let consignadoB: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });

    molino = (
      await prisma.proveedor.create({
        data: {
          codigo: "PRV_MOL001",
          nombre: "Molino del Sur",
          contacto: "Ana",
          telefono: "11-5555-0000",
          email: "ventas@molino.test",
          cuit: "30-12345678-9",
          condicionesPago: "30 días",
          notas: "Entrega martes",
        },
      })
    ).id;
    otroProveedor = (await prisma.proveedor.create({ data: { codigo: "PRV_OTR001", nombre: "Distribuidora Norte" } })).id;
    sinNada = (await prisma.proveedor.create({ data: { codigo: "PRV_VAC001", nombre: "Proveedor Vacío", activo: false } })).id;

    // Creados en un orden distinto del alfabético, para que el orderBy por nombre de producto se note.
    yerba = (await prisma.producto.create({ data: { codigo: "MP_YERBA", nombre: "Yerba", tipo: "MP", unidadStockId: kg.id } })).id;
    harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina 000", tipo: "MP", unidadStockId: kg.id } })).id;
    azucar = (await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: kg.id } })).id;

    consignadoA = (
      await prisma.producto.create({
        data: { codigo: "PV_ALFAJOR", nombre: "Alfajor", tipo: "PV", unidadStockId: kg.id, esConsignacion: true, proveedorConsignacionId: molino },
      })
    ).id;
    consignadoB = (
      await prisma.producto.create({
        data: { codigo: "PV_BUDIN", nombre: "Budín", tipo: "PV", unidadStockId: kg.id, esConsignacion: true, proveedorConsignacionId: molino },
      })
    ).id;
    // Consignado de OTRO proveedor: no se tiene que colar en la ficha del molino.
    await prisma.producto.create({
      data: { codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: kg.id, esConsignacion: true, proveedorConsignacionId: otroProveedor },
    });

    await prisma.proveedorPorProducto.createMany({
      data: [
        { proveedorId: molino, productoId: yerba, unidadCompraId: kg.id, precioUnitario: 100, precioPorUnidadStock: 100 },
        { proveedorId: molino, productoId: harina, unidadCompraId: bolsa.id, precioUnitario: 25000, precioPorUnidadStock: 1000, referenciaProveedor: "H000-25" },
        { proveedorId: molino, productoId: azucar, unidadCompraId: kg.id },
        // Del otro proveedor: no se tiene que colar en "lo que se le compra" al molino.
        { proveedorId: otroProveedor, productoId: harina, unidadCompraId: kg.id, precioUnitario: 900, precioPorUnidadStock: 900 },
      ],
    });
  });

  describe("obtenerFichaProveedor", () => {
    it("trae el proveedor con EXACTAMENTE `productosConsignados` como relación, y solo los consignados a él", async () => {
      const p = await obtenerFichaProveedor(molino, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual([...ESCALARES_PROVEEDOR, "productosConsignados"].sort());
      expect(p).toMatchObject({
        id: molino,
        codigo: "PRV_MOL001",
        nombre: "Molino del Sur",
        contacto: "Ana",
        telefono: "11-5555-0000",
        email: "ventas@molino.test",
        cuit: "30-12345678-9",
        condicionesPago: "30 días",
        notas: "Entrega martes",
        activo: true,
      });

      // Sin orderBy en la consulta original: se compara como conjunto.
      expect(p.productosConsignados.map((x) => x.id).sort()).toEqual([consignadoA, consignadoB].sort());
      // Cada consignado viene con sus escalares, sin relaciones anidadas.
      for (const prod of p.productosConsignados) expect(Object.keys(prod).sort()).toEqual(ESCALARES_PRODUCTO);
    });

    it("sin consignados, `productosConsignados` viene como [] (clave presente)", async () => {
      const p = await obtenerFichaProveedor(sinNada, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual([...ESCALARES_PROVEEDOR, "productosConsignados"].sort());
      expect(p.productosConsignados).toEqual([]);
      expect(p.activo).toBe(false);
      expect(p.contacto).toBeNull();
    });

    it("un id que no existe devuelve null (findUnique, no lanza)", async () => {
      await expect(obtenerFichaProveedor("no-existe", prisma)).resolves.toBeNull();
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const p = await prisma.$transaction((tx) => obtenerFichaProveedor(molino, tx));
      expect(p?.id).toBe(molino);
      expect(p?.productosConsignados).toHaveLength(2);
    });
  });

  describe("listarProductosQueLeCompran", () => {
    it("trae SOLO las filas de ese proveedor, ordenadas por nombre de producto, con `producto` y `unidadCompra`", async () => {
      const filas = await listarProductosQueLeCompran(molino, prisma);

      expect(filas.map((f) => f.producto.nombre)).toEqual(["Azúcar", "Harina 000", "Yerba"]);
      expect(filas.every((f) => f.proveedorId === molino)).toBe(true);

      for (const f of filas) {
        expect(Object.keys(f).sort()).toEqual([...ESCALARES_PROVEEDOR_POR_PRODUCTO, "producto", "unidadCompra"].sort());
        expect(Object.keys(f.producto).sort()).toEqual(ESCALARES_PRODUCTO);
        expect(Object.keys(f.unidadCompra).sort()).toEqual(ESCALARES_UNIDAD);
      }

      const [a, h, y] = filas;
      expect(a.producto).toMatchObject({ id: azucar, codigo: "MP_AZUCAR" });
      expect(a.unidadCompra).toMatchObject({ id: kg.id, nombre: "kg" });
      expect(Number(a.precioPorUnidadStock)).toBe(0);
      expect(a.referenciaProveedor).toBeNull();

      expect(h.producto).toMatchObject({ id: harina, codigo: "MP_HARINA" });
      expect(h.unidadCompra).toMatchObject({ id: bolsa.id, nombre: "bolsa" });
      expect(Number(h.precioUnitario)).toBe(25000);
      expect(Number(h.precioPorUnidadStock)).toBe(1000);
      expect(h.referenciaProveedor).toBe("H000-25");

      expect(y.producto).toMatchObject({ id: yerba, codigo: "MP_YERBA" });
    });

    it("filtra por proveedor: el otro proveedor ve solo su fila", async () => {
      const filas = await listarProductosQueLeCompran(otroProveedor, prisma);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ proveedorId: otroProveedor, productoId: harina, unidadCompraId: kg.id });
    });

    it("proveedor sin compras (o inexistente) devuelve []", async () => {
      await expect(listarProductosQueLeCompran(sinNada, prisma)).resolves.toEqual([]);
      await expect(listarProductosQueLeCompran("no-existe", prisma)).resolves.toEqual([]);
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const filas = await prisma.$transaction((tx) => listarProductosQueLeCompran(molino, tx));
      expect(filas.map((f) => f.productoId)).toEqual([azucar, harina, yerba]);
    });
  });

  describe("obtenerProveedorPorId", () => {
    it("trae SOLO los escalares del proveedor, sin ninguna relación", async () => {
      const p = await obtenerProveedorPorId(molino, prisma);
      expect(p).not.toBeNull();
      if (!p) return;

      expect(Object.keys(p).sort()).toEqual(ESCALARES_PROVEEDOR);
      expect(p).toEqual({
        id: molino,
        codigo: "PRV_MOL001",
        nombre: "Molino del Sur",
        contacto: "Ana",
        telefono: "11-5555-0000",
        email: "ventas@molino.test",
        cuit: "30-12345678-9",
        condicionesPago: "30 días",
        notas: "Entrega martes",
        activo: true,
      });
    });

    it("un id que no existe devuelve null (findUnique, no lanza)", async () => {
      await expect(obtenerProveedorPorId("no-existe", prisma)).resolves.toBeNull();
    });
  });
});
