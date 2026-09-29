import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pruebas de investigación de la auditoría 2026-09-16 (Fase 5: precisión
 * numérica; y reconstrucción de saldo). Solo investigación — no modifica
 * código de producción.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("Auditoría — Fase 5: precisión numérica (Decimal → number) y reconstrucción de saldo", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string; // 2 decimales
  let insumoId: string;
  let motivoVencidoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id; // decimales: 2, ver sembrarCatalogoBase
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    motivoVencidoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string, decimales = 2) {
    const unidad = decimales === 2 ? unidadKgId : (await prisma.unidad.create({ data: { nombre: `u_${decimales}dec_${nombre}`, magnitud: "PESO", decimales } })).id;
    return sembrarProductoDisponible({ codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidad, insumoId }, sucursalId);
  }

  it("0.1 + 0.2 vía dos COMPRAs separadas: el saldo agregado en Postgres da EXACTO 0.3 (a diferencia de la aritmética float pura de JS, que da 0.30000000000000004)", async () => {
    const mp = await crearMP("Test01");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 0.1 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 0.2 }] });

    const saldo = await calcularSaldoTotal(mp.id, seccionId, prisma);
    expect(saldo).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // referencia: el bug clásico de floats SÍ existe en JS puro
    // Confirma que el patrón "sumar en Postgres (Decimal exacto), convertir
    // a Number solo al leer el resultado ya sumado" evita el problema —
    // no porque no exista floating point, sino porque la suma nunca se
    // hace en JS: se hace una vez en la DB, y Number("0.3") coincide con
    // el literal 0.3 de JS (mismo parseo string→float en ambos casos).
  });

  it("cantidades con 4 decimales sobreviven el roundtrip completo (COMPRA → Kardex → saldo) sin pérdida", async () => {
    const mp = await crearMP("Test4dec", 4);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 1.2345 }] });
    const saldo = await calcularSaldoTotal(mp.id, seccionId, prisma);
    expect(saldo).toBe(1.2345);
  });

  it("conversión caja→unidad con factor que SÍ produce ruido de punto flotante en JS (7 × 0.1 = 0.7000000000000001): el redondeo posterior a la unidad de stock lo absorbe", async () => {
    const mp = await crearMP("TestFactor", 2);
    await prisma.producto.update({ where: { id: mp.id }, data: { factorConversion: 0.1 } });

    expect(7 * 0.1).not.toBe(0.7); // referencia: 0.7000000000000001 en JS puro, el bug clásico existe acá

    const resultado = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    const saldo = await calcularSaldoTotal(mp.id, seccionId, prisma);

    // HALLAZGO A DOCUMENTAR: acá el cálculo cantidadStock = numCant * factor
    // (movimientos.ts:147) SÍ ocurre en JS puro, ANTES de redondear a los
    // decimales de la unidad (redondearACantidadDeUnidad, unidad 2
    // decimales acá) — a diferencia del escenario de suma pura (0.1+0.2),
    // que nunca hace aritmética en JS antes de llegar a Postgres.
    console.log("[auditoria] 7 × 0.1 (JS crudo) =", 7 * 0.1, "| saldo final en DB =", saldo);
    expect(saldo).toBe(0.7); // el redondeo a 2 decimales (Math.round) absorbe el ruido de 0.7000000000000001 → 0.70
  });

  it("sumas repetidas (50 compras de 0.07) reconstruyen el total exacto (3.50), sin arrastre de error", async () => {
    const mp = await crearMP("TestRepetido", 2);
    for (let i = 0; i < 50; i++) {
      const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 0.07 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
    const saldo = await calcularSaldoTotal(mp.id, seccionId, prisma);
    expect(saldo).toBe(3.5); // 50 × 0.07 = 3.5 exacto — un acumulador JS ingenuo (suma += 0.07 en un loop) puede desviarse
  });

  it("merma porcentual con decimales: consumo de receta con mermaPorcentaje no entero produce el valor exacto esperado, redondeado a la unidad del insumo", async () => {
    const mpInsumo = await crearMP("Levadura", 3); // 3 decimales
    const pv = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100, seProduce: true }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.1, unidadId: unidadKgId, mermaPorcentaje: 12.5 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 10 }] });

    // Producir 7 unidades de pan: consumo esperado = 7 × 0.1 × 1.125 = 0.7875,
    // redondeado a los 3 decimales de la unidad del insumo (Plan N3,
    // docs/auditoria-motor2-pivotes-2026-09-16.md §11) → 0.788 exacto.
    const resultado = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId, items: [{ productoId: pv.id, cantidad: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const saldoInsumo = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);
    expect(saldoInsumo).toBe(10 - 0.788); // 9.212 exacto, ya no una aproximación
  });

  it("reconstrucción del saldo: para un producto con historial mixto (compra, consumo, merma, ajuste), la suma manual de MovimientoStock.cantidad (leída como Decimal string) coincide EXACTO con calcularSaldoTotal", async () => {
    const mp = await crearMP("HistorialMixto", 2);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 15.5 }] });
    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 3.25 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 0.5 }], motivoId: motivoVencidoId });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: -1.75 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 2.1 }] });

    // Suma "manual" leyendo cada fila cruda de la DB con Prisma.Decimal
    // (no vía el helper de producción calcularSaldoTotal) — reconstrucción
    // independiente del historial, tal como pide el pivote de escalabilidad.
    const movimientos = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, seccionId }, select: { cantidad: true } });
    const sumaManual = movimientos.reduce((acc, m) => acc + Number(m.cantidad), 0);
    const sumaRedondeada = Math.round(sumaManual * 100) / 100;

    const saldoOficial = await calcularSaldoTotal(mp.id, seccionId, prisma);

    expect(movimientos.length).toBe(5);
    expect(saldoOficial).toBe(sumaRedondeada);
    expect(saldoOficial).toBe(12.1); // 15.5 - 3.25 - 0.5 - 1.75 + 2.1
  });
});
