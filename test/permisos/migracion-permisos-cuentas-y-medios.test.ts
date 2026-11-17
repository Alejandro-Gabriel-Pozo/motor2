import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Caja y cobro, etapa B (permisos) — migración de DATOS 20261117119200_permisos_cuentas_y_medios: alta de las ocho claves de administración de la caja (`caja_medio_de_pago_*` y `caja_cuenta_de_cobro_*`, crear, editar, reactivar y desactivar; de SUCURSAL) y su siembra SOLO al rol de clave `admin` de cada empresa
 * (nada al operador ni a un rol propio: todo nace cerrado). Dos empresas para comprobar que cada fila lleva el `empresaId` de su rol. Base temporal armada migración por migración (las anteriores aplicadas, la nuestra a mano). También comprueba su `down.sql`: borra la semilla pura y ABORTA si alguien configuró algo a mano.
 * Mutaciones (rojo/verde): sembrar `caja_medio_de_pago_crear` al operador → rojo «NINGÚN otro rol»; sacar una clave de la semilla (del `VALUES` de `migration.sql`) → rojo «siembra las ocho» y «las filas nuevas»; sacar el `ON CONFLICT DO NOTHING` → rojo «es idempotente».
 * Además: empresa con VARIAS sucursales (la siembra es por rol, no por sucursal: no copia `CapacidadSucursal`) y baja y vuelta a subir (sube/baja/sube).
 */
const NOMBRE = "20261117119200_permisos_cuentas_y_medios";
const CLAVES = ["caja_medio_de_pago_crear", "caja_medio_de_pago_editar", "caja_medio_de_pago_reactivar", "caja_medio_de_pago_desactivar", "caja_cuenta_de_cobro_crear", "caja_cuenta_de_cobro_editar", "caja_cuenta_de_cobro_reactivar", "caja_cuenta_de_cobro_desactivar"] as const;
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos Caja, etapa B: las claves de administración de cuentas de cobro y medios de pago", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const quienTiene = async (clave: string) => (await q(`SELECT p."rolId" AS rol FROM "PermisoRol" p WHERE p."accionClave" = $1 ORDER BY p."rolId"`, [clave])).rows.map((f) => f.rol as string);
  const cuenta = async () => (await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n as number;

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const e of ["emp-a", "emp-b"]) await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"],
      ["a-operador", "emp-a", "operador", "operador"],
      ["a-cajero", "emp-a", "cajero", null], // rol propio: no recibe nada
      ["b-admin", "emp-b", "admin", "admin"],
      ["b-operador", "emp-b", "operador", "operador"],
    ];
    for (const [id, empresa, nombre, clave] of roles) await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    // La empresa A con TRES sucursales: la siembra es por rol (una fila por rol y clave), no por sucursal.
    await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('a-s1','emp-a','Centro'), ('a-s2','emp-a','Norte'), ('a-s3','emp-a','Sur'), ('b-s1','emp-b','Unica')`);
    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("da de alta las ocho claves en Accion con la descripción IDÉNTICA a la del catálogo del código, y el catálogo las declara de SUCURSAL", async () => {
    const r = await q(`SELECT "clave", "descripcion" FROM "Accion" WHERE "clave" = ANY($1) ORDER BY "clave"`, [[...CLAVES]]);
    expect(r.rows).toEqual([...CLAVES].sort().map((clave) => ({ clave, descripcion: ACCIONES.find((a) => a.clave === clave)!.descripcion })));
    for (const clave of CLAVES) expect(ACCIONES.find((a) => a.clave === clave), clave).toMatchObject({ contexto: "sucursal" });
  });

  it("siembra las ocho claves SOLO al admin de cada empresa: NINGÚN otro rol (ni el operador ni un rol propio)", async () => {
    for (const clave of CLAVES) expect(await quienTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
  });

  it("coincide con la semilla del código: el admin las ocho y nadie más (todo nace cerrado)", () => {
    for (const clave of CLAVES) expect(ACCIONES.find((a) => a.clave === clave)!.rolesEditarSemilla, clave).toEqual(["admin"]);
  });

  it("las filas nuevas tienen Ver y Editar y el empresaId de su rol (no cruza empresas); no copia CapacidadSucursal", async () => {
    const filas = (await q(`SELECT p."puedeVer" AS ver, p."puedeEditar" AS editar, p."empresaId" AS empresa, r."empresaId" AS "deLaFila" FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = ANY($1)`, [[...CLAVES]])).rows;
    expect(filas).toHaveLength(16);
    expect(filas.every((f) => f.ver && f.editar && f.empresa === f.deLaFila)).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
  });

  it("empresa con varias sucursales: una fila por rol y clave (no por sucursal) y ninguna capacidad por sucursal", async () => {
    for (const clave of CLAVES) expect((await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = $1 AND "empresaId" = 'emp-a'`, [clave])).rows[0].n, clave).toBe(1);
    expect((await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
  });

  it("es idempotente y NO pisa una fila existente: no duplica ni reactiva lo que el gerente apagó", async () => {
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'caja_cuenta_de_cobro_desactivar'`);
    const antes = (await q(`SELECT "rolId", "accionClave", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1, 2`, [[...CLAVES]])).rows;
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    expect((await q(`SELECT "rolId", "accionClave", "puedeVer", "puedeEditar" FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1, 2`, [[...CLAVES]])).rows).toEqual(antes);
    expect(antes.find((f) => f.rolId === "b-admin" && f.accionClave === "caja_cuenta_de_cobro_desactivar")).toMatchObject({ puedeVer: true, puedeEditar: false });
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'caja_cuenta_de_cobro_desactivar'`);
  });

  it("down.sql: ABORTA si alguien configuró algo a mano (el operador con una clave) y, con solo la semilla, la borra; se repite sin fallar", async () => {
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-op|x', 'emp-a', 'a-operador', 'caja_cuenta_de_cobro_desactivar', true, true)`);
    await expect(q(leer("down.sql"))).rejects.toThrow(/No se puede bajar 20261117119200_permisos_cuentas_y_medios: hay 1 fila/);
    expect(await cuenta(), "el down abortado no tocó nada").toBe(17);
    await q(`DELETE FROM "PermisoRol" WHERE "id" = 'a-op|x'`);
    await q(leer("down.sql"));
    expect(await cuenta()).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = ANY($1)`, [[...CLAVES]])).rows[0].n).toBe(0);
    await q(leer("down.sql"));
    // Sube de nuevo (sube/baja/sube): vuelve exactamente la semilla.
    await q(leer("migration.sql"));
    expect(await cuenta()).toBe(16);
    for (const clave of CLAVES) expect(await quienTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
  });
});
