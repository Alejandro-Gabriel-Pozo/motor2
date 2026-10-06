import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { enElPasado, DIA_MS } from "../setup/tiempo";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularStockConsolidado } from "../../src/server/consultas/stock/consolidado";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 — stock consolidado. «Entradas y salidas DESDE el último conteo» explica por qué el teórico de hoy ya no es el número que se contó ese
 * día. Antes se calculaba con una consulta por cada clave (producto + sección + lote) que tenía conteo; ahora con una consulta en lote. El resultado de
 * cada clave tiene que ser exactamente el mismo, con claves que tienen conteo y claves que no, con lote y sin lote, y en dos secciones.
 */
describe("calcularStockConsolidado: entradas y salidas desde el conteo", () => {
  let sucursalId: string;
  let seccionAId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionAId = (await sembrarSeccion(sucursalId)).id;
    seccionBId = (await sembrarSeccion(sucursalId, "Barra")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function producto(codigo: string, nombre: string) {
    return sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
  }

  it("cada clave con conteo recibe SUS entradas y salidas posteriores; las que no tienen conteo, cero", async () => {
    const harina = await producto("MP_H", "Harina");
    const azucar = await producto("MP_A", "Azúcar");
    const sal = await producto("MP_S", "Sal");

    // El conteo se fecha en el pasado: todo lo que se registra ahora es POSTERIOR al conteo.
    const fechaConteo = enElPasado(2 * DIA_MS);
    for (const [p, seccionId, cantidad] of [
      [harina, seccionAId, 10],
      [harina, seccionBId, 4],
      [azucar, seccionAId, 7],
    ] as const) {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: p.id, cantidad }] });
      await registrarConteoFisico({ productoId: p.id, seccionId, conteoReal: cantidad, fechaConteo, accion: "AJUSTAR" });
    }
    // Sal tiene movimientos pero NINGÚN conteo.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: sal.id, cantidad: 9 }] });

    // Movimientos posteriores al conteo: entradas y salidas distintas por clave.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: harina.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: harina.id, cantidad: 2 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionBId, items: [{ productoId: harina.id, cantidad: 1 }] });
    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: azucar.id, cantidad: 3 }] });

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    const clave = (productoId: string, seccionId: string) => filas.find((f) => f.productoId === productoId && f.seccionId === seccionId);
    const resumen = (f: ReturnType<typeof clave>) => ({ entradas: f?.entradasDesdeConteo, salidas: f?.salidasDesdeConteo, teorico: f?.teorico, fisico: f?.ultimoFisico });

    // Las entradas incluyen la compra que se contó (la fecha del conteo es anterior a todo): 10 + 5 y 2 de salida.
    expect(resumen(clave(harina.id, seccionAId))).toEqual({ entradas: 15, salidas: 2, teorico: 13, fisico: 10 });
    expect(resumen(clave(harina.id, seccionBId))).toEqual({ entradas: 5, salidas: 0, teorico: 5, fisico: 4 });
    expect(resumen(clave(azucar.id, seccionAId))).toEqual({ entradas: 7, salidas: 3, teorico: 4, fisico: 7 });
    expect(resumen(clave(sal.id, seccionAId))).toEqual({ entradas: 0, salidas: 0, teorico: 9, fisico: null });
  });

  it("las claves con conteo NO multiplican las consultas sobre el Kardex: los movimientos posteriores salen de una sola lectura", async () => {
    const productos = [] as { id: string }[];
    for (let i = 0; i < 6; i++) productos.push(await producto(`MP_${i}`, `Insumo ${i}`));
    for (const p of productos) {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: p.id, cantidad: 10 }] });
      await registrarConteoFisico({ productoId: p.id, seccionId: seccionAId, conteoReal: 10, fechaConteo: enElPasado(DIA_MS), accion: "AJUSTAR" });
    }

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

    const filas = await calcularStockConsolidado(sucursalId, dbContado);

    expect(filas.filter((f) => f.ultimoFisico !== null).length, "no hay claves con conteo: la prueba no mide nada").toBe(6);
    // Una agrupación (el teórico) y UNA lectura de los movimientos posteriores, sin importar cuántas claves tengan conteo.
    expect(operaciones.filter((o) => o === "findMany").length).toBeLessThanOrEqual(1);
    expect(operaciones.filter((o) => o === "groupBy").length).toBe(1);
  });
});
