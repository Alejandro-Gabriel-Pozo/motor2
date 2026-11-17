import { describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../setup/test-db";

/**
 * Índice parcial `MovimientoStock_productoId_compra_idx` (migración `indice_compras_por_producto`): Prisma no puede declararlo en
 * `schema.prisma`, así que nada del resto de la suite se entera si alguien lo borra. Se lee de `pg_catalog` y se le pide al planner la
 * consulta de "compras de un producto" con el escaneo secuencial apagado (la tabla de test está casi vacía: sin apagarlo el planner
 * elegiría el secuencial aunque el índice exista).
 *
 * Robustez (Compras N3, hallazgo del verificador del PR #364): según qué tests corrieron antes, las estadísticas de la tabla quedaban viejas y el planner elegía otro índice
 * (el de `productoId, seccionId, loteVencimiento`). Se hace `ANALYZE` de `MovimientoStock` ANTES del `EXPLAIN` con el rol dueño (el rol de ejecución no puede analizar una tabla ajena) para que la
 * decisión parta siempre de las estadísticas reales de la tabla.
 */
describe("índice parcial de compras por producto", () => {
  it("existe, es parcial sobre proceso = COMPRA y el planner lo usa para las compras de un producto", async () => {
    const [indice] = await prisma.$queryRaw<Array<{ definicion: string }>>`
      SELECT indexdef AS definicion FROM pg_indexes WHERE tablename = 'MovimientoStock' AND indexname = 'MovimientoStock_productoId_compra_idx'`;
    expect(indice, "falta el índice parcial").toBeDefined();
    expect(indice.definicion).toContain('("productoId")');
    expect(indice.definicion).toMatch(/WHERE \(?\(?"?proceso"? = 'COMPRA'/);

    await prismaAdmin.$executeRawUnsafe('ANALYZE "MovimientoStock"');
    // Con el rol dueño (sin la condición de la política por empresa, que el planner a veces prefiere resolver con el índice de `empresaId`): el plan prueba SOLO que el índice parcial sirve para esta consulta.
    const plan = await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<Array<{ "QUERY PLAN": string }>>`
        EXPLAIN SELECT "id" FROM "MovimientoStock" WHERE "proceso" = 'COMPRA' AND "productoId" = 'x'`;
    });
    expect(plan.map((f) => f["QUERY PLAN"]).join("\n")).toContain("MovimientoStock_productoId_compra_idx");
  });
});
