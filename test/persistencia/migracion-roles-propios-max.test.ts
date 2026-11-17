import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Roles propios por empresa (frente 4, P2) — migración 20261117100100_roles_propios_max: la columna `Empresa.rolesPropiosMax` NOT NULL DEFAULT 0 con CHECK entre 0 y 1000. Toda empresa EXISTENTE queda en 0 y conserva sus roles propios
 * (nada se desactiva ni se edita). `down.sql` ABORTA si la plataforma subió la perilla en alguna empresa y, si no, la quita; `verificacion-previa.sql` corre y es de solo lectura.
 * Mutación: DEFAULT 1 → rojo «queda en 0»; sacar el CHECK → rojo «rechaza -1 y 1001».
 */
const NOMBRE = "20261117100100_roles_propios_max";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de la perilla de roles propios", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const e of ["emp-a", "emp-b"]) await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('a-admin', 'emp-a', 'admin', 'admin'), ('a-propio', 'emp-a', 'cajero', NULL)`);
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("toda empresa existente queda en 0 y conserva sus roles (ninguno se toca)", async () => {
    expect((await q(`SELECT "id", "rolesPropiosMax" FROM "Empresa" WHERE "id" IN ('emp-a', 'emp-b') ORDER BY "id"`)).rows).toEqual([{ id: "emp-a", rolesPropiosMax: 0 }, { id: "emp-b", rolesPropiosMax: 0 }]);
    expect((await q(`SELECT count(*)::int AS n FROM "Rol" WHERE "empresaId" = 'emp-a' AND "activo"`)).rows[0].n).toBe(2);
  });

  it("una empresa nueva nace en 0 y la base rechaza un valor negativo o mayor que 1000", async () => {
    await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-c', 'emp-c', 'emp-c', 'America/Argentina/Buenos_Aires', 'ARS')`);
    expect((await q(`SELECT "rolesPropiosMax" FROM "Empresa" WHERE "id" = 'emp-c'`)).rows[0].rolesPropiosMax).toBe(0);
    await expect(q(`UPDATE "Empresa" SET "rolesPropiosMax" = -1 WHERE "id" = 'emp-c'`)).rejects.toThrow(/Empresa_rolesPropiosMax_check/);
    await expect(q(`UPDATE "Empresa" SET "rolesPropiosMax" = 1001 WHERE "id" = 'emp-c'`)).rejects.toThrow(/Empresa_rolesPropiosMax_check/);
  });

  it("verificacion-previa.sql corre y no modifica nada (solo cuentas)", async () => {
    const antes = (await q(`SELECT count(*)::int AS n, sum("rolesPropiosMax")::int AS s FROM "Empresa"`)).rows[0];
    await q(leer("verificacion-previa.sql"));
    expect((await q(`SELECT count(*)::int AS n, sum("rolesPropiosMax")::int AS s FROM "Empresa"`)).rows[0]).toEqual(antes);
  });

  it("down.sql ABORTA, sin tocar nada, si la plataforma subió la perilla en alguna empresa; si no, quita la columna y se puede volver a subir", async () => {
    await q(`UPDATE "Empresa" SET "rolesPropiosMax" = 2 WHERE "id" = 'emp-a'`);
    await expect(q(leer("down.sql"))).rejects.toThrow(/distinto de 0/);
    expect((await q(`SELECT "rolesPropiosMax" FROM "Empresa" WHERE "id" = 'emp-a'`)).rows[0].rolesPropiosMax).toBe(2);
    await q(`UPDATE "Empresa" SET "rolesPropiosMax" = 0`);
    await q(leer("down.sql"));
    expect((await q(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Empresa' AND column_name = 'rolesPropiosMax'`)).rows[0].n).toBe(0);
    await q(leer("down.sql")); // idempotente
    await q(leer("migration.sql"));
    expect((await q(`SELECT count(*)::int AS n FROM "Empresa" WHERE "rolesPropiosMax" = 0`)).rows[0].n).toBe(4); // emp-a, emp-b, emp-c y la empresa que sembró una migración anterior
  });
});
