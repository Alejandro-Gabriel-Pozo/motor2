import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { type ActorVenta } from "../../src/core/movimientos/registrar-venta";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";

/**
 * CARACTERIZACIÓN — congela cómo se comporta HOY el consumo de una venta, ANTES de la sustitución de insumos
 * (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 1). NO SE EDITA en ningún paso posterior del plan: si algún paso de la
 * sustitución cambia una fila, un aviso o un mensaje de una línea SIN sustitutos, este archivo lo tiene que detectar en rojo.
 *
 * Una venta mixta en modo POS (`permitirStockNegativo: true`, como cerrarCuenta): una línea con sus hermanos repartidos (Pizza:
 * Muzzarella entre MuzzaA/MuzzaB), una línea `seProduce` (Torta, con stock propio), una línea con faltante (Sandwich: Jamón sin
 * stock — queda con aviso en vez de rechazar), y una MP en consignación (Copa: Vino). Se verifica cada fila de `MovimientoStock`
 * completa y en orden, `avisosStockNegativo` y el mensaje. La misma venta en MOSTRADOR (sin `permitirStockNegativo`) se rechaza por
 * el faltante de Jamón, con el mensaje exacto — y no escribe ninguna fila.
 */
describe("Caracterización: consumo de una venta mixta (hermanos, seProduce, faltante, consignación)", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  let kgId: string;
  let muzzaA: string;
  let muzzaB: string;
  let jamon: string;
  let vino: string;
  let pizza: string;
  let copa: string;
  let sandwich: string;
  let torta: string;
  const OCT = new Date("2026-10-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId: admin.id, sucursalId, sucursalNombre: "Central" };

    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    kgId = kg.id;
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Bodega" } });
    const insumoMuzza = await prisma.insumo.create({ data: { nombre: "Muzzarella" } });

    muzzaA = (await sembrarProductoDisponible({ codigo: "MP_MUZZA_A", nombre: "MuzzaA", tipo: "MP", unidadStockId: kgId, insumoId: insumoMuzza.id }, sucursalId)).id;
    muzzaB = (await sembrarProductoDisponible({ codigo: "MP_MUZZA_B", nombre: "MuzzaB", tipo: "MP", unidadStockId: kgId, insumoId: insumoMuzza.id }, sucursalId)).id;
    jamon = (await sembrarProductoDisponible({ codigo: "MP_JAMON", nombre: "Jamón", tipo: "MP", unidadStockId: kgId }, sucursalId)).id;
    vino = (await sembrarProductoDisponible({ codigo: "MP_VINO", nombre: "Vino", tipo: "MP", unidadStockId: kgId, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 100 }, sucursalId)).id;

    pizza = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 12000 }, sucursalId)).id;
    copa = (await sembrarProductoDisponible({ codigo: "PV_COPA", nombre: "Copa", tipo: "PV", unidadStockId: kgId, precioVenta: 2000 }, sucursalId)).id;
    sandwich = (await sembrarProductoDisponible({ codigo: "PV_SANDWICH", nombre: "Sandwich", tipo: "PV", unidadStockId: kgId, precioVenta: 3000 }, sucursalId)).id;
    torta = (await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: kgId, seProduce: true, precioVenta: 5000 }, sucursalId)).id;

    await prisma.recetaVersion.create({ data: { productoId: pizza, version: 1, ingredientes: { create: [{ insumoProductoId: muzzaA, cantidad: 0.5, unidadId: kgId, mermaPorcentaje: 0 }] } } });
    await prisma.recetaVersion.create({ data: { productoId: copa, version: 1, ingredientes: { create: [{ insumoProductoId: vino, cantidad: 0.15, unidadId: kgId, mermaPorcentaje: 0 }] } } });
    await prisma.recetaVersion.create({ data: { productoId: sandwich, version: 1, ingredientes: { create: [{ insumoProductoId: jamon, cantidad: 0.2, unidadId: kgId, mermaPorcentaje: 0 }] } } });

    // Costo de reposición determinístico: MuzzaA y MuzzaB con costos DISTINTOS (1000 y 1200/kg) — el costo de Pizza queda anclado a
    // MuzzaA (el producto de la receta), sin importar cuál hermano consuma la venta (plan §0.5/D7).
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: muzzaA, cantidad: 0.3, precioTotal: 300 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: muzzaB, cantidad: 0.3, precioTotal: 360 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: vino, cantidad: 2, precioTotal: 200 }] });
    // Jamón: sin ninguna compra — sin stock y sin costo de reposición.
    await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: torta, cantidad: 2, loteVencimiento: OCT }] });
  });

  const filasDeLaVenta = (operacionIds: string[]) =>
    prisma.movimientoStock.findMany({ where: { operacionId: { in: operacionIds } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  const resumen = (filas: Awaited<ReturnType<typeof filasDeLaVenta>>) =>
    filas.map((m) => [
      m.proceso,
      m.productoId,
      m.seccionId,
      Number(m.cantidad),
      m.loteVencimiento?.toISOString().slice(0, 10) ?? null,
      m.detalle,
      Number(m.precioTotal),
      Number(m.precioPorUnidadStock),
      m.costoUnitarioVenta === null ? null : Number(m.costoUnitarioVenta),
    ]);

  const lineas = () => [
    { productoId: pizza, cantidadVendida: 1 },
    { productoId: copa, cantidadVendida: 1 },
    { productoId: sandwich, cantidadVendida: 1 },
    { productoId: torta, cantidadVendida: 1 },
  ];

  it("modo POS (permitirStockNegativo): filas completas y en orden, avisosStockNegativo y mensaje", async () => {
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, actor, { fecha: new Date("2026-09-26"), origen: { tipo: "seccion", seccionId }, lineas: lineas() }, { permitirStockNegativo: true })
    );
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Se registraron 4 venta(s) correctamente.");
    expect(r.avisosStockNegativo).toEqual([
      { productoId: jamon, nombre: "Jamón", seccionId, seccionNombre: "Depósito", actual: 0, requerido: 0.2, resultante: -0.2 },
    ]);

    const filas = await filasDeLaVenta(r.operacionIds);
    expect(filas).toHaveLength(9);
    expect(resumen(filas)).toEqual([
      ["CONSUMO", muzzaA, seccionId, -0.3, null, 'Consumo por venta de "Pizza".', 0, 0, null],
      ["CONSUMO", muzzaB, seccionId, -0.2, null, 'Consumo por venta de "Pizza".', 0, 0, null],
      ["VENTA", pizza, seccionId, -1, null, "Venta", 12000, 12000, 500],
      ["CONSUMO", vino, seccionId, -0.15, null, 'Consumo por venta de "Copa".', 0, 0, null],
      ["LIQUIDACION_CONSIGNACION", vino, seccionId, 0, null, 'Liquidación consignación por venta de "Copa".', 15, 100, null],
      ["VENTA", copa, seccionId, -1, null, "Venta", 2000, 2000, 15],
      ["CONSUMO", jamon, seccionId, -0.2, null, 'Consumo por venta de "Sandwich".', 0, 0, null],
      ["VENTA", sandwich, seccionId, -1, null, "Venta", 3000, 3000, null],
      ["VENTA", torta, seccionId, -1, "2026-10-01", "Venta", 5000, 5000, null],
    ]);
  });

  it("mostrador (sin permitirStockNegativo): se rechaza por el faltante de Jamón, mensaje exacto, nada escrito", async () => {
    const r = await registrarVenta({ fecha: new Date("2026-09-26"), seccionId, ventas: lineas() });
    expect(r).toEqual({ ok: false, mensaje: 'Stock insuficiente para "Jamón". Actual: 0, requerido: 0.2.' });
    expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO", "LIQUIDACION_CONSIGNACION"] } } })).toBe(0);
  });
});
