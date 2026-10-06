import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularValuacionInventario } from "../../src/core/reportes/valuacion";

describe("calcularValuacionInventario", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let motivoVencidoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    motivoVencidoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("valoriza el saldo actual al costo de reposición (última compra local)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg, saldo 10
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-06-01"), seccionId, items: [{ productoId: mp.id, cantidad: 5, precioTotal: 100 }] }); // $20/kg, más reciente; saldo 15

    const rep = await calcularValuacionInventario(sucursalId, prisma);
    const fila = rep.filas.find((f) => f.productoId === mp.id)!;
    expect(fila.saldo).toBe(15);
    expect(fila.costoUnitario).toBe(20); // costo de reposición = última compra, no promedio
    expect(fila.valor).toBeCloseTo(15 * 20);
    expect(rep.totalValorizado).toBeCloseTo(15 * 20);
    expect(rep.cantidadSinCosto).toBe(0);
  });

  it("no inventa un valor para stock sin ninguna compra registrada", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    // Entra stock por AJUSTE, nunca por COMPRA: no hay costo de reposición conocido.
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 8 }] });

    const rep = await calcularValuacionInventario(sucursalId, prisma);
    const fila = rep.filas.find((f) => f.productoId === mp.id)!;
    expect(fila.sinCosto).toBe(true);
    expect(fila.valor).toBeNull();
    expect(fila.saldo).toBe(8);
    expect(rep.cantidadSinCosto).toBe(1);
    expect(rep.totalValorizado).toBe(0); // no suma nada por el producto sin costo
  });

  it("excluye productos sin stock (saldo <= 0)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoVencidoId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const rep = await calcularValuacionInventario(sucursalId, prisma);
    expect(rep.filas.find((f) => f.productoId === mp.id)).toBeUndefined();
  });

  it("lee el costo de reposición LOCAL de la sucursal, no de otra", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito 2");
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);

    const usuarioOtra = await crearUsuarioConMembresia({ email: "otra@test.com", sucursalId: otraSucursal.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } })).id });
    await prisma.operacion.create({
      data: {
        sucursalId: otraSucursal.id, proceso: "COMPRA", fecha: new Date(), usuarioId: usuarioOtra.id,
        movimientos: { create: [{ productoId: mp.id, seccionId: otraSeccion.id, proceso: "COMPRA", cantidad: 10, detalle: "Compra otra sucursal.", precioTotal: 1000, precioPorUnidadStock: 100 }] },
      },
    });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 3 }] });

    const rep = await calcularValuacionInventario(sucursalId, prisma);
    const fila = rep.filas.find((f) => f.productoId === mp.id)!;
    expect(fila.sinCosto).toBe(true); // no toma el $100/kg de la otra sucursal
  });
});
