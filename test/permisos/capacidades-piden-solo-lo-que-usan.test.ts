import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "../../src/server/acceso/capacidades-sucursal";
import type { Db } from "../../src/lib/db-tipos";

/**
 * GT-13 (tanda T9 del endurecimiento de seguridad; requisito del dueño: la carta pública lee una lista CERRADA de campos). El lector de las capacidades por sucursal lo alcanza
 * la carta pública (el precio local depende de la capacidad `precio_local`) y lo usan el gate y el menú: leía la FILA ENTERA de `CapacidadSucursal` (id, empresa, fechas…) para
 * devolver un booleano. Ahora pide solo las tres columnas que la regla (`resolverCapacidad`) usa. No cambia el resultado ni la cantidad de consultas; achica lo que viaja de la base.
 *
 * El ataque que reproduce: las dos lecturas llegan a la base SIN `select`. Rojo contra el código anterior; el resultado de las capacidades lo siguen probando
 * `test/core/capacidades-sucursal.test.ts` y `test/catalogo/precio-local-capacidad.test.ts`.
 */
let sucursalId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  sucursalId = (await sembrarBase()).sucursal.id;
  await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId, habilitado: false } });
});

/** Un cliente que anota los argumentos de cada consulta que hace. */
function conArgumentos() {
  const llamadas: Array<{ modelo: string | undefined; operacion: string; args: { select?: unknown } }> = [];
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        llamadas.push({ modelo: model, operacion: operation, args: args as { select?: unknown } });
        return query(args);
      },
    },
  }) as unknown as Db;
  return { db, llamadas };
}

const SOLO_LO_QUE_USA_LA_REGLA = { accionClave: true, sucursalId: true, habilitado: true };

describe("el lector de capacidades pide solo las columnas que usa", () => {
  it("sucursalTieneCapacidad: una consulta, con select de las tres columnas, y el mismo resultado", async () => {
    const { db, llamadas } = conArgumentos();
    expect(await sucursalTieneCapacidad(sucursalId, "precio_local", db)).toBe(false);
    expect(llamadas.map((l) => `${l.modelo}.${l.operacion}`)).toEqual(["CapacidadSucursal.findMany"]);
    expect(llamadas[0].args.select).toEqual(SOLO_LO_QUE_USA_LA_REGLA);
  });

  it("capacidadesDeSucursal: una consulta, con select de las tres columnas, y el mismo resultado", async () => {
    const { db, llamadas } = conArgumentos();
    expect([...(await capacidadesDeSucursal(sucursalId, ["precio_local", "carta_ver"], db))]).toEqual(["carta_ver"]);
    expect(llamadas.map((l) => `${l.modelo}.${l.operacion}`)).toEqual(["CapacidadSucursal.findMany"]);
    expect(llamadas[0].args.select).toEqual(SOLO_LO_QUE_USA_LA_REGLA);
  });
});
