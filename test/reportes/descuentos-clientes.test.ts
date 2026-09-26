import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { asignarClienteACuenta, cerrarCuenta } from "../../src/server/actions/pos/cuenta";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { obtenerReporteDescuentosClientes } from "../../src/core/reportes/descuentos-clientes";

/**
 * Reporte de descuentos por cliente (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 10): contra Postgres real, con
 * las acciones reales del POS (mismo molde que cerrar-cuenta-action.test.ts) — no arma `MovimientoStock` a mano.
 */
describe("obtenerReporteDescuentosClientes", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const desde = new Date("2000-01-01");
  const hasta = new Date("2100-01-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const crearCliente = async (nombre: string, pct: number) => {
    const r = await altaCliente(nombre, pct);
    if (!r.ok) throw new Error(r.mensaje);
    return r.id;
  };

  it("sin ninguna venta con cliente: reporte vacío", async () => {
    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep).toEqual({ desde, hasta, ingresoALista: 0, ingresoCobrado: 0, totalDescontado: 0, descuentoEfectivoPct: null, clientes: [], aviso: rep.aviso });
  });

  it("una venta con descuento y costo conocido: ingresos, descuento y margen Real (cobrado vs. a lista) exactos", async () => {
    // Muzzarella comprada a $400/kg (10 kg × $400 = $4000 de precioTotal): cada pizza (0,25 kg) cuesta $100.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 10, precioTotal: 4000 }] });
    const clienteId = await crearCliente("Fulano", 20);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, clienteId);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep.ingresoALista).toBe(2000);
    expect(rep.ingresoCobrado).toBe(1600); // 2000 × 0,8
    expect(rep.totalDescontado).toBe(400);
    expect(rep.descuentoEfectivoPct).toBe(20);
    expect(rep.clientes).toHaveLength(1);

    const [fila] = rep.clientes;
    expect(fila).toMatchObject({
      clienteId,
      cliente: "Fulano",
      cantidadVentas: 1,
      unidadesVendidas: 2,
      ingresoALista: 2000,
      ingresoCobrado: 1600,
      totalDescontado: 400,
      descuentoEfectivoPct: 20,
      margenRealReconstruido: false, // costoUnitarioVenta se guardó al vender (compra ya estaba cuando se cerró) — no hizo falta reconstruir
      margenRealCompleto: true,
    });
    // Costo real: 2 × $100 = $200 en los dos escenarios (mismo costo, cambia el ingreso).
    expect(fila.margenReal).toBe(1400); // 1600 − 200
    expect(fila.margenRealALista).toBe(1800); // 2000 − 200
    // La diferencia entre ambos márgenes es EXACTAMENTE el descuento (el costo se cancela).
    expect(fila.margenRealALista! - fila.margenReal!).toBe(fila.totalDescontado);
  });

  it("0% de descuento: el cliente aparece igual, con totalDescontado 0 (sin precioListaUnitario que reconstruir)", async () => {
    const clienteId = await crearCliente("Sin descuento", 0);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, clienteId);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep.clientes).toEqual([
      expect.objectContaining({ cliente: "Sin descuento", ingresoALista: 3000, ingresoCobrado: 3000, totalDescontado: 0, descuentoEfectivoPct: 0 }),
    ]);
  });

  it("dos clientes: cada uno con su propia fila, ordenados por total descontado descendente", async () => {
    const chico = await crearCliente("Chico", 10);
    const grande = await crearCliente("Grande", 50);
    const c1 = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(c1.id, chico);
    await cerrarCuenta(c1.id);
    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const c2 = await sembrarCuenta(mesa2.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(c2.id, grande);
    await cerrarCuenta(c2.id);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep.clientes.map((f) => f.cliente)).toEqual(["Grande", "Chico"]); // 1500 > 300
    expect(rep.totalDescontado).toBe(1500 + 300);
  });

  it("una cuenta sin cliente asignado no aparece; una de otra sucursal tampoco", async () => {
    const clienteId = await crearCliente("Fulano", 10);
    // Cuenta SIN cliente asignado: cierra una venta normal, que no debería sumar nada al reporte.
    const sinCliente = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(sinCliente.id)).ok).toBe(true);

    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const conCliente = await sembrarCuenta(mesa2.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(conCliente.id, clienteId);
    expect((await cerrarCuenta(conCliente.id)).ok).toBe(true);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep.clientes).toHaveLength(1); // solo "Fulano" — la venta sin cliente no aparece

    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    expect((await obtenerReporteDescuentosClientes(norte.id, desde, hasta)).clientes).toEqual([]);
  });

  it("una venta anulada no cuenta", async () => {
    const clienteId = await crearCliente("Fulano", 10);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, clienteId);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", clienteId } });
    expect((await anularVenta(venta.id)).ok).toBe(true);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta);
    expect(rep.clientes).toEqual([]);
  });

  it("fuera del rango de fechas: no aparece", async () => {
    const clienteId = await crearCliente("Fulano", 10);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, clienteId);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, new Date("1999-01-01"), new Date("1999-06-01"));
    expect(rep.clientes).toEqual([]);
  });
});
