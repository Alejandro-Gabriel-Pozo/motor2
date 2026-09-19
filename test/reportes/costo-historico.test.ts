import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { costosDeInsumosPorDia } from "../../src/core/reportes/costo-historico";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";

/**
 * «Margen real» con datos que no guardaron el costo al venderse: se reconstruye al día de la venta con el historial de compras
 * (precio de la compra más reciente de cada insumo HASTA ESE DÍA, con la receta de hoy).
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("costosDeInsumosPorDia (puro)", () => {
  const compras = [
    { productoId: "harina", fecha: d("2026-08-01"), precioPorUnidadStock: 5 },
    { productoId: "harina", fecha: d("2026-08-03"), precioPorUnidadStock: 8 },
    { productoId: "queso", fecha: d("2026-08-03"), precioPorUnidadStock: 20 },
  ];

  it("cada día ve el precio de la compra más reciente hasta ese día, inclusive", () => {
    const r = costosDeInsumosPorDia(compras, ["2026-08-04", "2026-07-31", "2026-08-02", "2026-08-03"]);
    expect(r.get("2026-07-31")?.get("harina")).toBeUndefined(); // todavía no se había comprado
    expect(r.get("2026-08-02")?.get("harina")?.precioPorUnidadStock).toBe(5);
    expect(r.get("2026-08-03")?.get("harina")?.precioPorUnidadStock).toBe(8); // la compra del mismo día cuenta
    expect(r.get("2026-08-03")?.get("queso")?.precioPorUnidadStock).toBe(20);
    expect(r.get("2026-08-04")?.get("harina")?.precioPorUnidadStock).toBe(8);
  });

  it("no depende del orden en que llegan las compras ni los días", () => {
    const r = costosDeInsumosPorDia([...compras].reverse(), ["2026-08-04", "2026-08-02"]);
    expect(r.get("2026-08-02")?.get("harina")?.precioPorUnidadStock).toBe(5);
    expect(r.get("2026-08-04")?.get("harina")?.precioPorUnidadStock).toBe(8);
  });

  it("un día no altera el de otro (cada uno tiene su propia foto)", () => {
    const r = costosDeInsumosPorDia(compras, ["2026-08-02", "2026-08-04"]);
    expect(r.get("2026-08-02")?.has("queso")).toBe(false);
    expect(r.get("2026-08-04")?.has("queso")).toBe(true);
  });
});

describe("Margen real reconstruido en el reporte por período", () => {
  let sucursalId: string;
  let seccionId: string;
  let pvId: string;
  let harinaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const harina = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id } });
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kg.id }] } } });
    pvId = pan.id;
    harinaId = harina.id;
    // 10 kg a $5 el kilo el 1/8, y 10 kg a $8 el kilo el 3/8.
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-01"), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-03"), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 80 }] });
  });

  async function vender(dia: string) {
    const r = await registrarVenta({ fecha: d(dia), seccionId, ventas: [{ productoId: pvId, cantidadVendida: 1 }] });
    expect(r.ok, r.mensaje).toBe(true);
  }

  it("cada venta se costea con el precio vigente ese día; la anterior a toda compra queda afuera", async () => {
    await vender("2026-07-31"); // antes de la primera compra: no se puede costear
    await vender("2026-08-02"); // harina a $5 → 2 kg = $10
    await vender("2026-08-04"); // harina a $8 → 2 kg = $16
    await prisma.movimientoStock.updateMany({ where: { productoId: pvId, operacion: { proceso: "VENTA" } }, data: { costoUnitarioVenta: null } }); // como si nunca lo hubieran guardado

    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-07-30"), d("2026-08-05"));

    expect(rep.margen.ingresoRealReconstruido).toBe(200);
    expect(rep.margen.ingresoConCostoReal).toBe(200);
    expect(rep.margen.ingresoSinCostoReal).toBe(100);
    expect(rep.margen.margenRealTotal).toBe(200 - (10 + 16));
    expect(rep.margen.avisoReal).toContain("RECONSTRUIDO");
    expect(rep.margen.avisoReal).toContain("No se pudo costear");
  });

  it("si la venta guardó su costo, ese manda y no se reconstruye", async () => {
    await vender("2026-08-04"); // guarda el costo de la receta con el costo vigente al vender ($8/kg → $16)
    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-05"));

    expect(rep.margen.ingresoRealReconstruido).toBe(0);
    expect(rep.margen.ingresoConCostoReal).toBe(100);
    expect(rep.margen.margenRealTotal).toBe(100 - 16);
    expect(rep.margen.avisoReal).not.toContain("RECONSTRUIDO");
  });

  it("sin ninguna venta costeable, «Real» sigue sin datos", async () => {
    await vender("2026-07-31");
    await prisma.movimientoStock.updateMany({ where: { productoId: pvId, operacion: { proceso: "VENTA" } }, data: { costoUnitarioVenta: null } });
    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-07-30"), d("2026-08-05"));

    expect(rep.margen.margenRealTotal).toBeNull();
    expect(rep.margen.ingresoSinCostoReal).toBe(100);
  });
});
