import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteVentasSinReceta } from "../../src/core/reportes/ventas-sin-receta";

describe("generarReporteVentasSinReceta", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("detecta el corte: PV sin receta cargada aparece, PV con receta (que sí generó consumo) no", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const conReceta = await sembrarProductoDisponible({ codigo: "PV_CON", nombre: "Con receta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const sinReceta = await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin receta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: conReceta.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: conReceta.id, cantidadVendida: 1 }] }); // sí genera consumo: no debe aparecer
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: sinReceta.id, cantidadVendida: 1 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: sinReceta.id, cantidadVendida: 1 }] });

    const filas = await generarReporteVentasSinReceta(sucursalId);
    expect(filas.find((f) => f.productoId === sinReceta.id)?.cantidadVentasSinReceta).toBe(2);
    expect(filas.find((f) => f.productoId === conReceta.id)).toBeUndefined();
  });
});
