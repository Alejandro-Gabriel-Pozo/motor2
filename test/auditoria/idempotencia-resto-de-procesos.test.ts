import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pivote 2 (Idempotencia) — política ya definida con el negocio: alcance
 * I3 (todas las operaciones manuales), identidad vía clave de idempotencia
 * generada por el cliente (mecanismo TODAVÍA NO IMPLEMENTADO — requiere
 * migración, fuera del alcance de esta etapa de solo verificación).
 *
 * Lo que SÍ se puede confirmar sin tocar código: si cada proceso incluido
 * en la política I3 tiene HOY alguna protección contra repetición
 * secuencial (doble-submit), más allá de COMPRA (factura) y CONSUMO (ya
 * confirmados sin protección en concurrencia-idempotencia.test.ts).
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";

describe("Auditoría — Pivote 2: repetición secuencial en el resto de los procesos de la política I3", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    seccionDestinoId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("MERMA: un reenvío secuencial del mismo payload crea dos Operaciones y descuenta el doble — sin protección alguna", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_M1", nombre: "Tomate", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const payload = { proceso: "MERMA" as const, fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 3 }], motivo: "VENCIDO" as const };
    const r1 = await registrarMovimiento(payload);
    const r2 = await registrarMovimiento(payload);
    expect(r1.ok, r1.mensaje).toBe(true);
    expect(r2.ok, r2.mensaje).toBe(true);

    const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "MERMA" } });
    expect(operaciones).toBe(2);
  });

  it("PRODUCCIÓN: un reenvío secuencial del mismo payload crea dos Operaciones (y consume el insumo el doble)", async () => {
    const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_P1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_P1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100, seProduce: true }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 20 }] });

    const payload = { proceso: "PRODUCCION" as const, fecha: new Date(), seccionId, items: [{ productoId: pv.id, cantidad: 5 }] };
    const r1 = await registrarMovimiento(payload);
    const r2 = await registrarMovimiento(payload);
    expect(r1.ok, r1.mensaje).toBe(true);
    expect(r2.ok, r2.mensaje).toBe(true);

    const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "PRODUCCION" } });
    expect(operaciones).toBe(2);
  });

  it("DEVOLUCION_PROVEEDOR: un reenvío secuencial del mismo payload crea dos Operaciones — sin ningún guard, a diferencia de COMPRA que al menos lo intenta", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_D1", nombre: "Proveedor D1" } });
    const mp = await sembrarProductoDisponible({ codigo: "MP_D1", nombre: "Queso", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 10 }] });

    const payload = { proceso: "DEVOLUCION_PROVEEDOR" as const, fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 2 }] };
    const r1 = await registrarMovimiento(payload);
    const r2 = await registrarMovimiento(payload);
    expect(r1.ok, r1.mensaje).toBe(true);
    expect(r2.ok, r2.mensaje).toBe(true);

    const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "DEVOLUCION_PROVEEDOR" } });
    expect(operaciones).toBe(2); // ninguna referencia de factura se exige acá — ni siquiera el guard racy de COMPRA existe
  });

  it("RECLASIFICACION: un reenvío secuencial del mismo payload ejecuta la reclasificación dos veces (mueve el doble de stock)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_R1", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    // reclasificarStock exige que los destinos sumen EXACTO el disponible
    // en origen (reparte todo el saldo, no una porción) — 10 acá.
    const payload = { productoId: mp.id, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }] };
    const r1 = await reclasificarStock(payload);
    // Tras la primera reclasificación el origen queda en 0 — para que el
    // reenvío pueda "tener éxito" en los mismos términos, primero hay que
    // reponer el origen (así el segundo intento no falla por falta de
    // stock, sino que se puede observar si el propio proceso lo permite
    // repetir sin ningún guard de identidad).
    expect(r1.ok, r1.mensaje).toBe(true);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const r2 = await reclasificarStock(payload);
    expect(r2.ok, r2.mensaje).toBe(true);

    const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "RECLASIFICACION" } });
    expect(movimientos).toBe(4); // 2 reclasificaciones × (1 salida + 1 entrada)
  });

  it("VENTA: un reenvío secuencial del mismo payload registra dos ventas (y dos consumos de receta) — mismo patrón que CONSUMO", async () => {
    const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_V1", nombre: "Harina V", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_V1", nombre: "Pan V", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 20 }] });

    const payload = { fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 4 }] };
    const r1 = await registrarVenta(payload);
    const r2 = await registrarVenta(payload);
    expect(r1.ok, r1.mensaje).toBe(true);
    expect(r2.ok, r2.mensaje).toBe(true);

    const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "VENTA" } });
    expect(operaciones).toBe(2);
  });
});
