import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pivote 4 (Precisión numérica) — Plan N3 (docs/auditoria-motor2-pivotes-2026-09-16.md
 * §11): prueba de regresión. Hasta la corrección de este paquete,
 * src/server/actions/movimientos.ts (PRODUCCION → consumosReceta)
 * persistía el consumo de receta SIN pasar por redondearACantidadDeUnidad
 * — a diferencia de venta.ts, que SÍ redondea la misma clase de dato
 * (`cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, ...)`)
 * antes de persistir. Exige ahora el comportamiento CORRECTO.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";

describe("Auditoría — Pivote 4: PRODUCCIÓN persiste el consumo de receta sin redondear a la unidad del insumo", () => {
  let sucursalId: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("REGRESIÓN: produce un PV cuya receta consume un insumo de unidad SIN decimales (entera) — el consumo persistido debe redondearse a un entero, no violar la unidad", async () => {
    const unidadEntera = await prisma.unidad.create({ data: { nombre: "unidad_entera_prod", magnitud: "CANTIDAD", decimales: 0 } });
    const mpInsumo = await prisma.producto.create({ data: { codigo: "MP_HUEVOS", nombre: "Huevos", tipo: "MP", unidadStockId: unidadEntera.id } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_BUDIN", nombre: "Budín", tipo: "PV", unidadStockId: unidadEntera.id, precioVenta: 10, seProduce: true } });
    // cantidadSalida = 7 (producido) × 0.3 × 1.07 = 2.247 — no es entero,
    // pero la unidad del insumo (Huevos) tiene decimales:0.
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.3, unidadId: unidadEntera.id, mermaPorcentaje: 7 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 1000 }] });

    const resultado = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId, items: [{ productoId: pv.id, cantidad: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mpInsumo.id, proceso: "CONSUMO" } });
    const cantidadPersistida = Number(mov.cantidad);

    console.log("[auditoria] Consumo persistido para un insumo de unidad SIN decimales:", cantidadPersistida);

    // Unidad.decimales=0 dice explícitamente que este insumo no admite
    // fracciones — el Kardex debe quedar con un entero exacto, mismo
    // criterio que COMPRA/CONSUMO/VENTA/AJUSTE/DEVOLUCIÓN/TRANSFERENCIA
    // ya respetan hoy.
    expect(Number.isInteger(cantidadPersistida)).toBe(true);
    expect(cantidadPersistida).toBe(-2); // redondearACantidadDeUnidad(2.247, 0) === 2
  });

  it("Contraste: el mismo escenario via VENTA (no PRODUCCIÓN) SÍ redondea correctamente a la unidad del insumo", async () => {
    const unidadEntera = await prisma.unidad.create({ data: { nombre: "unidad_entera_venta", magnitud: "CANTIDAD", decimales: 0 } });
    const mpInsumo = await prisma.producto.create({ data: { codigo: "MP_HUEVOS_V", nombre: "Huevos V", tipo: "MP", unidadStockId: unidadEntera.id } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_BUDIN_V", nombre: "Budín V", tipo: "PV", unidadStockId: unidadEntera.id, precioVenta: 10 } }); // seProduce: false (default) → consumo vía VENTA
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.3, unidadId: unidadEntera.id, mermaPorcentaje: 7 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 1000 }] });

    const { registrarVenta } = await import("../../src/server/actions/venta");
    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mpInsumo.id, proceso: "CONSUMO" } });
    const cantidadPersistida = Number(mov.cantidad);
    console.log("[auditoria] Mismo caso vía VENTA:", cantidadPersistida);
    expect(Number.isInteger(cantidadPersistida)).toBe(true); // VENTA sí redondea — confirma que es un problema específico de PRODUCCIÓN
  });
});
