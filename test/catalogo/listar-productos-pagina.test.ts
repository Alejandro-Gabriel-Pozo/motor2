import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { listarProductosPagina } from "../../src/server/actions/catalogo/productos";

/**
 * `disponibleAca`/`sucursalesDisponibles`/`totalSucursales` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10/P10)
 * — batch sin N+1 sobre la página entera, ver listarProductosPagina.
 */
describe("listarProductosPagina", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("disponibleAca refleja la sucursal ACTIVA de quien mira la lista, no el activo global", async () => {
    const universal = await sembrarProductoDisponible({ codigo: "PV_UNI", nombre: "Universal", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);
    const soloEnOtra = await prisma.producto.create({ data: { codigo: "PV_OTRA", nombre: "Solo en otra", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: soloEnOtra.id, disponible: true } });

    const pagina = await listarProductosPagina();
    expect(pagina.items.find((p) => p.id === universal.id)?.disponibleAca).toBe(true);
    expect(pagina.items.find((p) => p.id === soloEnOtra.id)?.disponibleAca).toBe(false);
  });

  it("sucursalesDisponibles/totalSucursales cuentan sobre TODAS las sucursales activas, no solo la propia", async () => {
    const universal = await sembrarProductoDisponible({ codigo: "PV_UNI2", nombre: "Universal 2", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: universal.id, disponible: true } });
    const soloUna = await sembrarProductoDisponible({ codigo: "PV_SOLA", nombre: "Solo acá", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);

    const pagina = await listarProductosPagina();
    const filaUniversal = pagina.items.find((p) => p.id === universal.id)!;
    const filaSoloUna = pagina.items.find((p) => p.id === soloUna.id)!;
    expect(filaUniversal.totalSucursales).toBe(2);
    expect(filaUniversal.sucursalesDisponibles).toBe(2);
    expect(filaSoloUna.sucursalesDisponibles).toBe(1);
  });
});
