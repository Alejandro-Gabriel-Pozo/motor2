import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { generarConciliacionVencimientos } from "../../src/server/consultas/reportes/vencimientos";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 — conciliación de vencimientos. Por cada lote que «desaparece» entre dos conteos se sumaban las ventas y consumos del período con UNA consulta
 * (`aggregate`), dentro de tres bucles anidados: la cantidad de consultas crecía con los lotes desaparecidos. Ahora todas las ventas y consumos de los productos
 * involucrados se leen JUNTAS y se suman por ventana, en decimal exacto (la suma de la base es exacta: sumar con coma flotante daría 0,7999… donde la base da 0,8).
 */
describe("conciliación de vencimientos: las ventas y consumos del período salen de una sola lectura", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let destinoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    destinoId = (await sembrarMotivosYDestinos()).destinos.get("Elaboración interna")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Un producto con un lote contado el 1/1 (con `contado`) que desaparece el 3/1, tras consumir `consumos` el 2/1. */
  async function loteQueDesaparece(codigo: string, nombre: string, contado: number, consumos: number[]) {
    const mp = await sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const lote = new Date("2026-03-10");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: contado, loteVencimiento: lote }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: contado, fechaConteo: new Date("2026-01-01"), accion: "AJUSTAR" });
    for (const cantidad of consumos) {
      await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date("2026-01-02"), seccionId, destinoId, items: [{ productoId: mp.id, cantidad, loteVencimiento: lote }] });
    }
    await registrarConteoFisico({ productoId: mp.id, seccionId, loteVencimiento: lote, conteoReal: 0, fechaConteo: new Date("2026-01-03"), accion: "AJUSTAR" });
    return mp;
  }

  it("el resultado de cada lote es el de siempre, con consumos decimales sumados en forma exacta", async () => {
    await loteQueDesaparece("MP_A", "Harina", 10, [10]); // lo consumido cubre lo contado → consistente
    await loteQueDesaparece("MP_B", "Azúcar", 10, [3]); // no lo explica → revisar
    await loteQueDesaparece("MP_C", "Sal", 0.8, [0.1, 0.7]); // 0,1 + 0,7 = 0,8 EXACTO: con coma flotante daría 0,7999… y diría «revisar»

    const filas = await generarConciliacionVencimientos(sucursalId, prisma);
    const porNombre = new Map(filas.map((f) => [f.productoNombre, f]));

    expect(porNombre.get("Harina")).toMatchObject({ estado: "consistente", ventasPeriodo: 10, cantidadDesaparecida: 10 });
    expect(porNombre.get("Azúcar")).toMatchObject({ estado: "revisar", ventasPeriodo: 3, cantidadDesaparecida: 10 });
    expect(porNombre.get("Sal")).toMatchObject({ estado: "consistente", ventasPeriodo: 0.8, cantidadDesaparecida: 0.8 });
    expect(filas.map((f) => f.estado)).toEqual(["revisar", "consistente", "consistente"]); // los «revisar» primero
  });

  it("con varios lotes desaparecidos no hay una consulta por lote: ni un aggregate, y las ventas salen de UNA lectura", async () => {
    for (let i = 0; i < 5; i++) await loteQueDesaparece(`MP_${i}`, `Insumo ${i}`, 10, [i + 1]);

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

    const filas = await generarConciliacionVencimientos(sucursalId, dbContado);

    expect(filas.length, "no hay lotes desaparecidos: la prueba no mide nada").toBe(5);
    expect(operaciones.filter((o) => o === "aggregate")).toEqual([]);
    expect(operaciones.filter((o) => o === "findMany").length).toBeLessThanOrEqual(1);
  });
});
