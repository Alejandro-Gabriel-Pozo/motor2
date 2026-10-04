import { describe, expect, it } from "vitest";
import { prismaAdmin } from "../setup/test-db";
import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración 20261001220000_margen_objetivo: el food cost objetivo configurable (por empresa y por categoría). La parte de DATOS de permisos (la
 * clave nueva `margen_objetivo_editar` copia lo que cada rol ya tenía en `categorias`) usa el mismo banco de pruebas que las demás; la parte de
 * schema se comprueba contra la base ya migrada.
 */
probarMigracionDeParticion({
  directorio: "20261001220000_margen_objetivo",
  titulo: "clave del margen objetivo",
  desdeMarca: "-- Permisos (datos): clave nueva `margen_objetivo_editar`.",
  sentenciasEsperadas: 3,
});

describe("migración 20261001220000_margen_objetivo: estado del schema", () => {
  it("la tabla MargenObjetivo existe con sus columnas", async () => {
    const cols = (await prismaAdmin.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'MargenObjetivo'`)).map((c) => c.column_name);
    expect(cols).toEqual(expect.arrayContaining(["id", "empresaId", "categoriaId", "foodCostObjetivoPct"]));
  });

  it("tiene RLS por empresa como el resto de las tablas con empresaId", async () => {
    const r = await prismaAdmin.$queryRawUnsafe<{ rls: boolean; politicas: bigint }[]>(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'MargenObjetivo' AND p.policyname = 'aislamiento_empresa') AS politicas FROM pg_class c WHERE c.relname = 'MargenObjetivo'`
    );
    expect(r[0].rls).toBe(true);
    expect(Number(r[0].politicas)).toBe(1);
  });

  it("el CHECK rechaza un objetivo de 0 % y de 100 % y acepta uno intermedio", async () => {
    const { id: empresaId } = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: "empresa_principal" } });
    for (const malo of [0, 100, -5]) {
      await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "foodCostObjetivoPct") VALUES ('mo-check-${malo}', '${empresaId}', ${malo})`), String(malo)).rejects.toThrow(/MargenObjetivo_foodCostObjetivoPct_rango_check/);
    }
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "foodCostObjetivoPct") VALUES ('mo-check-ok', '${empresaId}', 35.5)`);
    await prismaAdmin.$executeRawUnsafe(`DELETE FROM "MargenObjetivo" WHERE id = 'mo-check-ok'`);
  });

  it("el índice parcial no deja dos objetivos de empresa (categoriaId nulo), y sí uno por categoría", async () => {
    const { id: empresaId } = await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: "empresa_principal" } });
    const categoria = await prismaAdmin.categoriaProducto.create({ data: { nombre: "Cat índice parcial", empresaId } });
    try {
      await prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "foodCostObjetivoPct") VALUES ('mo-emp-1', '${empresaId}', 30)`);
      await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "foodCostObjetivoPct") VALUES ('mo-emp-2', '${empresaId}', 31)`)).rejects.toThrow(/MargenObjetivo_empresaId_default_key/);
      await prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "categoriaId", "foodCostObjetivoPct") VALUES ('mo-cat-1', '${empresaId}', '${categoria.id}', 25)`);
      await expect(
        prismaAdmin.$executeRawUnsafe(`INSERT INTO "MargenObjetivo" (id, "empresaId", "categoriaId", "foodCostObjetivoPct") VALUES ('mo-cat-2', '${empresaId}', '${categoria.id}', 26)`)
      ).rejects.toThrow(/MargenObjetivo_empresaId_categoriaId_key/);
    } finally {
      await prismaAdmin.$executeRawUnsafe(`DELETE FROM "MargenObjetivo"`);
      await prismaAdmin.categoriaProducto.deleteMany({ where: { id: categoria.id } });
    }
  });
});
