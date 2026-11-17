import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULOS_DEL_PLAN_DE_TRANSICION } from "../../src/core/features/empresa/plan-de-transicion";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Planes versionados (frente 4, M1) — migración 20261117100000_planes_versionados: tablas, candados y BACKFILL de transición (el plan «actual» versión 1, publicado, asignado a TODA empresa existente en cualquier estado:
 * atomicidad del backfill, nadie queda sin plan). Base temporal armada migración por migración (las anteriores aplicadas, la nuestra a mano). También prueba `down.sql` (borra solo si lo único que hay es la semilla; ABORTA
 * si la plataforma cargó algo a mano; y la migración se puede volver a subir) y que `verificacion-previa.sql` corre y es de solo lectura.
 * Mutación: sacar una empresa del `INSERT … SELECT` del backfill → rojo «toda empresa existente»; sacar el `NOT EXISTS` → rojo del reintento.
 */
const NOMBRE = "20261117100000_planes_versionados";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de planes versionados: backfill de transición, candados y reversa", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const [id, estado] of [["emp-a", "ACTIVE"], ["emp-b", "SUSPENDED"], ["emp-c", "PROVISIONING"]] as const) {
      await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda", "estado") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS', $2::"EstadoEmpresa")`, [id, estado]);
    }
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("deja el plan «actual», sin precio, con UNA versión PUBLICADA número 1 cuyo techo son TODOS los módulos vendibles disponibles (la constante del código)", async () => {
    const planes = (await q(`SELECT "codigo", "estado" FROM "Plan"`)).rows;
    expect(planes).toEqual([{ codigo: "actual", estado: "ACTIVO" }]);
    const versiones = (await q(`SELECT "estado", "numero", "modulos", "publicadaPor" FROM "VersionDePlan"`)).rows;
    expect(versiones).toHaveLength(1);
    expect(versiones[0]).toMatchObject({ estado: "PUBLICADA", numero: 1, publicadaPor: "migracion:planes_versionados" });
    expect([...versiones[0].modulos].sort()).toEqual([...MODULOS_DEL_PLAN_DE_TRANSICION]);
  });

  it("toda empresa existente (activa, suspendida o en alta) recibe UNA asignación de transición, número 1, a esa versión", async () => {
    const filas = (await q(`SELECT "empresaId", "numero", "origen", "versionDePlanId" FROM "PlanDeEmpresa" ORDER BY "empresaId"`)).rows;
    expect(filas.map((f) => [f.empresaId, f.numero, f.origen])).toEqual([["emp-a", 1, "TRANSICION"], ["emp-b", 1, "TRANSICION"], ["emp-c", 1, "TRANSICION"], ["empresa_principal", 1, "TRANSICION"]]); // la cuarta es la empresa que sembró una migración anterior
    expect(new Set(filas.map((f) => f.versionDePlanId)).size).toBe(1);
    expect((await q(`SELECT count(*)::int AS n FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM "PlanDeEmpresa" p WHERE p."empresaId" = e."id")`)).rows[0].n).toBe(0);
  });

  it("el backfill es idempotente: volver a correr sus INSERT no duplica el plan ni las asignaciones", async () => {
    const backfill = leer("migration.sql").split("-- 8) Backfill")[1].split("\n").slice(1).join("\n");
    await q(backfill.replace(/UPDATE "VersionDePlan"[\s\S]*?AND "estado" = 'BORRADOR';/, ""));
    expect((await q(`SELECT count(*)::int AS n FROM "Plan"`)).rows[0].n).toBe(1);
    expect((await q(`SELECT count(*)::int AS n FROM "PlanDeEmpresa"`)).rows[0].n).toBe(4);
  });

  it("los candados quedan puestos: RLS en las tres tablas, políticas esperadas y la app sin escritura", async () => {
    const rls = (await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('Plan','VersionDePlan','PlanDeEmpresa') ORDER BY relname`)).rows;
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    const politicas = (await q(`SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('Plan','VersionDePlan','PlanDeEmpresa') ORDER BY 1, 2`)).rows.map((r) => `${r.tablename}:${r.policyname}`);
    expect(politicas).toEqual(["Plan:solo_plataforma", "PlanDeEmpresa:aislamiento_empresa", "PlanDeEmpresa:escritura_plataforma", "VersionDePlan:solo_plataforma"]);
  });

  it("verificacion-previa.sql corre y no modifica nada (cuentas y nombres de módulo, nunca datos personales)", async () => {
    const antes = (await q(`SELECT (SELECT count(*) FROM "PlanDeEmpresa") AS a, (SELECT count(*) FROM "Plan") AS b`)).rows[0];
    await q(leer("verificacion-previa.sql"));
    expect((await q(`SELECT (SELECT count(*) FROM "PlanDeEmpresa") AS a, (SELECT count(*) FROM "Plan") AS b`)).rows[0]).toEqual(antes);
  });

  it("down.sql ABORTA, sin tocar nada, si la plataforma cargó un plan a mano", async () => {
    await q(`INSERT INTO "Plan" ("id", "codigo", "claveIdempotencia", "payloadHash") VALUES ('00000000-0000-4000-8000-0000000b0001', 'a-mano', '00000000-0000-4000-8000-0000000b0002', 'h')`);
    await expect(q(leer("down.sql"))).rejects.toThrow(/cargadas a mano/);
    expect((await q(`SELECT count(*)::int AS n FROM "Plan"`)).rows[0].n).toBe(2);
  });

  it("down.sql borra la semilla pura (tablas y funciones) y la migración se puede volver a subir con el mismo resultado", async () => {
    // El `DELETE` de arriba lo frena el candado (los planes no se borran): para dejar solo la semilla se rehace desde cero.
    await q(`DROP TABLE "PlanDeEmpresa", "VersionDePlan", "Plan"`);
    await q(`DROP FUNCTION reglas_de_plan_de_empresa(), reglas_de_version_de_plan(), reglas_de_plan(), proteger_tablas_de_planes()`);
    await q(leer("migration.sql"));
    await q(leer("down.sql"));
    expect((await q(`SELECT to_regclass('"Plan"') AS p, to_regclass('"VersionDePlan"') AS v, to_regclass('"PlanDeEmpresa"') AS e`)).rows[0]).toEqual({ p: null, v: null, e: null });
    expect((await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('reglas_de_plan_de_empresa','reglas_de_version_de_plan','reglas_de_plan','proteger_tablas_de_planes')`)).rows[0].n).toBe(0);
    await q(leer("down.sql")); // idempotente
    await q(leer("migration.sql"));
    expect((await q(`SELECT count(*)::int AS n FROM "PlanDeEmpresa"`)).rows[0].n).toBe(4);
  });
});
