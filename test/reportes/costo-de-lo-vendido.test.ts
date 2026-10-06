import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";

/**
 * 6b: «Costo de lo vendido (consumo)» junto al ratio Compras/Ventas (desembolso). El numerador es el costo congelado al vender (o reconstruido con el
 * historial de compras) de cada línea COSTEABLE; el denominador es lo vendido que se pudo costear (`ingresoConCostoReal`), nunca el total facturado.
 *
 * Fixtures: un kg de harina cuesta $5 (10 kg por $50); un pan lleva 2 kg → cuesta $10 y se vende a $100.
 */
describe("costo de lo vendido (consumo) del período", () => {
  let sucursalId: string;
  let seccionId: string;
  let kgId: string;
  let adminId: string;
  let harinaId: string;
  let panId: string;

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const agosto = () => obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-31"), undefined, prisma);

  async function comprarHarina(fecha: string, cantidad = 10, precioTotal = 50) {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: d(fecha), seccionId, items: [{ productoId: harinaId, cantidad, precioTotal }] });
    expect(r.ok, r.mensaje).toBe(true);
  }

  async function venderPan(fecha: string, cantidadVendida = 1) {
    const r = await registrarVenta({ fecha: d(fecha), seccionId, ventas: [{ productoId: panId, cantidadVendida }] });
    expect(r.ok, r.mensaje).toBe(true);
  }

  /** Una venta cargada directo en la base (como las viejas o las de la demo): sin pasar por registrarVenta, para controlar el precio y el costo congelado. */
  async function ventaDirecta(productoId: string, fecha: string, opciones: { cantidad: number; precioTotal: number; costoUnitarioVenta: number | null }) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: d(fecha), usuarioId: adminId } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: op.id,
        productoId,
        seccionId,
        proceso: "VENTA",
        cantidad: -opciones.cantidad,
        detalle: "Venta",
        precioTotal: opciones.precioTotal,
        precioPorUnidadStock: opciones.cantidad > 0 ? opciones.precioTotal / opciones.cantidad : 0,
        costoUnitarioVenta: opciones.costoUnitarioVenta,
      },
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prisma.insumo.deleteMany();
    await prisma.grupo.deleteMany();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, sucursalId)).id;
    panId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, sucursalId)).id;
    await prisma.recetaVersion.create({ data: { productoId: panId, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 2, unidadId: kgId }] } } });
  });

  it("con todo lo vendido costeable: el costo, su porcentaje sobre lo vendido y la cobertura completa", async () => {
    await comprarHarina("2026-08-05");
    await venderPan("2026-08-06", 3);

    const { margen } = await agosto();

    expect(margen.costoDeLoVendidoTotal).toBe(30); // 3 panes × $10
    expect(margen.costoDeLoVendidoPctTotal).toBe(10); // $30 de costo sobre $300 vendidos
    expect(margen.coberturaCostoRealPct).toBe(100);
    expect(margen.ventasSinPrecioExcluidas).toBe(0);
    // La identidad que une el costo de lo vendido con el margen real (cada número se redondea por separado).
    expect(margen.costoDeLoVendidoTotal!).toBeCloseTo(margen.ingresoConCostoReal - margen.margenRealTotal!, 2);
    expect(margen.costoDeLoVendidoPctTotal! + margen.margenRealPctTotal!).toBeCloseTo(100, 1);
  });

  it("con cobertura PARCIAL, el porcentaje es sobre lo que se pudo costear y NO sobre el total facturado", async () => {
    // Una venta ANTERIOR a cualquier compra de harina: no se puede costear. Después, una compra y una venta que sí.
    await ventaDirecta(panId, "2026-08-02", { cantidad: 1, precioTotal: 100, costoUnitarioVenta: null });
    await comprarHarina("2026-08-05");
    await venderPan("2026-08-06", 1);

    const { margen, ventas } = await agosto();

    expect(ventas.totalFacturado).toBe(200);
    expect(margen.ingresoConCostoReal).toBe(100);
    expect(margen.ingresoSinCostoReal).toBe(100);
    expect(margen.coberturaCostoRealPct).toBe(50);
    expect(margen.costoDeLoVendidoTotal).toBe(10);
    // 10 / 100 (lo costeable) = 10 %. Dividir por el total facturado (10 / 200 = 5 %) daría un food cost artificialmente bajo.
    expect(margen.costoDeLoVendidoPctTotal).toBe(10);
    expect(margen.costoDeLoVendidoPctTotal).not.toBeCloseTo((margen.costoDeLoVendidoTotal! / ventas.totalFacturado) * 100, 1);
    expect(margen.costoDeLoVendidoPctTotal).toBeCloseTo((margen.costoDeLoVendidoTotal! / margen.ingresoConCostoReal) * 100, 1);
    expect(margen.avisoCostoDeLoVendido).toContain("Cubre $100 de $200 vendidos (50 %)");
    expect(margen.avisoCostoDeLoVendido).toContain("no se pudo costear");
  });

  it("sin ninguna venta costeable: todo en null, la cobertura en 0 y un aviso que lo explica", async () => {
    const sinReceta = await sembrarProductoDisponible({ codigo: "PV_SIN_RECETA", nombre: "Plato sin receta", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, sucursalId);
    await ventaDirecta(sinReceta.id, "2026-08-06", { cantidad: 1, precioTotal: 100, costoUnitarioVenta: null });

    const { margen } = await agosto();

    expect(margen.costoDeLoVendidoTotal).toBeNull();
    expect(margen.costoDeLoVendidoPctTotal).toBeNull();
    expect(margen.margenRealTotal).toBeNull();
    expect(margen.coberturaCostoRealPct).toBe(0);
    expect(margen.avisoCostoDeLoVendido).toContain("Todavía no hay ventas que se puedan costear");
  });

  it("sin ventas en el período: todo en null y sin dividir por cero", async () => {
    await comprarHarina("2026-08-05");

    const { margen } = await agosto();

    expect(margen.costoDeLoVendidoTotal).toBeNull();
    expect(margen.costoDeLoVendidoPctTotal).toBeNull();
    expect(margen.coberturaCostoRealPct).toBeNull();
  });

  it("una venta que no guardó su costo pero se puede reconstruir con el historial de compras SÍ entra, y se marca como reconstruida", async () => {
    await comprarHarina("2026-08-05");
    await ventaDirecta(panId, "2026-08-06", { cantidad: 2, precioTotal: 200, costoUnitarioVenta: null });

    const { margen } = await agosto();

    expect(margen.costoDeLoVendidoTotal).toBe(20); // 2 panes × (2 kg × $5)
    expect(margen.costoDeLoVendidoPctTotal).toBe(10);
    expect(margen.ingresoRealReconstruido).toBe(200);
    expect(margen.coberturaCostoRealPct).toBe(100);
  });

  it("el guardián que justifica mostrar los dos números: una compra grande de stockeo dispara el ratio de compras sin mover el consumo", async () => {
    await comprarHarina("2026-08-05", 1000, 5000); // stockeo: $5000 de harina
    await venderPan("2026-08-06", 1); // se vende un solo pan

    const rep = await agosto();

    // Desembolso: $5000 comprados sobre $100 vendidos. Consumo: lo que costó ese único pan.
    expect(rep.ratioGastoVentas.porcentaje).toBe(5000);
    expect(rep.margen.costoDeLoVendidoPctTotal).toBe(10);
    expect(rep.margen.costoDeLoVendidoTotal).toBe(10);
  });

  it("el consumo INCLUYE el packaging que está en la receta, mientras el ratio de compras lo excluye (y el aviso lo dice)", async () => {
    const cajaId = (await sembrarProductoDisponible({ codigo: "MP_CAJA", nombre: "Caja de pizza", tipo: "MP", unidadStockId: kgId }, sucursalId)).id;
    const noComestibles = await prisma.grupo.create({ data: { nombre: "No comestibles" } });
    const insumoCajas = await prisma.insumo.create({ data: { nombre: "Cajas", grupoId: noComestibles.id } });
    await prisma.producto.update({ where: { id: cajaId }, data: { insumoId: insumoCajas.id } });
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, sucursalId);
    // 2 kg de harina ($5/kg) + 1 caja ($10): comida $10, packaging $10, costo total $20.
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 2, unidadId: kgId }, { insumoProductoId: cajaId, cantidad: 1, unidadId: kgId }] } },
    });
    await comprarHarina("2026-08-05"); // $50 de comida
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-05"), seccionId, items: [{ productoId: cajaId, cantidad: 10, precioTotal: 100 }] }); // $100 de packaging
    const v = await registrarVenta({ fecha: d("2026-08-06"), seccionId, ventas: [{ productoId: pizza.id, cantidadVendida: 1 }] });
    expect(v.ok, v.mensaje).toBe(true);

    const rep = await agosto();

    expect(rep.margen.costoDeLoVendidoTotal).toBe(20); // comida + packaging
    expect(rep.margen.costoDeLoVendidoPctTotal).toBe(20);
    expect(rep.ratioGastoVentas.excluyeNoComestibles).toBe(true);
    expect(rep.ratioGastoVentas.porcentaje).toBe(50); // solo los $50 de comida sobre $100 vendidos
    expect(rep.margen.avisoCostoDeLoVendido).toContain("Incluye el packaging");
  });

  describe("ventas cargadas sin precio (excluidas del margen real y del costo de lo vendido)", () => {
    it("no suman su costo sin su ingreso: el costo y el margen real no se deforman, y se cuenta cuántas quedaron afuera", async () => {
      await comprarHarina("2026-08-05");
      await venderPan("2026-08-06", 1); // $100 vendidos, costo $10
      // Una venta cargada sin precio pero con el costo congelado: antes sumaba $10 de costo y $0 de ingreso.
      await ventaDirecta(panId, "2026-08-07", { cantidad: 1, precioTotal: 0, costoUnitarioVenta: 10 });

      const { margen } = await agosto();

      expect(margen.ventasSinPrecioExcluidas).toBe(1);
      expect(margen.costoDeLoVendidoTotal).toBe(10); // con la sin precio serían 20
      expect(margen.ingresoConCostoReal).toBe(100);
      expect(margen.margenRealTotal).toBe(90); // con la sin precio serían 80
      expect(margen.costoDeLoVendidoPctTotal).toBe(10); // con la sin precio serían 20 %
      expect(margen.avisoCostoDeLoVendido).toContain("1 venta(s) cargada(s) sin precio no se cuentan");
      expect(margen.avisoReal).toContain("1 venta(s) cargada(s) sin precio no se cuentan");
    });

    it("una venta sin precio y sin costo guardado tampoco se reconstruye ni cuenta como «sin costear»", async () => {
      await comprarHarina("2026-08-05");
      await ventaDirecta(panId, "2026-08-06", { cantidad: 1, precioTotal: 0, costoUnitarioVenta: null });

      const { margen } = await agosto();

      expect(margen.ventasSinPrecioExcluidas).toBe(1);
      expect(margen.costoDeLoVendidoTotal).toBeNull();
      expect(margen.ingresoSinCostoReal).toBe(0);
      expect(margen.coberturaCostoRealPct).toBeNull();
    });

    it("el margen real por producto (el que lee Promociones) tampoco se deforma por una venta sin precio", async () => {
      await comprarHarina("2026-08-05");
      await venderPan("2026-08-06", 1);
      await ventaDirecta(panId, "2026-08-07", { cantidad: 1, precioTotal: 0, costoUnitarioVenta: 10 });

      const { margen } = await agosto();
      const fila = margen.porProducto.find((f) => f.productoId === panId)!;

      expect(fila.margenReal).toBe(90);
      expect(fila.margenRealPct).toBe(90);
    });
  });
});
