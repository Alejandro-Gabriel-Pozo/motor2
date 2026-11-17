import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { MENSAJE_SECCION_NO_SIRVE_PARA_VENDER } from "../../src/core/compras/public";
import { saldosTeoricosEnSucursal, seccionesConStock } from "../../src/server/lecturas/movimientos/saldos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * Compras, etapa (ii-a): la venta no usa depósitos de cuarentena ni de rechazo. Postgres real. Complementa al oráculo de combinaciones (`combinaciones-compras-exclusion-de-venta-integracion.test.ts`) con lo que una tabla no recorre: concurrencia, idempotencia,
 * aislamiento entre sucursales, los avisos de stock y la pista del rechazo. «Alfa especial» ordena antes que «Salón» a propósito.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let especial: { id: string };

const sembrarStock = async (seccionId: string, cantidad: number, productoId = s.muzzarella.id, sucursalId = s.sucursalId) => {
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-01-01T12:00:00Z"), usuarioId: s.admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: operacion.id, productoId, seccionId, proceso: "COMPRA", cantidad, detalle: "Stock de prueba", precioTotal: 0, precioPorUnidadStock: 0 } });
};
const consumosEnEspecial = () => prisma.movimientoStock.count({ where: { seccionId: especial.id, proceso: { in: ["VENTA", "CONSUMO"] } } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  especial = await prisma.seccion.create({ data: { sucursalId: s.sucursalId, nombre: "Alfa especial", uso: "CUARENTENA" } });
  await sembrarStock(especial.id, 100);
});

describe("venta de mostrador: concurrencia con un depósito especial con stock", () => {
  it("dos ventas a la vez de 1 kg contra 1,5 kg normales: una vende, la otra se rechaza por stock, y NUNCA se descuenta del depósito especial", async () => {
    await sembrarStock(s.seccion.id, 1.5);
    const venta = () => registrarVenta({ fecha: new Date(), seccionId: s.seccion.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 4 }] });
    const resultados = await Promise.all([venta(), venta()]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const rechazada = resultados.find((r) => !r.ok)!;
    expect(rechazada.mensaje).toContain("Stock insuficiente");
    expect(rechazada.mensaje).not.toContain("Alfa especial");
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
    expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id, prisma)).toBeCloseTo(0.5, 6);
    expect(await calcularSaldoTotal(s.muzzarella.id, especial.id, prisma)).toBe(100);
    expect(await consumosEnEspecial()).toBe(0);
  });
});

describe("cierre de cuenta del POS: concurrencia y stock solo en el depósito especial", () => {
  it("dos cierres a la vez con el stock normal que no alcanza: las dos ventas se registran (como hoy, con aviso) y el especial no se toca", async () => {
    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    await sembrarStock(s.seccion.id, 0.6);
    const c1 = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    const c2 = await sembrarCuenta(mesa2.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    const resultados = await Promise.all([cerrarCuenta(c1.id), cerrarCuenta(c2.id)]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id, prisma)).toBeCloseTo(0.6 - 1, 6);
    expect(await calcularSaldoTotal(s.muzzarella.id, especial.id, prisma)).toBe(100);
    expect(await consumosEnEspecial()).toBe(0);
  });

  it("con el único stock en el depósito especial se comporta como si no hubiera stock normal: faltante avisado sobre el normal, sin consumir del especial", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    const r = await cerrarCuenta(cuenta.id);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain('"Muzzarella" en «Salón» (tenía 0, se consumió 0,5, quedó en -0,5)');
    expect(await calcularSaldoTotal(s.muzzarella.id, especial.id, prisma)).toBe(100);
  });

  it("una sucursal cuyas únicas secciones son especiales no puede cerrar cuentas (falla cerrada: no hay sección desde la que vender)", async () => {
    await prisma.seccion.update({ where: { id: s.seccion.id }, data: { activa: false } });
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    const r = await cerrarCuenta(cuenta.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe("Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.");
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
  });
});

