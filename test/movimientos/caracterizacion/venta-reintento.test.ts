import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../../setup/test-db";
import { mockearUsuarioActual } from "../../setup/mock-sesion";
import { registrarMovimiento } from "../../../src/server/actions/movimientos/movimientos";
import { registrarVentaCasoDeUso } from "../../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import type { Transaccion } from "../../../src/lib/db-tipos";

/**
 * CARACTERIZACIÓN del reintento de la venta (Fase 4, tramo A; NO se edita en ningún paso posterior). La venta corre dentro de una transacción SERIALIZABLE que
 * se REPITE entera si Postgres detecta un conflicto de escritura (P2034). Al mover la venta de carpeta, nada del estado de un intento (la caché de productos, el
 * arrastre de redondeo, el costo de hoy, el hash de idempotencia) puede quedar fuera del cuerpo que se repite: si quedara, el segundo intento arrastraría datos del primero.
 *
 * El caso: la PRIMERA vez la transacción hace todo el trabajo y falla con un conflicto al final (se revierte entera); la segunda corre limpia. El resultado y las
 * filas tienen que ser EXACTAMENTE los de una venta que no tuvo conflicto, y no puede quedar ningún resto del primer intento. Se prueba con una venta fraccionada
 * (Pan ×0,5 de un bollo: el arrastre de redondeo se calcula dentro de la transacción) y con clave I3 (la clave se escribe una sola vez).
 */
describe("venta: el reintento ante un conflicto de escritura repite todo y no deja restos", () => {
  let sucursalId: string;
  let seccionId: string;
  let usuarioId: string;
  let pan: string;
  let pizza: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    usuarioId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const bollo = (await sembrarProductoDisponible({ codigo: "MP_BOLLO", nombre: "Bollo", tipo: "MP", unidadStockId: unidad.id }, sucursalId)).id;
    const muzza = (await sembrarProductoDisponible({ codigo: "MP_MUZZA", nombre: "Muzzarella", tipo: "MP", unidadStockId: kg.id }, sucursalId)).id;
    pan = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidad.id, precioVenta: 800 }, sucursalId)).id;
    pizza = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 }, sucursalId)).id;
    await prisma.recetaVersion.create({ data: { productoId: pan, version: 1, ingredientes: { create: [{ insumoProductoId: bollo, cantidad: 1, unidadId: unidad.id, mermaPorcentaje: 0 }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pizza, version: 1, ingredientes: { create: [{ insumoProductoId: muzza, cantidad: 0.25, unidadId: kg.id, mermaPorcentaje: 0 }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: bollo, cantidad: 3, precioTotal: 90 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: muzza, cantidad: 1, precioTotal: 400 }] });
  });

  const conflicto = () => new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "test" });
  const actor = (transaccion: Transaccion) => ({ usuarioId, sucursalId, sucursalNombre: "Central", transaccion });

  /** Una transacción real que, en los primeros `fallos` intentos, hace todo el trabajo y falla al final (se revierte entera). */
  function transaccionConConflictos(fallos: number): { transaccion: Transaccion; intentos: () => number } {
    let intentos = 0;
    const transaccion: Transaccion = (fn, opciones) =>
      prisma.$transaction(async (tx) => {
        intentos++;
        const r = await fn(tx);
        if (intentos <= fallos) throw conflicto();
        return r;
      }, opciones);
    return { transaccion, intentos: () => intentos };
  }

  const kardex = async () =>
    (await prisma.movimientoStock.findMany({ where: { proceso: { in: ["VENTA", "CONSUMO"] } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((m) => [
      m.proceso,
      Number(m.cantidad),
      m.cantidadExacta === null ? null : Number(m.cantidadExacta),
      Number(m.precioTotal),
      m.costoUnitarioVenta === null ? null : Number(m.costoUnitarioVenta),
    ]);
  const operaciones = async () =>
    (await prisma.operacion.findMany({ where: { proceso: "VENTA" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] })).map((o) => [o.claveIdempotencia, o.resultadoMensaje, o.nroFactura]);

  async function vender(transaccion: Transaccion) {
    // Pan ×0,5 (consume 1 bollo entero en la primera mitad por el arrastre) y Pizza ×1, con clave I3 y N.º de factura.
    const datos = { fecha: new Date("2026-09-28"), seccionId, nroFactura: "A-1", claveIdempotencia: "clave-reintento", ventas: [{ productoId: pan, cantidadVendida: 0.5 }, { productoId: pizza, cantidadVendida: 1 }] };
    return registrarVentaCasoDeUso(actor(transaccion), datos);
  }

  it("un conflicto en el primer intento da EXACTAMENTE el mismo resultado y las mismas filas que una venta sin conflicto", async () => {
    const limpio = transaccionConConflictos(0);
    const sinConflicto = await vender(limpio.transaccion);
    expect(sinConflicto.ok, sinConflicto.ok ? "" : sinConflicto.mensaje).toBe(true);
    expect(limpio.intentos()).toBe(1);
    const esperadoKardex = await kardex();
    const esperadoOperaciones = await operaciones();
    expect(esperadoKardex.length).toBeGreaterThan(3); // si la venta no escribió nada, esta prueba no mira nada

    // Se vuelve a sembrar el mismo mundo y se vende con un conflicto en el primer intento.
    await prisma.movimientoStock.deleteMany({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } });
    await prisma.cuentaItem.deleteMany({});
    await prisma.operacion.deleteMany({ where: { proceso: "VENTA" } });

    const conConflicto = transaccionConConflictos(1);
    const reintentada = await vender(conConflicto.transaccion);
    expect(reintentada.ok, reintentada.ok ? "" : reintentada.mensaje).toBe(true);
    expect(conConflicto.intentos()).toBe(2); // el primero se revirtió, el segundo es el que quedó
    // Los ids de las Operaciones son nuevos en cada corrida: se compara el resto del resultado y cuántas devolvió.
    const forma = (r: typeof sinConflicto) => (r.ok ? { ok: true, mensaje: r.mensaje, cantidadDeOperaciones: r.datos.operacionIds?.length ?? null, repetida: r.datos.repetida ?? false } : r);
    expect(forma(reintentada)).toEqual(forma(sinConflicto));
    expect(await kardex()).toEqual(esperadoKardex);
    expect(await operaciones()).toEqual(esperadoOperaciones);
  }, 60_000);

  it("con DOS conflictos seguidos también se repite entero y queda un solo juego de filas (tres intentos)", async () => {
    const dosConflictos = transaccionConConflictos(2);
    const r = await vender(dosConflictos.transaccion);
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    expect(dosConflictos.intentos()).toBe(3);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2); // una Operación por línea (Pan y Pizza), no seis
    expect(await prisma.operacion.count({ where: { proceso: "VENTA", claveIdempotencia: "clave-reintento" } })).toBe(1); // la clave I3 va en la primera, una sola vez
  }, 60_000);

  it("si los conflictos agotan los intentos, no se escribe nada (el último intento también se revierte)", async () => {
    const siempre = transaccionConConflictos(99);
    await expect(vender(siempre.transaccion)).rejects.toBeDefined();
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
  }, 120_000);
});
