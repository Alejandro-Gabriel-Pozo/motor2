import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `upsertProveedorPorProducto` (paso 6, Compra) es best-effort a propósito: el Kardex ya quedó bien escrito, esto solo
// alimenta la comparativa de precios de Catálogo — un fallo acá NUNCA debería tirar abajo una Compra que ya se guardó.
// Se mockea SOLO en este archivo (no en registrar-movimiento.test.ts, que sí necesita el upsert real contra Postgres
// para sus propios tests de ProveedorPorProducto) para forzar un rechazo con un valor NO-Error — algo que un `catch`
// nunca puede descartar de antemano (una excepción real de Prisma siempre es `instanceof Error`, así que esta carrera
// solo se puede ejercitar inyectando el rechazo, no esperando a que ocurra sola).
vi.mock("../../src/server/persistencia/catalogo/upsert-proveedor-por-producto", () => ({
  upsertProveedorPorProducto: vi.fn().mockRejectedValue(null),
}));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Backlog post-cierre de Task #41 (2026-09-28, docs/pendientes-sesion-2026-09-27.md §5): el catch de
 * `registrarProveedoresDeLaCompra` (src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts) usaba
 * `(e as Error).message` — con un valor rechazado `null`/`undefined` (no una excepción real, que siempre es
 * `instanceof Error`) eso revienta con un TypeError SEGUNDO, dentro del propio `catch`, que nada más adelante atrapa:
 * la Compra ya había escrito el Kardex con éxito, pero la respuesta al usuario terminaba en un error 500 por un
 * hookup best-effort de Catálogo que ni siquiera debería poder afectar el resultado.
 */
describe("registrarMovimiento — paso 6 (Compra): un rechazo NO-Error de upsertProveedorPorProducto no tira abajo una Compra ya escrita", () => {
  let sucursalId: string;
  let seccionAId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    await sembrarMotivosYDestinos();
    const seccionA = await sembrarSeccion(sucursalId, "Depósito A");
    seccionAId = seccionA.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("la Compra sigue OK (el Kardex ya se escribió) aunque el hookup de Catálogo rechace con null en vez de una excepción real", async () => {
    const mp = await sembrarProductoDisponible(
      { codigo: "MP_HARINA_HOOKUP", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId },
      sucursalId
    );
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_HOOKUP", nombre: "Distribuidora Hookup" } });

    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, proveedorId: proveedor.id,
      items: [{ productoId: mp.id, cantidad: 10, precioTotal: 1000 }],
    });

    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(10); // el Kardex se escribió igual, best-effort no lo afectó
    expect(await prisma.proveedorPorProducto.count({ where: { productoId: mp.id } })).toBe(0); // el hookup mockeado nunca escribió
  });
});
