import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Compras N3-b — migración de DATOS 20261117120200_compras_permiso_controlar_recepcion: alta de `compra_controlar_recepcion` (sucursal, piso operario, semilla admin y operador) y su siembra a los roles de clave `admin` y
 * `operador` de cada empresa; un rol propio no recibe nada. Dos empresas para comprobar que cada fila lleva el `empresaId` de su rol. Base temporal armada migración por migración. También comprueba su `down.sql`.
 * Mutación: sembrar también al rol propio → rojo «solo admin y operador»; sacar el `ON CONFLICT DO NOTHING` → rojo «es idempotente».
 */
const NOMBRE = "20261117120200_compras_permiso_controlar_recepcion";
const CLAVE = "compra_controlar_recepcion";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos Compras N3-b: la clave compra_controlar_recepcion", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const quienTiene = async () => (await q(`SELECT p."rolId" AS rol FROM "PermisoRol" p WHERE p."accionClave" = $1 ORDER BY p."rolId"`, [CLAVE])).rows.map((f) => f.rol as string);

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const e of ["emp-a", "emp-b"]) await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"],
      ["a-operador", "emp-a", "operador", "operador"],
      ["a-encargado", "emp-a", "encargado", null], // rol propio: no recibe nada
      ["b-admin", "emp-b", "admin", "admin"],
      ["b-operador", "emp-b", "operador", "operador"],
    ];
    for (const [id, empresa, nombre, clave] of roles) await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("da de alta la clave con la descripción IDÉNTICA a la del catálogo del código, de sucursal y del módulo recepcion_de_compras", async () => {
    const r = await q(`SELECT "clave", "descripcion" FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(r.rows).toEqual([{ clave: CLAVE, descripcion: ACCIONES.find((a) => a.clave === CLAVE)!.descripcion }]);
    expect(ACCIONES.find((a) => a.clave === CLAVE)).toMatchObject({ contexto: "sucursal", modulo: "recepcion_de_compras", nivelMinimo: "operario" });
  });

  it("la reciben SOLO el admin y el operador de cada empresa (no el rol propio)", async () => {
    expect(await quienTiene()).toEqual(["a-admin", "a-operador", "b-admin", "b-operador"]);
  });

  it("coincide con la semilla del código (lo que recibe una empresa nueva)", () => {
    expect(ACCIONES.find((a) => a.clave === CLAVE)!.rolesEditarSemilla).toEqual(["admin", "operador"]);
  });

  it("las filas tienen Ver y Editar y el empresaId de su rol; no copia CapacidadSucursal", async () => {
    const filas = (await q(`SELECT p."puedeVer" AS ver, p."puedeEditar" AS editar, p."empresaId" AS empresa, r."empresaId" AS "deLaFila" FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = $1`, [CLAVE])).rows;
    expect(filas).toHaveLength(4);
    expect(filas.every((f) => f.ver && f.editar && f.empresa === f.deLaFila)).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = $1`, [CLAVE])).rows[0].n).toBe(0);
  });

  it("no toca compra_recibir (confirmar sigue siendo del gerente y el administrador)", async () => {
    expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = 'compra_recibir' AND "rolId" LIKE '%operador'`)).rows[0].n).toBe(0);
  });

  it("es idempotente y NO pisa una fila existente: no duplica ni reactiva lo que el gerente apagó", async () => {
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-operador' AND "accionClave" = $1`, [CLAVE]);
    const antes = (await q(`SELECT "rolId", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = $1 ORDER BY 1`, [CLAVE])).rows;
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    expect((await q(`SELECT "rolId", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = $1 ORDER BY 1`, [CLAVE])).rows).toEqual(antes);
    expect(antes.find((f) => f.rolId === "b-operador")).toMatchObject({ puedeVer: true, puedeEditar: false });
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-operador' AND "accionClave" = $1`, [CLAVE]);
  });

  it("down.sql: ABORTA si alguien configuró algo a mano (el rol propio con la clave) y, con solo la semilla, la borra; se repite sin fallar", async () => {
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-enc|x', 'emp-a', 'a-encargado', $1, true, true)`, [CLAVE]);
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se puede bajar 20261117120200_compras_permiso_controlar_recepcion: hay 1 fila/);
    expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = $1`, [CLAVE])).rows[0].n, "el down abortado no tocó nada").toBe(5);
    await q(`DELETE FROM "PermisoRol" WHERE "id" = 'a-enc|x'`);
    await q(leer("down.sql"));
    expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = $1`, [CLAVE])).rows[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = $1`, [CLAVE])).rows[0].n).toBe(0);
    await q(leer("down.sql"));
  });
});
