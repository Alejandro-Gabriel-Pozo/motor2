import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cadenasDeGrupos } from "../../src/server/consultas/catalogo/grupos";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 (N+1 de la pantalla de grupos de insumos; auditoría de la Fase 3, hallazgo 5 — la descripción del PR #74 lo afirmaba y ningún test lo contaba): la cadena legible de
 * CADA grupo («Bebidas > Sin alcohol > Gaseosas») sale de una sola lectura del árbol, no de una consulta por grupo y por nivel. Con `$extends` se cuentan las operaciones sobre `grupo`.
 */
describe("cadenasDeGrupos: las cadenas de todos los grupos salen de UNA lectura del árbol", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  const contando = () => {
    const operaciones: string[] = [];
    const db = prisma.$extends({
      query: {
        grupo: {
          $allOperations({ operation, args, query }) {
            operaciones.push(operation);
            return query(args);
          },
        },
      },
    }) as unknown as Db;
    return { db, operaciones };
  };

  it("arma las cadenas de tres niveles, de uno y de una raíz sola, en el orden pedido, con UNA operación sobre grupo", async () => {
    const raiz = await prisma.grupo.create({ data: { nombre: "Bebidas" } });
    const medio = await prisma.grupo.create({ data: { nombre: "Sin alcohol", grupoPadreId: raiz.id } });
    const hoja = await prisma.grupo.create({ data: { nombre: "Gaseosas", grupoPadreId: medio.id } });
    const otra = await prisma.grupo.create({ data: { nombre: "Secos" } });
    const { db, operaciones } = contando();

    const cadenas = await cadenasDeGrupos([hoja.id, otra.id, medio.id, raiz.id], db);

    expect(cadenas).toEqual(["Bebidas > Sin alcohol > Gaseosas", "Secos", "Bebidas > Sin alcohol", "Bebidas"]);
    expect(operaciones, "una sola lectura del árbol, sin importar cuántos grupos ni cuántos niveles").toEqual(["findMany"]);
  });

  it("con muchos grupos sigue siendo UNA lectura (no crece con la cantidad ni la profundidad)", async () => {
    let padre: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const g: { id: string } = await prisma.grupo.create({ data: { nombre: `Nivel ${i}`, grupoPadreId: padre } });
      ids.push(g.id);
      padre = g.id;
    }
    const { db, operaciones } = contando();
    const cadenas = await cadenasDeGrupos(ids, db);
    expect(cadenas).toHaveLength(12);
    expect(cadenas[11].split(" > ")).toHaveLength(12);
    expect(operaciones).toEqual(["findMany"]);
  });

  it("sin grupos pedidos devuelve [] (y lee el árbol una vez)", async () => {
    const { db, operaciones } = contando();
    expect(await cadenasDeGrupos([], db)).toEqual([]);
    expect(operaciones).toEqual(["findMany"]);
  });
});
