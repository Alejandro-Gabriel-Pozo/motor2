import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Parte P1 (b) — migración de DATOS 20261115150000_permisos_partes: alta de las claves `partes_ver`, `partes_editar` (empresa, piso operario, semilla solo admin) y `partes_desactivar` (empresa, piso administrador, semilla admin)
 * y su siembra SOLO al rol de clave `admin` de cada empresa (todo nace cerrado): ni el operador ni un rol propio. Dos empresas para comprobar que cada fila lleva el `empresaId` de su rol. Base temporal armada migración por migración (las anteriores
 * aplicadas, la nuestra a mano). También comprueba su `down.sql`: borra la semilla pura y ABORTA si alguien configuró algo a mano.
 * Mutación: sembrar `partes_ver` al operador → rojo «NINGÚN otro rol»; sacar el `ON CONFLICT DO NOTHING` → rojo «es idempotente».
 */
const NOMBRE = "20261115150000_permisos_partes";
const CLAVES = ["partes_ver", "partes_editar", "partes_desactivar"] as const;
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos Parte P1 (b): las claves partes_*", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const quienTiene = async (clave: string) => (await q(`SELECT p."rolId" AS rol FROM "PermisoRol" p WHERE p."accionClave" = $1 ORDER BY p."rolId"`, [clave])).rows.map((f) => f.rol as string);

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

  it("da de alta las tres claves en Accion con la descripción IDÉNTICA a la del catálogo del código, y el catálogo las declara de EMPRESA", async () => {
    const r = await q(`SELECT "clave", "descripcion" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY "clave"`, [[...CLAVES]]);
    expect(r.rows).toEqual([...CLAVES].sort().map((clave) => ({ clave, descripcion: ACCIONES.find((a) => a.clave === clave)!.descripcion })));
    for (const clave of CLAVES) expect(ACCIONES.find((a) => a.clave === clave)).toMatchObject({ contexto: "empresa", modulo: "proveedores_basico" });
  });

  it("las tres claves las recibe SOLO el admin de cada empresa: NINGÚN otro rol (ni el operador ni el rol propio)", async () => {
    for (const clave of CLAVES) expect(await quienTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
  });

  it("coincide con la semilla del código (lo que recibe una empresa nueva): rolesEditarSemilla de cada clave", () => {
    for (const clave of CLAVES) expect(ACCIONES.find((a) => a.clave === clave)!.rolesEditarSemilla, clave).toEqual(["admin"]);
  });

  it("las filas nuevas tienen Ver y Editar y el empresaId de su rol (no cruza empresas); no copia CapacidadSucursal", async () => {
    const filas = (await q(`SELECT p."puedeVer" AS ver, p."puedeEditar" AS editar, p."empresaId" AS empresa, r."empresaId" AS "deLaFila" FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = ANY($1)`, [[...CLAVES]])).rows;
    expect(filas).toHaveLength(6);
    expect(filas.every((f) => f.ver && f.editar && f.empresa === f.deLaFila)).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
  });

  it("es idempotente y NO pisa una fila existente: no duplica ni reactiva lo que el gerente apagó", async () => {
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'partes_editar'`);
    const antes = (await q(`SELECT "rolId", "accionClave", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1, 2`, [[...CLAVES]])).rows;
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    expect((await q(`SELECT "rolId", "accionClave", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1, 2`, [[...CLAVES]])).rows).toEqual(antes);
    expect(antes.find((f) => f.rolId === "b-admin" && f.accionClave === "partes_editar")).toMatchObject({ puedeVer: true, puedeEditar: false });
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'partes_editar'`);
  });

  it("down.sql: ABORTA si alguien configuró algo a mano (el operador con una clave) y, con solo la semilla, la borra; se repite sin fallar", async () => {
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-op|x', 'emp-a', 'a-operador', 'partes_ver', true, true)`);
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se puede bajar 20261115150000_permisos_partes: hay 1 fila/);
    expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n, "el down abortado no tocó nada").toBe(7);
    await q(`DELETE FROM "PermisoRol" WHERE "id" = 'a-op|x'`);
    await q(leer("down.sql"));
    expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
    await q(leer("down.sql"));
  });
});
