import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarVentaEnTx, type ActorVenta } from "../../src/core/movimientos/registrar-venta";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * H9 (docs/plan-seccion-habitual-stock-2026-09-25.md): dos LÍNEAS de la misma venta que consumen la misma familia de insumo. El
 * reparto por familia (`resolverConsumoPorFamilia`) lee el saldo de la base en cada línea y las filas se escriben todas juntas al
 * final, así que la segunda línea no ve lo que ya tomó la primera: las dos eligen el mismo lote, que se pide dos veces.
 *
 * Datos: Muzza A (0,3 kg, vence 2026-10-01) y Muzza B (0,3 kg, vence 2026-11-01), mismo insumo; Pizza y Fugazzeta usan 0,25 kg de
 * A cada una. El insumo tiene 0,6 kg combinados y la venta pide 0,5: alcanza siempre.
 *
 * Antes del arreglo, los dos casos de dos líneas fallaban (rechazo falso en mostrador, aviso falso en −0,2 en el POS); la venta ahora
 * asigna los consumos con el libro de origen-venta.ts, que descuenta lo ya asignado a las líneas anteriores.
 */
describe("H9: reparto por familia entre líneas de la misma venta", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  let muzzaA: string;
  let muzzaB: string;
  let pizza: string;
  let fugazzeta: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const insumo = await prisma.insumo.create({ data: { nombre: "Muzzarella" } });
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId: admin.id, sucursalId, sucursalNombre: "Central" };

    muzzaA = (await sembrarProductoDisponible({ codigo: "MP_MUZZA_A", nombre: "Muzza A", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: insumo.id }, sucursalId)).id;
    muzzaB = (await sembrarProductoDisponible({ codigo: "MP_MUZZA_B", nombre: "Muzza B", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: insumo.id }, sucursalId)).id;
    pizza = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId)).id;
    fugazzeta = (await sembrarProductoDisponible({ codigo: "PV_FUGA", nombre: "Fugazzeta", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 120 }, sucursalId)).id;
    for (const pv of [pizza, fugazzeta]) {
      await prisma.recetaVersion.create({
        data: { productoId: pv, version: 1, ingredientes: { create: [{ insumoProductoId: muzzaA, cantidad: 0.25, unidadId: catalogo.kg.id, mermaPorcentaje: 0 }] } },
      });
    }
    await registrarMovimiento({
      proceso: "COMPRA",
      fecha: new Date(),
      seccionId,
      items: [
        { productoId: muzzaA, cantidad: 0.3, loteVencimiento: new Date("2026-10-01") },
        { productoId: muzzaB, cantidad: 0.3, loteVencimiento: new Date("2026-11-01") },
      ],
    });
  });

  it("control: Pizza ×2 en UNA línea reparte bien (A queda en 0, B en 0,1)", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pizza, cantidadVendida: 2 }] });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(muzzaA, seccionId)).toBe(0);
    expect(await calcularSaldoTotal(muzzaB, seccionId)).toBe(0.1);
  });

  it("mostrador: Pizza y Fugazzeta en DOS líneas se venden (el insumo alcanza) y reparten igual que en una sola línea", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pizza, cantidadVendida: 1 }, { productoId: fugazzeta, cantidadVendida: 1 }] });
    expect(r).toEqual({ ok: true, mensaje: "Se registraron 2 venta(s) correctamente." });
    expect(await calcularSaldoTotal(muzzaA, seccionId)).toBe(0);
    expect(await calcularSaldoTotal(muzzaB, seccionId)).toBe(0.1);
  });

  it("POS (permitirStockNegativo): las mismas dos líneas no dejan ningún lote en negativo ni avisan", async () => {
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(
        tx,
        actor,
        { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pizza, cantidadVendida: 1 }, { productoId: fugazzeta, cantidadVendida: 1 }] },
        { permitirStockNegativo: true }
      )
    );
    expect(r).toMatchObject({ ok: true, avisosStockNegativo: [] });
    expect(await calcularSaldoTotal(muzzaA, seccionId)).toBe(0);
    expect(await calcularSaldoTotal(muzzaB, seccionId)).toBe(0.1);
  });
});
