import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { obtenerReporteDescuentosClientes } from "../../src/server/consultas/reportes/descuentos-clientes";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 — descuentos por cliente. Con ventas SIN costo guardado, el margen real se RECONSTRUYE con el historial de compras: antes se leía ese historial dos veces
 * por cada cliente (una por pasada, cobrado y a lista), así que las consultas crecían con la cantidad de clientes. Ahora el costo de todas las ventas sin costo se
 * reconstruye UNA vez para todos los clientes y cada pasada lo recibe armado. El resultado de cada cliente no cambia.
 */
describe("obtenerReporteDescuentosClientes: el costo reconstruido se calcula una vez para todos los clientes", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const desde = new Date("2000-01-01");
  const hasta = new Date("2100-01-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  async function clienteConVenta(nombre: string, pct: number, pizzas: number) {
    const alta = await altaCliente(nombre, pct);
    if (!alta.ok) throw new Error(alta.mensaje);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: pizzas, precioUnitario: 1000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, alta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    return alta.id;
  }

  async function montar() {
    // Muzzarella comprada a $400/kg: cada pizza (0,25 kg) cuesta $100. Las ventas se cierran y se les BORRA el costo guardado para forzar la reconstrucción.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 40, precioTotal: 16000 }] });
    const ids = [await clienteConVenta("Ana", 10, 2), await clienteConVenta("Beto", 20, 3), await clienteConVenta("Carla", 0, 1)];
    await prisma.movimientoStock.updateMany({ where: { proceso: "VENTA" }, data: { costoUnitarioVenta: null } });
    return ids;
  }

  it("el margen de cada cliente es el de siempre (costo reconstruido, a $100 la pizza)", async () => {
    const [ana, beto, carla] = await montar();
    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta, prisma);
    const porId = new Map(rep.clientes.map((c) => [c.clienteId, c]));

    // Ana: 2 pizzas a $1000 con 10% → cobra $1800; costo 2 × $100 = $200.
    expect(porId.get(ana)).toMatchObject({ ingresoALista: 2000, ingresoCobrado: 1800, totalDescontado: 200, margenReal: 1600, margenRealALista: 1800, margenRealReconstruido: true, margenRealCompleto: true });
    // Beto: 3 pizzas con 20% → cobra $2400; costo $300.
    expect(porId.get(beto)).toMatchObject({ ingresoALista: 3000, ingresoCobrado: 2400, totalDescontado: 600, margenReal: 2100, margenRealALista: 2700, margenRealReconstruido: true, margenRealCompleto: true });
    // Carla: sin descuento → cobra a lista; costo $100.
    expect(porId.get(carla)).toMatchObject({ ingresoALista: 1000, ingresoCobrado: 1000, totalDescontado: 0, margenReal: 900, margenRealALista: 900, margenRealReconstruido: true, margenRealCompleto: true });
  });

  it("con tres clientes la reconstrucción NO se hace por cliente: el historial de compras se lee a lo sumo UNA vez", async () => {
    await montar();

    const operaciones: string[] = [];
    const dbContado = prisma.$extends({
      query: {
        movimientoStock: {
          $allOperations({ operation, args, query }) {
            operaciones.push(operation);
            return query(args);
          },
        },
      },
    }) as unknown as Db;

    const rep = await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta, dbContado);

    expect(rep.clientes, "no hay clientes: la prueba no mide nada").toHaveLength(3);
    // Una lectura de las ventas con cliente + UNA de las compras para reconstruir (antes: una por cada cliente y por cada pasada).
    expect(operaciones.filter((o) => o === "findMany").length).toBeLessThanOrEqual(2);
  });
});
