import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Nombres visibles de los roles de fábrica (P3) — migración 20261117100200_nombres_visibles_de_roles: «operador»→«empleado» y «admin»→«administrador» POR CLAVE (nunca por nombre), sin tocar los renombrados a mano
 * y salteando la empresa que ya tiene OTRO rol con el nombre de destino. También prueba `down.sql` (el inverso con la misma salvaguarda: aborta si hay conflicto) y que `verificacion-previa.sql` corre y solo lee.
 * Mutación: quitar `"nombre" = 'operador'` del WHERE → rojo en «renombrado a mano»; quitar el NOT EXISTS → rojo en «conflicto» (choque de único o pisada).
 */
const NOMBRE = "20261117100200_nombres_visibles_de_roles";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de nombres visibles de roles: por clave, sin pisar renombrados ni conflictos, y reversa", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const nombres = async () => Object.fromEntries((await q(`SELECT "id", "nombre" FROM "Rol" WHERE "id" LIKE 't-%' ORDER BY "id"`)).rows.map((r) => [r.id, r.nombre]));

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const id of ["emp-fab", "emp-mano", "emp-conf"]) {
      await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda", "estado") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS', 'ACTIVE')`, [id]);
    }
    const rol = (id: string, empresa: string, nombre: string, clave: string | null) => q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    await rol("t-fab-admin", "emp-fab", "admin", "admin");
    await rol("t-fab-oper", "emp-fab", "operador", "operador");
    await rol("t-fab-mozo", "emp-fab", "mozo", null); // a mano, sin clave: ni se mira
    await rol("t-mano-admin", "emp-mano", "dueño", "admin"); // renombrado a mano
    await rol("t-mano-oper", "emp-mano", "Salón", "operador"); // renombrado a mano
    await rol("t-conf-admin", "emp-conf", "admin", "admin");
    await rol("t-conf-oper", "emp-conf", "operador", "operador");
    await rol("t-conf-otro-emp", "emp-conf", "Empleado", null); // otro rol ya llamado «empleado»
    await rol("t-conf-otro-adm", "emp-conf", "administrador", null); // otro rol ya llamado «administrador»
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("renombra los roles de fábrica por clave y deja las claves como estaban", async () => {
    const n = await nombres();
    expect(n["t-fab-admin"]).toBe("administrador");
    expect(n["t-fab-oper"]).toBe("empleado");
    expect(n["t-fab-mozo"]).toBe("mozo");
    expect((await q(`SELECT "id", "clave" FROM "Rol" WHERE "id" IN ('t-fab-admin','t-fab-oper') ORDER BY "id"`)).rows).toEqual([{ id: "t-fab-admin", clave: "admin" }, { id: "t-fab-oper", clave: "operador" }]);
  });

  it("no toca los roles de fábrica que la empresa renombró a mano", async () => {
    const n = await nombres();
    expect(n["t-mano-admin"]).toBe("dueño");
    expect(n["t-mano-oper"]).toBe("Salón");
  });

  it("saltea el rol de fábrica de la empresa que ya tiene OTRO rol con el nombre de destino", async () => {
    const n = await nombres();
    expect(n["t-conf-admin"]).toBe("admin");
    expect(n["t-conf-oper"]).toBe("operador");
    expect(n["t-conf-otro-emp"]).toBe("Empleado");
    expect(n["t-conf-otro-adm"]).toBe("administrador");
  });

  it("es idempotente: volver a correrla no cambia nada", async () => {
    const antes = await nombres();
    await q(leer("migration.sql"));
    expect(await nombres()).toEqual(antes);
  });

  it("verificacion-previa.sql corre y no modifica nada", async () => {
    const antes = await nombres();
    await q(leer("verificacion-previa.sql"));
    expect(await nombres()).toEqual(antes);
  });

  it("down.sql ABORTA, sin tocar nada, si una empresa ya tiene otro rol con el nombre de destino", async () => {
    await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('t-conf-otro-op', 'emp-fab', 'operador', NULL)`); // emp-fab ya tiene el de fábrica como «empleado»
    const antes = await nombres();
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se revierte/);
    expect(await nombres()).toEqual(antes);
    await q(`DELETE FROM "Rol" WHERE "id" = 't-conf-otro-op'`);
  });

  it("down.sql devuelve los nombres de fábrica por clave, sin tocar renombrados a mano ni los salteados, y se puede volver a subir", async () => {
    await q(`DELETE FROM "Rol" WHERE "id" = 't-conf-otro-adm'`); // fuera el conflicto del admin para que el inverso sea limpio
    await q(leer("down.sql"));
    const n = await nombres();
    expect(n["t-fab-admin"]).toBe("admin");
    expect(n["t-fab-oper"]).toBe("operador");
    expect(n["t-mano-admin"]).toBe("dueño");
    expect(n["t-mano-oper"]).toBe("Salón");
    expect(n["t-conf-otro-emp"]).toBe("Empleado");
    await q(leer("migration.sql"));
    expect((await nombres())["t-fab-oper"]).toBe("empleado");
  });
});
