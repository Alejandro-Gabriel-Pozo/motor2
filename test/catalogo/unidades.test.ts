import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarDecimalesUnidad, crearUnidad } from "../../src/server/actions/catalogo/unidades";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";

/** Catálogo de Unidades (src/server/actions/catalogo/unidades.ts). */
describe("actualizarDecimalesUnidad", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("baja libremente si ningún producto 'se produce' con pasoVenta usa la unidad", async () => {
    const r1 = await crearUnidad({ nombre: "unidad", magnitud: "CANTIDAD", decimales: 2 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    expect(await actualizarDecimalesUnidad(r1.id, 0)).toEqual({ ok: true, mensaje: "Decimales actualizados." });
    expect((await prisma.unidad.findUniqueOrThrow({ where: { id: r1.id } })).decimales).toBe(0);
  });

  it("baja libremente si el producto con paso NO 'se produce' (sin stock real, R3 no aplica)", async () => {
    const unidad = await crearUnidad({ nombre: "unidad", magnitud: "CANTIDAD", decimales: 2 });
    if (!unidad.ok) return;
    await darDeAltaProducto({ nombre: "Pizza al momento", tipo: "PV", unidadStockId: unidad.id, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });

    expect((await actualizarDecimalesUnidad(unidad.id, 0)).ok).toBe(true);
  });

  it("R3 (transición b): rechaza bajar los decimales si un producto 'se produce' con pasoVenta quedaría inconsistente", async () => {
    const unidad = await crearUnidad({ nombre: "unidad", magnitud: "CANTIDAD", decimales: 1 });
    if (!unidad.ok) return;
    const producto = await darDeAltaProducto({
      nombre: "Pizza producida",
      tipo: "PV",
      unidadStockId: unidad.id,
      factorConversion: 1,
      precioVenta: 12000,
      pasoVenta: 0.5,
      seProduce: true,
    });
    expect(producto.ok).toBe(true);

    const r = await actualizarDecimalesUnidad(unidad.id, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toContain("Pizza producida");
    expect((await prisma.unidad.findUniqueOrThrow({ where: { id: unidad.id } })).decimales).toBe(1); // no se tocó
  });

  it("R3: bajar a decimales que SIGUEN alcanzando para el paso no se bloquea", async () => {
    const unidad = await crearUnidad({ nombre: "unidad", magnitud: "CANTIDAD", decimales: 3 });
    if (!unidad.ok) return;
    await darDeAltaProducto({
      nombre: "Pizza producida",
      tipo: "PV",
      unidadStockId: unidad.id,
      factorConversion: 1,
      precioVenta: 12000,
      pasoVenta: 0.5,
      seProduce: true,
    });

    expect((await actualizarDecimalesUnidad(unidad.id, 1)).ok).toBe(true);
  });
});
