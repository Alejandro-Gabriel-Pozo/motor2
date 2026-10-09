import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `test/catalogo/precio-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la
 * N-ésima llamada a `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió. El resto delega en la implementación real. El caso de uso importa
 * `registrarCambioAuditado` de `@/server/auditoria/registrar-cambio-auditado`, el mismo módulo que reemplaza este `vi.mock`.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) {
        throw new Error("auditoría caída (simulada)");
      }
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import { guardarPrecioLocalPromoCarta, guardarPromoCarta } from "../../src/server/actions/carta/promos";

/**
 * Dinero de la carta y su auditoría, atómicos (Hito 4, bloque 4.2): el cambio y su fila de auditoría van en UNA transacción del caso de uso. Si la auditoría
 * falla, no queda NADA: ni el valor nuevo ni la fila de auditoría (descuento de producto desde H4C-1; alta, edición y precio local de una promo desde H4C-2). Nació en H4C-1 porque la mutación «auditoría en otra transacción» del caso de uso del descuento
 * no la veía ningún test (la huella de dinero solo mira el camino feliz: con la auditoría fuera de la transacción las filas finales son las mismas).
 */
describe("dinero de carta: el cambio y su auditoría son atómicos", () => {
  let flanId: string;

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    flanId = (await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: u.id, precioVenta: 3000 }, base.sucursal.id)).id;
    interruptor.llamadas = 0;
  });

  const porcentajes = async () => (await prismaAdmin.descuentoProductoSucursal.findMany()).map((d) => Number(d.porcentaje));

  it("descuento: si falla la auditoría del alta, no queda la fila", async () => {
    interruptor.fallarEnLlamada = 1;
    await expect(guardarDescuentoProducto(flanId, 15)).rejects.toThrow("auditoría caída");
    expect(await porcentajes()).toEqual([]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("descuento: si falla la auditoría del cambio, queda el % anterior", async () => {
    expect((await guardarDescuentoProducto(flanId, 10)).ok).toBe(true);
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 1;
    await expect(guardarDescuentoProducto(flanId, 20)).rejects.toThrow("auditoría caída");
    expect(await porcentajes()).toEqual([10]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });

  it("descuento: si falla la auditoría del borrado, la fila sigue", async () => {
    expect((await guardarDescuentoProducto(flanId, 10)).ok).toBe(true);
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 1;
    await expect(guardarDescuentoProducto(flanId, null)).rejects.toThrow("auditoría caída");
    expect(await porcentajes()).toEqual([10]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });

  it("promo: si falla la auditoría del alta, no queda la promo ni su fila de la sucursal", async () => {
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    interruptor.fallarEnLlamada = 1;
    await expect(guardarPromoCarta({ seccionCartaId: seccion.id, titulo: "Combo", precio: 8000 })).rejects.toThrow("auditoría caída");
    expect(await prismaAdmin.promoCarta.count()).toBe(0);
    expect(await prismaAdmin.promoCartaSucursal.count()).toBe(0);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("promo: si falla la auditoría del cambio de precio, la promo queda como estaba", async () => {
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Combo", precio: 8000 } });
    interruptor.fallarEnLlamada = 1;
    await expect(guardarPromoCarta({ id: promo.id, seccionCartaId: seccion.id, titulo: "Combo grande", precio: 9000 })).rejects.toThrow("auditoría caída");
    const despues = await prismaAdmin.promoCarta.findUniqueOrThrow({ where: { id: promo.id } });
    expect([despues.titulo, Number(despues.precio)]).toEqual(["Combo", 8000]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("promo: si falla la auditoría del precio local, no queda el precio (ni la fila nueva de la sucursal)", async () => {
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Combo", precio: 8000 } });
    interruptor.fallarEnLlamada = 1;
    await expect(guardarPrecioLocalPromoCarta(promo.id, 7000)).rejects.toThrow("auditoría caída");
    expect(await prismaAdmin.promoCartaSucursal.count()).toBe(0);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("control: sin falla, el cambio y su auditoría quedan", async () => {
    expect((await guardarDescuentoProducto(flanId, 15)).ok).toBe(true);
    expect(await porcentajes()).toEqual([15]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });
});
