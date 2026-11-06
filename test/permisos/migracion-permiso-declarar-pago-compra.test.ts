import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Pagos X0 — migración de DATOS 20261104111000_permiso_declarar_pago_compra: alta de la clave `declarar_pago_compra` (empresa, piso operario, clase O) y su siembra al rol de clave `admin` de cada empresa, con Ver y Editar,
 * y NADIE más (es dinero: ni el operador que carga compras ni un rol propio que anula o corrige compras la reciben). Hay DOS empresas para comprobar que cada fila nueva lleva el `empresaId` de su rol. Se corre sobre una base
 * temporal armada migración por migración (la anterior a la nuestra aplicada, la nuestra a mano). También comprueba su `down.sql`: borra la semilla pura y ABORTA si alguien configuró algo a mano.
 *
 * Mutación (anotada en el commit): sembrar a todos los roles en vez de solo `admin` → rojo «NINGÚN otro rol»; sacar el `ON CONFLICT DO NOTHING` → rojo «es idempotente».
 */
const NOMBRE = "20261104111000_permiso_declarar_pago_compra";
const CLAVE = "declarar_pago_compra";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos Pagos X0: la clave declarar_pago_compra", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

  const filasDeLaClave = async () =>
    (
      await base.cliente.query<{ rol: string; empresa: string; ver: boolean; editar: boolean; deLaFila: string }>(
        `SELECT p."rolId" AS rol, p."empresaId" AS empresa, p."puedeVer" AS ver, p."puedeEditar" AS editar, r."empresaId" AS "deLaFila"
         FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = $1 ORDER BY p."rolId"`,
        [CLAVE]
      )
    ).rows;
  const quienLaTiene = async () => (await filasDeLaClave()).map((f) => f.rol);

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const clave of ["proceso_compra", "anular_compra", "corregir_compra"]) {
      await q(`INSERT INTO "Accion" ("clave", "descripcion") VALUES ($1, $1) ON CONFLICT ("clave") DO NOTHING`, [clave]);
    }
    for (const e of ["emp-a", "emp-b"]) {
      await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    }
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"],
      ["a-operador", "emp-a", "operador", "operador"], // carga compras de fábrica
      ["a-encargado", "emp-a", "encargado", null], // rol propio: anula y corrige compras
      ["b-admin", "emp-b", "admin", "admin"],
    ];
    for (const [id, empresa, nombre, clave] of roles) await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    const permisos: [string, string, string][] = [
      ["a-operador", "emp-a", "proceso_compra"],
      ["a-encargado", "emp-a", "anular_compra"],
      ["a-encargado", "emp-a", "corregir_compra"],
    ];
    for (const [rol, empresa, clave] of permisos) await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ($1, $2, $3, $4, true, true)`, [`${rol}|${clave}`, empresa, rol, clave]);
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("da de alta la clave en Accion con la descripción IDÉNTICA a la del catálogo del código", async () => {
    const r = await q(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(r.rows.map((f) => f.descripcion)).toEqual([ACCIONES.find((a) => a.clave === CLAVE)!.descripcion]);
  });

  it("la recibe el admin de cada empresa y NINGÚN otro rol (ni el operador que carga compras, ni el rol propio que anula o corrige)", async () => {
    expect(await quienLaTiene()).toEqual(["a-admin", "b-admin"]);
  });

  it("las filas nuevas tienen Ver y Editar, y el empresaId de su rol (no cruza empresas)", async () => {
    const filas = await filasDeLaClave();
    expect(filas.every((f) => f.ver && f.editar)).toBe(true);
    expect(filas.filter((f) => f.empresa !== f.deLaFila)).toEqual([]);
  });

  it("NO copia CapacidadSucursal", async () => {
    const r = await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = $1`, [CLAVE]);
    expect(r.rows[0].n).toBe(0);
  });

  it("es idempotente y NO pisa una fila existente: no duplica ni reactiva lo que el gerente apagó", async () => {
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = $1`, [CLAVE]);
    const antes = await filasDeLaClave();
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    const despues = await filasDeLaClave();
    expect(despues).toEqual(antes);
    expect(despues.find((f) => f.rol === "b-admin")).toMatchObject({ ver: true, editar: false });
    expect((await q(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = $1`, [CLAVE])).rows[0].n).toBe(1);
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-admin' AND "accionClave" = $1`, [CLAVE]);
  });

  it("down.sql: ABORTA si alguien configuró algo a mano (otro rol con la clave) y, con solo la semilla, la borra", async () => {
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-op|x', 'emp-a', 'a-operador', $1, true, true)`, [CLAVE]);
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se puede bajar 20261104111000_permiso_declarar_pago_compra: hay 1 fila/);
    expect((await filasDeLaClave()).length, "el down abortado no tocó nada").toBe(3);
    await q(`DELETE FROM "PermisoRol" WHERE "id" = 'a-op|x'`);
    await q(leer("down.sql"));
    expect(await filasDeLaClave()).toEqual([]);
    expect((await q(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = $1`, [CLAVE])).rows[0].n).toBe(0);
    await q(leer("down.sql")); // idempotente
  });
});
