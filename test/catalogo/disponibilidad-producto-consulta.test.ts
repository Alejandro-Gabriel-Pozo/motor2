import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { whereDisponibleEn, whereDisponibleEnAlguna } from "../../src/core/catalogo/public";
import { productoDisponibleEn, disponibilidadDeProductos, disponibilidadDeProductosEnSucursales } from "../../src/server/lecturas/catalogo/disponibilidad";
import { disponibilidadDeProductoEnSucursales, disponibilidadPorSucursalDeProducto } from "../../src/server/consultas/catalogo/disponibilidad";

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

  describe("disponibilidadDeProductosEnSucursales (O.38b, D3: varias sucursales en una consulta)", () => {
    const todos = () => [disponibleSoloEnA, disponibleEnLasDos, noDisponibleEnNinguna];

    it("da, para CADA sucursal, lo mismo que la de una sucursal (fila en false y sin fila: false), en una sola consulta", async () => {
      let consultas = 0;
      const db = prisma.$extends({
        query: {
          disponibilidadProducto: {
            findMany({ args, query }) {
              consultas += 1;
              return query(args);
            },
          },
        },
      }) as unknown as typeof prisma;
      const resultado = await disponibilidadDeProductosEnSucursales([sucursalA, sucursalB], todos(), db);
      expect(consultas).toBe(1);
      expect([...resultado.keys()]).toEqual([sucursalA, sucursalB]);
      expect(Object.fromEntries(resultado.get(sucursalA)!)).toEqual({ [disponibleSoloEnA]: true, [disponibleEnLasDos]: true, [noDisponibleEnNinguna]: false });
      expect(Object.fromEntries(resultado.get(sucursalB)!)).toEqual({ [disponibleSoloEnA]: false, [disponibleEnLasDos]: true, [noDisponibleEnNinguna]: false });
      for (const s of [sucursalA, sucursalB]) expect(resultado.get(s)).toEqual(await disponibilidadDeProductos(s, todos(), prisma));
    });

    it("sin productos no consulta y cada sucursal sale con un Map vacío", async () => {
      const resultado = await disponibilidadDeProductosEnSucursales([sucursalA, sucursalB], [], prisma);
      expect([...resultado.entries()].map(([s, m]) => [s, m.size])).toEqual([
        [sucursalA, 0],
        [sucursalB, 0],
      ]);
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

  describe("disponibilidadDeProductoEnSucursales (editor de recetas: solo las sucursales que se le pasan y donde el usuario tiene membresía)", () => {
    let gerenteId: string;
    let soloAId: string;
    beforeEach(async () => {
      const rol = await prisma.rol.create({ data: { nombre: "rol" } });
      gerenteId = (await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: sucursalA, rolId: rol.id })).id;
      await crearMembresia({ usuarioId: gerenteId, sucursalId: sucursalB, rolId: rol.id });
      soloAId = (await crearUsuarioConMembresia({ email: "solo-a@test.com", sucursalId: sucursalA, rolId: rol.id })).id;
    });

    it("trae el estado SOLO de las sucursales pedidas, ordenadas por nombre; las demás no salen aunque tengan fila", async () => {
      const soloA = await disponibilidadDeProductoEnSucursales(disponibleEnLasDos, gerenteId, [sucursalA], prisma);
      expect(soloA).toEqual([{ sucursalId: sucursalA, sucursalNombre: "Sucursal A", disponible: true }]);
      const ambas = await disponibilidadDeProductoEnSucursales(disponibleSoloEnA, gerenteId, [sucursalB, sucursalA], prisma);
      expect(ambas.map((r) => [r.sucursalNombre, r.disponible])).toEqual([["Sucursal A", true], ["Sucursal B", false]]);
    });

    it("la sucursal pedida sin fila propia cuenta como no disponible, y un id que no es de una sucursal activa de la empresa no devuelve nada", async () => {
      const inactiva = (await prisma.sucursal.create({ data: { nombre: "Cerrada", activo: false } })).id;
      const resultado = await disponibilidadDeProductoEnSucursales(noDisponibleEnNinguna, gerenteId, [sucursalB, inactiva, "no-existe"], prisma);
      expect(resultado).toEqual([{ sucursalId: sucursalB, sucursalNombre: "Sucursal B", disponible: false }]);
    });

    it("un id de una sucursal donde el usuario NO tiene membresía vigente no suma nada aunque se lo pasen (segunda llave)", async () => {
      expect((await disponibilidadDeProductoEnSucursales(disponibleEnLasDos, soloAId, [sucursalA, sucursalB], prisma)).map((r) => r.sucursalId)).toEqual([sucursalA]);
      await prisma.usuarioSucursal.updateMany({ where: { usuarioId: gerenteId, sucursalId: sucursalB }, data: { activo: false } });
      expect((await disponibilidadDeProductoEnSucursales(disponibleEnLasDos, gerenteId, [sucursalA, sucursalB], prisma)).map((r) => r.sucursalId)).toEqual([sucursalA]);
    });

    it("sin sucursales no lee nada: devuelve [] (no «todas»)", async () => {
      await expect(disponibilidadDeProductoEnSucursales(disponibleEnLasDos, gerenteId, [], prisma)).resolves.toEqual([]);
    });
  });
});
