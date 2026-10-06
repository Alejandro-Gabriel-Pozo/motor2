import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { whereDisponibleEn, whereDisponibleEnAlguna, productoDisponibleEn, disponibilidadDeProductos, disponibilidadPorSucursalDeProducto } from "../../src/core/catalogo/disponibilidad-producto-consulta";

describe("disponibilidad-producto-consulta", () => {
  let sucursalA: string;
  let sucursalB: string;
  let disponibleSoloEnA: string;
  let disponibleEnLasDos: string;
  let noDisponibleEnNinguna: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;

    disponibleSoloEnA = (await prisma.producto.create({ data: { codigo: "DISP_A", nombre: "Solo en A", tipo: "MP", unidadStockId: kg.id } })).id;
    disponibleEnLasDos = (await prisma.producto.create({ data: { codigo: "DISP_AB", nombre: "En las dos", tipo: "MP", unidadStockId: kg.id } })).id;
    noDisponibleEnNinguna = (await prisma.producto.create({ data: { codigo: "DISP_NINGUNA", nombre: "En ninguna", tipo: "MP", unidadStockId: kg.id } })).id;

    await prisma.disponibilidadProducto.createMany({
      data: [
        { sucursalId: sucursalA, productoId: disponibleSoloEnA, disponible: true },
        { sucursalId: sucursalB, productoId: disponibleSoloEnA, disponible: false },
        { sucursalId: sucursalA, productoId: disponibleEnLasDos, disponible: true },
        { sucursalId: sucursalB, productoId: disponibleEnLasDos, disponible: true },
        { sucursalId: sucursalA, productoId: noDisponibleEnNinguna, disponible: false },
        // sin fila para noDisponibleEnNinguna en sucursalB — también cuenta como no disponible
      ],
    });
  });

  describe("whereDisponibleEn / whereDisponibleEnAlguna", () => {
    it("whereDisponibleEn(A) trae los disponibles en A, no los de solo B", async () => {
      const productos = await prisma.producto.findMany({ where: whereDisponibleEn(sucursalA) });
      expect(productos.map((p) => p.codigo).sort()).toEqual(["DISP_A", "DISP_AB"]);
    });

    it("whereDisponibleEnAlguna trae cualquiera disponible en al menos una sucursal", async () => {
      const productos = await prisma.producto.findMany({ where: whereDisponibleEnAlguna() });
      expect(productos.map((p) => p.codigo).sort()).toEqual(["DISP_A", "DISP_AB"]);
    });
  });

  describe("productoDisponibleEn", () => {
    it("true cuando la fila existe con disponible: true", async () => {
      expect(await productoDisponibleEn(sucursalA, disponibleSoloEnA, prisma)).toBe(true);
    });

    it("false cuando la fila existe con disponible: false", async () => {
      expect(await productoDisponibleEn(sucursalB, disponibleSoloEnA, prisma)).toBe(false);
    });

    it("false cuando no hay ninguna fila", async () => {
      expect(await productoDisponibleEn(sucursalB, noDisponibleEnNinguna, prisma)).toBe(false);
    });
  });

  describe("disponibilidadDeProductos (batch)", () => {
    it("resuelve varios productos de una, con false para los sin fila", async () => {
      const resultado = await disponibilidadDeProductos(sucursalA, [disponibleSoloEnA, disponibleEnLasDos, noDisponibleEnNinguna], prisma);
      expect(resultado.get(disponibleSoloEnA)).toBe(true);
      expect(resultado.get(disponibleEnLasDos)).toBe(true);
      expect(resultado.get(noDisponibleEnNinguna)).toBe(false);
    });

    it("lista vacía no dispara ninguna consulta y da un Map vacío", async () => {
      expect((await disponibilidadDeProductos(sucursalA, [], prisma)).size).toBe(0);
    });
  });

  describe("disponibilidadPorSucursalDeProducto", () => {
    it("trae el estado en TODAS las sucursales activas, incluida la que no tiene fila propia", async () => {
      const resultado = await disponibilidadPorSucursalDeProducto(noDisponibleEnNinguna, prisma);
      expect(resultado).toHaveLength(2);
      expect(resultado.find((r) => r.sucursalId === sucursalA)?.disponible).toBe(false);
      expect(resultado.find((r) => r.sucursalId === sucursalB)?.disponible).toBe(false); // sin fila
    });

    it("distingue disponible de no disponible por sucursal", async () => {
      const resultado = await disponibilidadPorSucursalDeProducto(disponibleSoloEnA, prisma);
      expect(resultado.find((r) => r.sucursalId === sucursalA)?.disponible).toBe(true);
      expect(resultado.find((r) => r.sucursalId === sucursalB)?.disponible).toBe(false);
    });
  });
});
