import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarSeccion } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Secciones excluibles del respaldo automático (`Seccion.sirveDeRespaldoEnVentas`, docs/plan-seccion-habitual-stock-2026-09-25.md
 * B5/C10): una sección con el flag en `false` nunca se ofrece como RESPALDO al cerrar una cuenta (ni para el faltante), pero se sigue
 * usando si es la HABITUAL del producto; sin ningún respaldo, un PV sin habitual no se puede cerrar (error antes de escribir). La venta
 * de mostrador no cambia: ahí la sección la elige una persona.
 */
describe("cerrarCuenta: secciones que no sirven de respaldo automático", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const OCT = new Date("2026-10-01");
  const NOV = new Date("2026-11-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const comprar = (seccionId: string, cantidad: number, loteVencimiento?: Date) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: s.muzzarella.id, cantidad, loteVencimiento }] });
  const excluir = (seccionId: string) => prisma.seccion.update({ where: { id: seccionId }, data: { sirveDeRespaldoEnVentas: false } });
  const cuentaCon = (productoId: string, cantidad: number) => sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId, cantidad, precioUnitario: 1000, numeroEnvio: 1 }]);
  const filas = async () =>
    (await prisma.movimientoStock.findMany({ where: { operacion: { proceso: "VENTA", detalleLibre: "Mesa 4" } }, orderBy: { creadoEn: "asc" } })).map((m) => [m.proceso, m.seccionId, Number(m.cantidad)]);
  const mensajeSinRespaldo = (producto: string) =>
    `Ninguna sección de «Central» sirve de respaldo automático en ventas y «${producto}» no tiene sección habitual: configurá su sección habitual (Stock → Sección habitual) o marcá una sección como respaldo (Movimientos → Secciones).`;

  it("una sección excluida nunca se usa como respaldo, aunque tenga el lote que vence antes", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await excluir(cocina.id);
    await comprar(cocina.id, 1, OCT);
    await comprar(deposito.id, 1, NOV);
    expect((await cerrarCuenta((await cuentaCon(s.pizza.id, 2)).id)).ok).toBe(true);
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.5],
      ["VENTA", deposito.id, -2],
    ]);
    expect(await calcularSaldoTotal(s.muzzarella.id, cocina.id, prisma)).toBe(1);
  });

  it("ni para el faltante: aunque el insumo solo se haya movido en la excluida, lo que falta va a un respaldo", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await excluir(cocina.id);
    await comprar(cocina.id, 1);
    const r = await cerrarCuenta((await cuentaCon(s.pizza.id, 2)).id);
    expect(r.mensaje).toContain('"Muzzarella" en «Depósito» (tenía 0, se consumió 0,5, quedó en -0,5)');
    expect(await filas()).toEqual([
      ["CONSUMO", deposito.id, -0.5],
      ["VENTA", deposito.id, -2],
    ]);
    expect(await calcularSaldoTotal(s.muzzarella.id, cocina.id, prisma)).toBe(1);
  });

  it("una habitual excluida del respaldo se sigue usando igual (la preferencia explícita manda)", async () => {
    const cocina = await sembrarSeccion(s.sucursalId, "Cocina");
    const deposito = await sembrarSeccion(s.sucursalId, "Depósito");
    await excluir(cocina.id);
    await prisma.seccionHabitualProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.pizza.id, seccionId: cocina.id } });
    await comprar(cocina.id, 0.2, NOV);
    await comprar(deposito.id, 1, OCT);
    expect((await cerrarCuenta((await cuentaCon(s.pizza.id, 2)).id)).ok).toBe(true);
    expect(await filas()).toEqual([
      ["CONSUMO", cocina.id, -0.2],
      ["CONSUMO", deposito.id, -0.3],
      ["VENTA", cocina.id, -2],
    ]);
  });

  describe("sin ninguna sección de respaldo", () => {
    beforeEach(async () => {
      await excluir(s.seccion.id); // «Salón», la única de la sucursal
    });

    it("un PV con receta y sin habitual: error «sin respaldo», 0 escrituras, la cuenta sigue abierta", async () => {
      await comprar(s.seccion.id, 1);
      const antes = await prisma.movimientoStock.count();
      const cuenta = await cuentaCon(s.pizza.id, 2);
      expect(await cerrarCuenta(cuenta.id)).toEqual({ ok: false, mensaje: mensajeSinRespaldo("Pizza") });
      expect(await prisma.movimientoStock.count()).toBe(antes);
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
    });

    it("un PV SIN receta y sin habitual: el mismo error", async () => {
      const cuenta = await cuentaCon(s.flan.id, 1);
      expect(await cerrarCuenta(cuenta.id)).toEqual({ ok: false, mensaje: mensajeSinRespaldo("Flan") });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("si esa sección ES la habitual del PV, cierra bien (sin necesitar ningún respaldo)", async () => {
      await comprar(s.seccion.id, 1);
      await prisma.seccionHabitualProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.pizza.id, seccionId: s.seccion.id } });
      const r = await cerrarCuenta((await cuentaCon(s.pizza.id, 2)).id);
      expect(r.ok).toBe(true);
      expect(r.mensaje).not.toContain("⚠");
      expect(await filas()).toEqual([
        ["CONSUMO", s.seccion.id, -0.5],
        ["VENTA", s.seccion.id, -2],
      ]);
    });

    it("la venta de mostrador en esa sección sigue funcionando igual (el flag no aplica cuando la sección la elige una persona)", async () => {
      await comprar(s.seccion.id, 1);
      expect(await registrarVenta({ fecha: new Date(), seccionId: s.seccion.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 2 }] })).toEqual({
        ok: true,
        mensaje: "Se registraron 1 venta(s) correctamente.",
      });
      expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id, prisma)).toBe(0.5);
    });
  });
});
