import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { armarAlertasStock } from "../../src/core/stock/alertas";

/**
 * El ORDEN de las alertas de stock es total (Pureza, Hito 2, hallazgo O.40 (4)): estado (CRÍTICO primero), producto, sección y, a igualdad de todo eso, id de la sección. Antes
 * el `sort` solo miraba estado y producto, y dos alertas del MISMO producto y estado en secciones distintas salían en el orden en que el `groupBy` de la base las entregaba (que
 * Postgres no garantiza). Con este test el resultado no depende del orden de entrada de los saldos.
 */
const secciones = [
  { id: "s-a", nombre: "Barra" },
  { id: "s-b", nombre: "Cocina" },
  { id: "s-c", nombre: "Depósito" },
];
const productos = [
  { id: "p1", codigo: "P1", nombre: "Harina" },
  { id: "p2", codigo: "P2", nombre: "Azúcar" },
];
const minimos = productos.map((p) => ({ productoId: p.id, seccionId: null, minimo: 10 }));
const saldo = (productoId: string, seccionId: string, saldoActual: number) => ({ productoId, seccionId, saldo: saldoActual, ultimaFecha: null });
const SALDOS = [saldo("p1", "s-c", 0), saldo("p1", "s-a", 3), saldo("p2", "s-b", 4), saldo("p1", "s-b", 5), saldo("p2", "s-a", -1), saldo("p2", "s-c", 6)];

describe("armarAlertasStock: orden total", () => {
  it("CRÍTICO primero, después por producto y por sección; el orden de los saldos de entrada no cambia nada", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(SALDOS, { minLength: SALDOS.length, maxLength: SALDOS.length }), (barajados) => {
        const filas = armarAlertasStock({ saldos: barajados, productos, secciones, minimos });
        expect(filas.map((f) => `${f.estado} ${f.productoNombre} / ${f.seccionNombre}`)).toEqual([
          "CRITICO Azúcar / Barra",
          "CRITICO Harina / Depósito",
          "BAJO Azúcar / Cocina",
          "BAJO Azúcar / Depósito",
          "BAJO Harina / Barra",
          "BAJO Harina / Cocina",
        ]);
      }),
      { numRuns: 100 },
    );
  });
});
