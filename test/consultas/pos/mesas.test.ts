import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { obtenerLimiteMesasAbiertas } from "../../../src/server/consultas/pos/mesas";

/**
 * `src/server/consultas/pos/mesas.ts` (Task #41, Fase D8) contra Postgres real.
 *
 * `obtenerLimiteMesasAbiertas` reemplaza, SIN cambiar su forma, la consulta en línea del mapa de mesas (`/mesas`): se fija que
 * devuelva SOLO `{ maxMesasAbiertas }` de la sucursal pedida (no de otra) y que, por ser `findUniqueOrThrow`, LANCE si la
 * sucursal no existe en vez de devolver `null` (que la página leería como «sin límite»).
 */

describe("server/consultas/pos/mesas", () => {
  let conLimite: string;
  let sinLimite: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    conLimite = (await prisma.sucursal.create({ data: { nombre: "Con límite", maxMesasAbiertas: 7 } })).id;
    sinLimite = (await prisma.sucursal.create({ data: { nombre: "Sin límite" } })).id;
  });

  describe("obtenerLimiteMesasAbiertas", () => {
    it("devuelve SOLO { maxMesasAbiertas } con el límite sembrado de ESA sucursal", async () => {
      const r = await obtenerLimiteMesasAbiertas(conLimite);
      expect(r).toEqual({ maxMesasAbiertas: 7 });
      expect(Object.keys(r)).toEqual(["maxMesasAbiertas"]);
    });

    it("una sucursal sin límite devuelve { maxMesasAbiertas: null } (no la de otra sucursal)", async () => {
      await expect(obtenerLimiteMesasAbiertas(sinLimite)).resolves.toEqual({ maxMesasAbiertas: null });
    });

    it("un id que no existe LANZA (findUniqueOrThrow, P2025), no devuelve null", async () => {
      await expect(obtenerLimiteMesasAbiertas("no-existe")).rejects.toMatchObject({ code: "P2025" });
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      await prisma.sucursal.update({ where: { id: conLimite }, data: { maxMesasAbiertas: 3 } });
      await expect(prisma.$transaction((tx) => obtenerLimiteMesasAbiertas(conLimite, tx))).resolves.toEqual({ maxMesasAbiertas: 3 });
    });
  });
});
