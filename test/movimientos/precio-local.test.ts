import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../src/server/actions/movimientos/precio-local";

/**
 * Precio local (docs/plan-validacion-de-datos-2026-09-25.md, Paso D): las dos acciones validan el precio con `validarImporte`, la misma
 * función que usa el formulario. Antes: un NaN decía "no puede ser negativo" (el `!(precio >= 0)` iba antes que el chequeo de número) y
 * un precio con más de 2 decimales se guardaba (lo redondeaba la columna Decimal(14,2) en silencio).
 */
describe("precio local: validación del precio (src/core/datos)", () => {
  let sucursalId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "PL_COCA", nombre: "Coca-Cola 500cc", tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id;
  });

  const filas = () => prisma.precioLocalProducto.count({ where: { productoId } });

  describe("setPrecioLocalProducto", () => {
    it("NaN → 'El precio no es un número válido.' (antes decía 'no puede ser negativo'), sin guardar", async () => {
      expect(await setPrecioLocalProducto(productoId, Number.NaN, true)).toEqual({ ok: false, mensaje: "El precio no es un número válido." });
      expect(await filas()).toBe(0);
    });

    it("más de 2 decimales (10.555) → error, sin guardar (antes lo redondeaba la columna)", async () => {
      expect(await setPrecioLocalProducto(productoId, 10.555, true)).toEqual({ ok: false, mensaje: "El precio admite como máximo 2 decimales." });
      expect(await filas()).toBe(0);
    });

    it("sin precio (undefined) → 'Falta el precio.', sin guardar", async () => {
      expect(await setPrecioLocalProducto(productoId, undefined as unknown as number, true)).toEqual({ ok: false, mensaje: "Falta el precio." });
      expect(await filas()).toBe(0);
    });

    it("negativo → 'El precio no puede ser negativo.' (mismo mensaje de siempre)", async () => {
      expect(await setPrecioLocalProducto(productoId, -1, true)).toEqual({ ok: false, mensaje: "El precio no puede ser negativo." });
      expect(await filas()).toBe(0);
    });

    it("Infinity → 'El precio no es un número válido.'", async () => {
      expect(await setPrecioLocalProducto(productoId, Number.POSITIVE_INFINITY, true)).toEqual({ ok: false, mensaje: "El precio no es un número válido." });
      expect(await filas()).toBe(0);
    });

    it("un precio válido con 2 decimales (y el 0) se guardan", async () => {
      const r = await setPrecioLocalProducto(productoId, 1234.56, true);
      expect(r).toEqual({ ok: true, mensaje: 'Precio local de "Coca-Cola 500cc" fijado en 1234.56.' });
      expect(Number((await prisma.precioLocalProducto.findFirstOrThrow({ where: { productoId } })).precio)).toBe(1234.56);
      expect((await setPrecioLocalProducto(productoId, 0, true)).ok).toBe(true);
    });
  });

  describe("sincronizarPrecioLocalGrupoCarta", () => {
    it("NaN → 'El precio no es un número válido.', sin guardar", async () => {
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [productoId], Number.NaN, true)).toEqual({ ok: false, mensaje: "El precio no es un número válido." });
      expect(await filas()).toBe(0);
    });

    it("más de 2 decimales → error, sin guardar", async () => {
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [productoId], 10.555, true)).toEqual({ ok: false, mensaje: "El precio admite como máximo 2 decimales." });
      expect(await filas()).toBe(0);
    });

    it("sin precio (undefined) → 'Falta el precio.'", async () => {
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [productoId], undefined as unknown as number, true)).toEqual({ ok: false, mensaje: "Falta el precio." });
    });

    it("negativo → 'El precio no puede ser negativo.' (mismo mensaje de siempre)", async () => {
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [productoId], -1, true)).toEqual({ ok: false, mensaje: "El precio no puede ser negativo." });
    });
  });
});
