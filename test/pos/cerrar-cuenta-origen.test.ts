import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { registrarVentaEnTx, type OrigenVenta } from "../../src/core/movimientos/registrar-venta";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import { calcularStockConsolidado } from "../../src/core/stock/consolidado";

/**
 * De qué sección sale cada insumo al cerrar una cuenta (docs/plan-seccion-habitual-stock-2026-09-25.md, C5/C6): nadie la elige; el
 * núcleo de la venta recorre las secciones activas de la sucursal por vencimiento, con el libro que descuenta lo ya asignado. Una
 * sucursal de UNA sección queda exactamente igual que antes (cuando se la elegía a mano).
 */
describe("cerrarCuenta: sección de cada insumo resuelta sola", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const OCT = new Date("2026-10-01");
  const NOV = new Date("2026-11-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const comprar = (seccionId: string, productoId: string, cantidad: number, loteVencimiento?: Date) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId, cantidad, loteVencimiento }] });
  const movimientosDeLaMesa = () => prisma.movimientoStock.findMany({ where: { operacion: { proceso: "VENTA", detalleLibre: "Mesa 4" } }, orderBy: { creadoEn: "asc" } });
  const resumen = (filas: { proceso: string; productoId: string; seccionId: string; cantidad: unknown; loteVencimiento: Date | null }[]) =>
    filas.map((m) => [m.proceso, m.productoId, m.seccionId, Number(m.cantidad), m.loteVencimiento?.toISOString().slice(0, 10) ?? null]);

  it("sucursal de UNA sola sección: las filas del Kardex son idénticas a elegir esa sección a mano (consumo por lotes, consignación, PV que se produce, faltante)", async () => {
    const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Bodega" } });
    const vino = await sembrarProductoDisponible(
      { codigo: "MP_VINO", nombre: "Vino", tipo: "MP", unidadStockId: s.kg.id, esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 100 },
      s.sucursalId
    );
    const copa = await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 2000 }, s.sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: copa.id, version: 1, ingredientes: { create: [{ insumoProductoId: vino.id, cantidad: 0.15, unidadId: s.kg.id }] } } });
    const torta = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: s.unidad.id, seProduce: true, precioVenta: 5000 }, s.sucursalId);
    await comprar(s.seccion.id, s.muzzarella.id, 0.5, OCT);
    await comprar(s.seccion.id, s.muzzarella.id, 0.1, NOV);
    await comprar(s.seccion.id, vino.id, 2);
    await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId: torta.id, cantidad: 2, loteVencimiento: OCT }] });

    const actor = { usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: "Central" };
    const datos = (origen: OrigenVenta) => ({
      fecha: new Date("2026-09-25T12:00:00Z"),
      origen,
      detalle: "Mesa 4",
      lineas: [
        { productoId: s.pizza.id, cantidadVendida: 3, precioUnitario: 12000 },
        { productoId: copa.id, cantidadVendida: 2, precioUnitario: 2000 },
        { productoId: torta.id, cantidadVendida: 1, precioUnitario: 5000 },
        { productoId: s.pizza.id, cantidadVendida: 1, precioUnitario: 11000 },
      ],
    });
    const normalizar = (filas: Awaited<ReturnType<typeof movimientosDeLaMesa>>, operacionIds: string[]) =>
      filas
        .map((m) => JSON.stringify([operacionIds.indexOf(m.operacionId), m.proceso, m.productoId, m.seccionId, String(m.cantidad), m.loteVencimiento, m.detalle, String(m.precioTotal), String(m.precioPorUnidadStock), String(m.costoUnitarioVenta)]))
        .sort();

    // A mano (modo sección), dentro de una transacción que se deshace: la foto de "cómo era antes".
    let aMano: { filas: string[]; avisos: unknown } | null = null;
    await expect(
      prisma.$transaction(async (tx) => {
        const r = await registrarVentaEnTx(tx, actor, datos({ tipo: "seccion", seccionId: s.seccion.id }), { permitirStockNegativo: true });
        if (!r.ok) throw new Error(r.mensaje);
        aMano = { filas: normalizar(await tx.movimientoStock.findMany({ where: { operacionId: { in: r.operacionIds } } }), r.operacionIds), avisos: r.avisosStockNegativo };
        throw new Error("deshacer");
      })
    ).rejects.toThrow("deshacer");

    const r = await prisma.$transaction((tx) => registrarVentaEnTx(tx, actor, datos({ tipo: "automatico" }), { permitirStockNegativo: true }));
    if (!r.ok) throw new Error(r.mensaje);
    const automatico = normalizar(await prisma.movimientoStock.findMany({ where: { operacionId: { in: r.operacionIds } } }), r.operacionIds);
    expect(aMano).not.toBeNull();
    expect(automatico).toEqual(aMano!.filas);
    expect(r.avisosStockNegativo).toEqual(aMano!.avisos);
    // Y lo que dicen: muzza 1 kg contra 0,6 (queda en −0,4, lote NOV), vino consumido y liquidado, torta con su lote.
    expect(r.avisosStockNegativo).toEqual([{ productoId: s.muzzarella.id, nombre: "Muzzarella", seccionId: s.seccion.id, seccionNombre: "Salón", actual: 0.6, requerido: 1, resultante: -0.4 }]);
    expect(automatico).toHaveLength(9);
  });

  it("Cocina y Depósito, la muzza solo en Depósito: el consumo sale de Depósito, sin aviso, y la fila VENTA va ahí", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await comprar(deposito.id, s.muzzarella.id, 1);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);

    const r = await cerrarCuenta(cuenta.id);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain("⚠");
    expect(resumen(await movimientosDeLaMesa())).toEqual([
      ["CONSUMO", s.muzzarella.id, deposito.id, -0.5, null],
      ["VENTA", s.pizza.id, deposito.id, -2, null],
    ]);
    expect(await calcularSaldoTotal(s.muzzarella.id, deposito.id, prisma)).toBe(0.5);
    expect(await calcularSaldoTotal(s.muzzarella.id, cocina.id, prisma)).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("respaldo por vencimiento entre dos secciones: primero la que tiene el lote que vence antes, el resto de la otra", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await comprar(cocina.id, s.muzzarella.id, 0.3, NOV);
    await comprar(deposito.id, s.muzzarella.id, 0.3, OCT);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);

    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    expect(resumen(await movimientosDeLaMesa())).toEqual([
      ["CONSUMO", s.muzzarella.id, deposito.id, -0.3, "2026-10-01"],
      ["CONSUMO", s.muzzarella.id, cocina.id, -0.2, "2026-11-01"],
      ["VENTA", s.pizza.id, deposito.id, -2, null],
    ]);
  });

  it("anular una venta con consumos en dos secciones revierte cada uno en la suya", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await comprar(cocina.id, s.muzzarella.id, 0.3, NOV);
    await comprar(deposito.id, s.muzzarella.id, 0.3, OCT);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    await cerrarCuenta(cuenta.id);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", detalleLibre: "Mesa 4" } });

    expect((await anularVenta(venta.id)).ok).toBe(true);
    expect(await calcularSaldoTotal(s.muzzarella.id, cocina.id, prisma)).toBe(0.3);
    expect(await calcularSaldoTotal(s.muzzarella.id, deposito.id, prisma)).toBe(0.3);
    expect(await calcularSaldoTotal(s.pizza.id, deposito.id, prisma)).toBe(0);
    const reversion = await prisma.movimientoStock.findMany({ where: { operacion: { proceso: "AJUSTE" }, productoId: s.muzzarella.id } });
    expect(reversion.map((m) => [m.seccionId, Number(m.cantidad)]).sort()).toEqual([[cocina.id, 0.2], [deposito.id, 0.3]].sort());
  });

  describe("nada alcanza: el faltante va a la sección de referencia y el aviso/auditoría la nombran", () => {
    it("referencia = la del último movimiento del insumo", async () => {
      await sembrarSeccion(s.sucursalId, "Cocina");
      const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
      await comprar(deposito.id, s.muzzarella.id, 0.2);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);

      const r = await cerrarCuenta(cuenta.id);
      expect(r.mensaje).toContain('⚠ Quedó stock negativo: "Muzzarella" en «Depósito» (tenía 0,2, se consumió 0,5, quedó en -0,3).');
      expect(await calcularSaldoTotal(s.muzzarella.id, deposito.id, prisma)).toBe(-0.3);
      const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", detalleLibre: "Mesa 4" } });
      const [auditoria] = await prisma.registroAuditoria.findMany();
      expect(auditoria).toMatchObject({ entidad: "Operacion", entidadId: venta.id, campo: "saldoStock", valorAnterior: "0.2", valorNuevo: "-0.3" });
      expect(auditoria.descripcion).toBe(
        'Mesa 4: al cerrar la cuenta (admin@test.com) el stock de "Muzzarella" en «Depósito» quedó en negativo — tenía 0,2, la venta consumió 0,5, faltaron 0,3. La venta se registró igual; corregí el saldo con un Conteo Físico o un Ajuste.'
      );
    });

    it("sin ningún movimiento previo: la primera sección activa por nombre", async () => {
      const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
      await sembrarSeccion(s.sucursalId, "Depósito");
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
      const r = await cerrarCuenta(cuenta.id);
      expect(r.mensaje).toContain('"Muzzarella" en «Cocina» (tenía 0, se consumió 0,5, quedó en -0,5)');
      expect(resumen(await movimientosDeLaMesa())).toEqual([
        ["CONSUMO", s.muzzarella.id, cocina.id, -0.5, null],
        ["VENTA", s.pizza.id, cocina.id, -2, null],
      ]);
    });
  });

  it("consignación: la liquidación sale en la sección de cada parte consumida", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Bodega" } });
    const vino = await sembrarProductoDisponible(
      { codigo: "MP_VINO", nombre: "Vino", tipo: "MP", unidadStockId: s.kg.id, esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 100 },
      s.sucursalId
    );
    const copa = await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 2000 }, s.sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: copa.id, version: 1, ingredientes: { create: [{ insumoProductoId: vino.id, cantidad: 0.15, unidadId: s.kg.id }] } } });
    await comprar(cocina.id, vino.id, 0.1, OCT);
    await comprar(deposito.id, vino.id, 1, NOV);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: copa.id, cantidad: 1, precioUnitario: 2000, numeroEnvio: 1 }]);

    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const liquidaciones = (await movimientosDeLaMesa()).filter((m) => m.proceso === "LIQUIDACION_CONSIGNACION");
    expect(liquidaciones.map((m) => [m.seccionId, Number(m.precioTotal)]).sort()).toEqual([[cocina.id, 10], [deposito.id, 5]].sort());
    expect(resumen((await movimientosDeLaMesa()).filter((m) => m.proceso === "CONSUMO"))).toEqual([
      ["CONSUMO", vino.id, cocina.id, -0.1, "2026-10-01"],
      ["CONSUMO", vino.id, deposito.id, -0.05, "2026-11-01"],
    ]);
  });

  it("PV que se produce vendido de más: queda negativo en SU sección de stock, sin aviso (B3: su stock propio no se valida)", async () => {
    await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    const torta = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: s.unidad.id, seProduce: true, precioVenta: 5000 }, s.sucursalId);
    await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId: deposito.id, items: [{ productoId: torta.id, cantidad: 2 }] });
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: torta.id, cantidad: 5, precioUnitario: 5000, numeroEnvio: 1 }]);

    const r = await cerrarCuenta(cuenta.id);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain("⚠");
    expect(resumen(await movimientosDeLaMesa())).toEqual([["VENTA", torta.id, deposito.id, -5, null]]);
    expect(await calcularSaldoTotal(torta.id, deposito.id, prisma)).toBe(-3);
    expect(await prisma.registroAuditoria.count()).toBe(0);
    const fila = (await calcularStockConsolidado(s.sucursalId, prisma)).find((f) => f.productoId === torta.id);
    expect(fila).toMatchObject({ seccionId: deposito.id, teorico: -3, estado: "NEGATIVO" });
  });
});
