import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { generarReporteSaludPorProducto } from "../../src/server/consultas/reportes/salud-por-producto";

describe("generarReporteSaludPorProducto", () => {
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

  it("una MP con movimientos pero sin receta vinculada dispara Atención aunque los otros 3 ejes estén bien", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Sin receta", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const filas = await generarReporteSaludPorProducto(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === mp.id)!;
    expect(fila.sinRecetaVinculada).toBe(true);
    expect(fila.resumen).toBe("Atención");
  });

  it("marca OK cuando los 4 ejes están bien: conciliado, sin alerta, receta vinculada, sin diferencias que revisar", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 10, fechaConteo: new Date(), accion: "AJUSTAR" }); // diferencia 0 -> CONCILIADO

    const filas = await generarReporteSaludPorProducto(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === mp.id)!;
    expect(fila.estadoConsolidado).toBe("CONCILIADO");
    expect(fila.estadoAlerta).toBe("OK");
    expect(fila.sinRecetaVinculada).toBe(false);
    expect(fila.resumen).toBe("OK");
  });
});
