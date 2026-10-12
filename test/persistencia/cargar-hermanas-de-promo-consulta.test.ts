import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { cargarHermanasDePromo } from "../../src/server/persistencia/movimientos/cargar-venta-para-anular";

/**
 * SIN base: la consulta de `cargarHermanasDePromo` lleva el `orderBy` determinista (`creadoEn` y, a igualdad, id). El orden real de las filas lo comprueba
 * `cargar-venta-para-anular-orden.test.ts` (con base); este caso espía los argumentos que recibe `findMany` y fija la forma de la consulta, para que sacar el
 * `orderBy` se vea aun donde no hay Postgres. Limitación: verifica lo que se le PIDE a la base, no lo que ésta devuelve.
 */
describe("cargarHermanasDePromo: la consulta pide un orden total", () => {
  function txEspia() {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { operacion: { findMany } } as unknown as Prisma.TransactionClient;
    return { tx, findMany };
  }

  it("ordena las hermanas por creadoEn y, a igualdad, por id", async () => {
    const { tx, findMany } = txEspia();
    await cargarHermanasDePromo(tx, { promoCuentaId: "promo1", excluirOperacionId: "op1" });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual([{ creadoEn: "asc" }, { id: "asc" }]);
  });

  it("conserva el filtro (vigentes de la misma promo, sin la pedida) y las líneas en orden de escritura", async () => {
    const { tx, findMany } = txEspia();
    await cargarHermanasDePromo(tx, { promoCuentaId: "promo1", excluirOperacionId: "op1" });
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ promoCuentaId: "promo1", anuladaEn: null, id: { not: "op1" } });
    expect(args.include).toEqual({ movimientos: { include: { producto: true }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] } });
  });
});
