import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarSeccion } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * El cierre del POS PREFIERE la sección habitual del PV (`SeccionHabitualProducto`, docs/plan-seccion-habitual-stock-2026-09-25.md
 * C1/C3): primero sale de ahí, aunque otra sección tenga un lote que vence antes; si no alcanza, el resto sale de los respaldos; lo
 * que falte se carga en la habitual; y la fila VENTA va a la habitual. Una habitual inactiva o de otra sucursal se ignora.
 */
describe("cerrarCuenta: la sección habitual del PV", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cocina: { id: string };
  let deposito: { id: string };
  const OCT = new Date("2026-10-01");
  const NOV = new Date("2026-11-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    deposito = await sembrarSeccion(s.sucursalId, "Depósito");
  });

  const comprar = (seccionId: string, cantidad: number, loteVencimiento?: Date) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: s.muzzarella.id, cantidad, loteVencimiento }] });
  const habitual = (seccionId: string, productoId = s.pizza.id, sucursalId = s.sucursalId) => prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId, seccionId } });
  const cerrarPizzas = async (cantidad: number) => cerrarCuenta((await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad, precioUnitario: 12000, numeroEnvio: 1 }])).id);
  const filas = async () =>
    (await prisma.movimientoStock.findMany({ where: { operacion: { proceso: "VENTA", detalleLibre: "Mesa 4" } }, orderBy: { creadoEn: "asc" } })).map((m) => [
      m.proceso,
      m.seccionId,
      Number(m.cantidad),
      m.loteVencimiento?.toISOString().slice(0, 10) ?? null,
    ]);

  it("la habitual con stock gana aunque un respaldo tenga el lote que vence antes", async () => {
    await habitual(cocina.id);
    await comprar(cocina.id, 1, NOV);
    await comprar(deposito.id, 1, OCT);
    const r = await cerrarPizzas(2);
    expect(r.ok).toBe(true);
    expect(await filas()).toEqual([
      ["CONSUMO", cocina.id, -0.5, "2026-11-01"],
      ["VENTA", cocina.id, -2, null],
    ]);
  });

  it("la habitual alcanza en parte: el resto sale del respaldo, y la VENTA va a la habitual", async () => {
    await habitual(cocina.id);
    await comprar(cocina.id, 0.2);
    await comprar(deposito.id, 1);
    expect((await cerrarPizzas(2)).mensaje).not.toContain("⚠");
    expect(await filas()).toEqual([
      ["CONSUMO", cocina.id, -0.2, null],
      ["CONSUMO", deposito.id, -0.3, null],
      ["VENTA", cocina.id, -2, null],
    ]);
  });

  it("lo que falta se carga en la habitual (no en la sección de referencia del insumo), con aviso y auditoría ahí", async () => {
    await habitual(cocina.id);
    await comprar(deposito.id, 0.1);
    const r = await cerrarPizzas(2);
    expect(r.mensaje).toContain('⚠ Quedó stock negativo: "Muzzarella" en «Cocina» (tenía 0, se consumió 0,4, quedó en -0,4).');
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.1, null],
      ["CONSUMO", cocina.id, -0.4, null],
      ["VENTA", cocina.id, -2, null],
    ]);
    expect(await calcularSaldoTotal(s.muzzarella.id, cocina.id, prisma)).toBe(-0.4);
    expect(await calcularSaldoTotal(s.muzzarella.id, deposito.id, prisma)).toBe(0);
    const [auditoria] = await prisma.registroAuditoria.findMany();
    expect(auditoria.descripcion).toContain('el stock de "Muzzarella" en «Cocina» quedó en negativo — tenía 0, la venta consumió 0,4, faltaron 0,4.');
  });

  it("la VENTA va a la habitual aunque todo el consumo salga de un respaldo", async () => {
    await habitual(cocina.id);
    await comprar(deposito.id, 1);
    await cerrarPizzas(2);
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.5, null],
      ["VENTA", cocina.id, -2, null],
    ]);
  });

  it("una habitual INACTIVA se ignora: resuelve como si no tuviera", async () => {
    await habitual(cocina.id);
    await prisma.seccion.update({ where: { id: cocina.id }, data: { activa: false } });
    await comprar(deposito.id, 1);
    await cerrarPizzas(2);
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.5, null],
      ["VENTA", deposito.id, -2, null],
    ]);
  });

  it("una habitual que apunta a una sección de OTRA sucursal se ignora", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const barraNorte = await sembrarSeccion(norte.id, "Barra Norte");
    await habitual(barraNorte.id);
    await comprar(deposito.id, 1);
    await cerrarPizzas(2);
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.5, null],
      ["VENTA", deposito.id, -2, null],
    ]);
    expect(await prisma.movimientoStock.count({ where: { seccionId: barraNorte.id } })).toBe(0);
  });

  it("Período filtrado por sección (C7, sin cambios en periodo.ts): la VENTA cuenta en la sección de la línea y cada CONSUMO en la suya", async () => {
    await habitual(cocina.id);
    await comprar(deposito.id, 1);
    await cerrarPizzas(2);
    const hoy = new Date();
    const enCocina = await obtenerReportePorPeriodo(s.sucursalId, hoy, hoy, { seccionId: cocina.id }, prisma, AHORA_DE_LA_CORRIDA);
    expect(enCocina.items.map((i) => [i.proceso, i.productoId, i.cantidad])).toEqual([["VENTA", s.pizza.id, 2]]);
    const enDeposito = await obtenerReportePorPeriodo(s.sucursalId, hoy, hoy, { seccionId: deposito.id }, prisma, AHORA_DE_LA_CORRIDA);
    expect(enDeposito.items.map((i) => [i.proceso, i.productoId]).sort()).toEqual([["COMPRA", s.muzzarella.id], ["CONSUMO", s.muzzarella.id]]);
  });
});