describe("sección habitual de uso especial", () => {
  it("se ignora (el dato guardado no se toca) y el cierre cae al respaldo normal", async () => {
    await sembrarStock(s.seccion.id, 1);
    const habitual = await prisma.seccionHabitualProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.pizza.id, seccionId: especial.id } });
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
    const r = await cerrarCuenta(cuenta.id);
    expect(r.ok).toBe(true);
    expect(r.mensaje).not.toContain("⚠");
    expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id, prisma)).toBeCloseTo(0.5, 6);
    expect(await consumosEnEspecial()).toBe(0);
    expect(await prisma.seccionHabitualProducto.findUnique({ where: { id: habitual.id } })).toMatchObject({ seccionId: especial.id });
  });
});

describe("venta de mostrador: idempotencia y aislamiento", () => {
  it("repetir la misma venta con la misma clave: una sola vez, y la sección especial sigue rechazándose con el texto propuesto", async () => {
    await sembrarStock(s.seccion.id, 5);
    const clave = randomUUID();
    const datos = { fecha: new Date("2026-08-06T12:00:00Z"), seccionId: s.seccion.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 2 }], claveIdempotencia: clave };
    expect((await registrarVenta(datos)).ok).toBe(true);
    expect((await registrarVenta(datos)).ok).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
    expect(await calcularSaldoTotal(s.muzzarella.id, s.seccion.id, prisma)).toBeCloseTo(4.5, 6);
    const aEspecial = await registrarVenta({ ...datos, seccionId: especial.id, claveIdempotencia: randomUUID() });
    expect(aEspecial.ok).toBe(false);
    expect(aEspecial.mensaje).toBe(MENSAJE_SECCION_NO_SIRVE_PARA_VENDER);
  });

  it("una sección de OTRA sucursal (normal o especial) sigue siendo «no encontrada» y su stock no entra en los saldos de esta", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const normalAjena = await prisma.seccion.create({ data: { sucursalId: otra.id, nombre: "Ajena normal" } });
    const especialAjena = await prisma.seccion.create({ data: { sucursalId: otra.id, nombre: "Ajena rechazo", uso: "RECHAZO" } });
    for (const seccionId of [normalAjena.id, especialAjena.id]) {
      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: s.pizza.id, cantidadVendida: 1 }] });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toBe("No se encontró la sección.");
    }
    await sembrarStock(normalAjena.id, 7, s.muzzarella.id, otra.id);
    expect((await saldosTeoricosEnSucursal(s.sucursalId, [s.muzzarella.id], prisma)).get(s.muzzarella.id)).toBeUndefined();
  });
});

describe("avisos de stock y pista del rechazo", () => {
  it("el stock teórico (selector del POS, opciones por sucursal, carta del panel) suma solo depósitos de uso NORMAL", async () => {
    await sembrarStock(s.seccion.id, 3);
    const rechazo = await prisma.seccion.create({ data: { sucursalId: s.sucursalId, nombre: "Beta rechazo", uso: "RECHAZO" } });
    await sembrarStock(rechazo.id, 20);
    expect((await saldosTeoricosEnSucursal(s.sucursalId, [s.muzzarella.id], prisma)).get(s.muzzarella.id)).toBe(3);
  });

  it("con stock únicamente en depósitos especiales, el producto se ve sin stock (el aviso nunca bloquea)", async () => {
    expect((await saldosTeoricosEnSucursal(s.sucursalId, [s.muzzarella.id], prisma)).get(s.muzzarella.id) ?? 0).toBe(0);
  });

  it("la pista «Tiene stock en» de una venta no nombra especiales; la de los movimientos sigue contándolos", async () => {
    await sembrarStock(s.seccion.id, 2);
    expect(await seccionesConStock(s.muzzarella.id, s.sucursalId, prisma, { soloQueSirvenParaVender: true })).toEqual(["Salón"]);
    expect((await seccionesConStock(s.muzzarella.id, s.sucursalId, prisma)).sort()).toEqual(["Alfa especial", "Salón"]);
  });
});
