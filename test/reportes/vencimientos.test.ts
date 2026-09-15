import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/conteo-fisico";
import { generarReporteLotesProximosAVencer, generarConciliacionVencimientos } from "../../src/core/reportes/vencimientos";

describe("Reporte de vencimientos", () => {
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

  it("lotes próximos a vencer: filtra por días e incluye los ya vencidos", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const enTresDias = new Date(hoy.getTime() + 3 * 86400000);
    const enTreintaDias = new Date(hoy.getTime() + 30 * 86400000);
    const ayer = new Date(hoy.getTime() - 86400000);

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, loteVencimiento: enTresDias }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, loteVencimiento: enTreintaDias }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5, loteVencimiento: ayer }] });

    const filas = await generarReporteLotesProximosAVencer(sucursalId, 7);
    const lotes = filas.map((f) => f.loteVencimiento.toISOString().slice(0, 10));
    expect(lotes).toContain(enTresDias.toISOString().slice(0, 10));
    expect(lotes).toContain(ayer.toISOString().slice(0, 10));
    expect(lotes).not.toContain(enTreintaDias.toISOString().slice(0, 10));
    expect(filas.find((f) => f.loteVencimiento.getTime() === ayer.getTime())?.diasParaVencer).toBeLessThan(0);
  });

  it("conciliación: consumo del período cubre lo contado → consistente", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const lote = new Date("2026-02-10");

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, loteVencimiento: lote }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: 10, fechaConteo: new Date("2026-01-01"), accion: "AJUSTAR" });

    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date("2026-01-02"), seccionId, destino: "ELABORACION_INTERNA", items: [{ productoId: mp.id, cantidad: 10, loteVencimiento: lote }] });

    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: 0, fechaConteo: new Date("2026-01-03"), accion: "AJUSTAR" });

    const conciliacion = await generarConciliacionVencimientos(sucursalId);
    const fila = conciliacion.find((c) => c.productoNombre === "Harina")!;
    expect(fila.estado).toBe("consistente");
    expect(fila.ventasPeriodo).toBe(10);
  });

  it("conciliación: el lote desaparece sin que las ventas+consumos del período lo expliquen → revisar", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const lote = new Date("2026-02-10");

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, loteVencimiento: lote }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: 10, fechaConteo: new Date("2026-01-01"), accion: "AJUSTAR" });

    // Solo se consumieron 3 de los 10 — el resto se "perdió" sin dejar rastro.
    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date("2026-01-02"), seccionId, destino: "ELABORACION_INTERNA", items: [{ productoId: mp.id, cantidad: 3, loteVencimiento: lote }] });

    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: 0, fechaConteo: new Date("2026-01-03"), accion: "AJUSTAR" });

    const conciliacion = await generarConciliacionVencimientos(sucursalId);
    const fila = conciliacion.find((c) => c.productoNombre === "Harina")!;
    expect(fila.estado).toBe("revisar");
    expect(fila.ventasPeriodo).toBe(3);
  });
});
