import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Parte P1 — migración de DATOS 20261116143000_permisos_partes_operador: el rol de clave `operador` de cada empresa recibe `partes_ver` y `partes_editar` (Ver y Editar en true) y NUNCA `partes_desactivar`
 * (piso administrador). Pedido del dueño 2026-11-16: «como pedernal,». Casos: empresa sin rol operador, rol operador renombrado (la clave manda, no el nombre), fila ya existente (no se pisa, ni la que apagó el gerente),
 * doble ejecución, rol propio (nada), otra empresa (cada fila lleva el `empresaId` de su rol), y la subida/bajada/subida con su `down.sql`. Base temporal armada migración por migración.
 * Mutación: dar `partes_desactivar` al operador en la migración → rojo «nunca partes_desactivar»; sacar el `ON CONFLICT DO NOTHING` → rojo «NO pisa».
 */
const NOMBRE = "20261116143000_permisos_partes_operador";
const ANTERIOR = "20261115152000_permisos_partes";
const TRES = ["partes_ver", "partes_editar", "partes_desactivar"] as const;
const leer = (carpeta: string, archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", carpeta, archivo), "utf8");

describe("migración de datos Parte P1: el operador recibe partes_ver y partes_editar", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  const filas = async () => (await q(`SELECT p."rolId" AS rol, p."accionClave" AS clave, p."puedeVer" AS ver, p."puedeEditar" AS editar FROM "PermisoRol" p WHERE p."accionClave" = ANY($1) ORDER BY 1, 2`, [[...TRES]])).rows;
  const total = async () => (await q(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" = ANY($1)`, [[...TRES]])).rows[0].n as number;

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    for (const e of ["emp-a", "emp-b", "emp-c", "emp-d"]) await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"],
      ["a-operador", "emp-a", "operador", "operador"],
      ["a-propio", "emp-a", "encargado", null], // rol propio: no recibe nada
      ["b-admin", "emp-b", "admin", "admin"],
      ["b-operador", "emp-b", "cajero", "operador"], // renombrado: la clave manda
      ["c-admin", "emp-c", "admin", "admin"], // empresa sin rol operador: no recibe nada
      ["d-admin", "emp-d", "admin", "admin"],
      ["d-operador", "emp-d", "operador", "operador"], // ya configurado a mano
    ];
    for (const [id, empresa, nombre, clave] of roles) await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    // Estado previo: lo que dejó 20261115152000 (el admin) y, en emp-d, el gerente ya le dio `partes_ver` al operador con el Editar APAGADO.
    await q(leer(ANTERIOR, "migration.sql"));
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('d-op-ver', 'emp-d', 'd-operador', 'partes_ver', true, false)`);
    await q(leer(NOMBRE, "migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("el operador (por CLAVE, aunque lo hayan renombrado) recibe partes_ver y partes_editar con Ver y Editar, y nunca partes_desactivar", async () => {
    const f = await filas();
    expect(f.filter((x) => ["a-operador", "b-operador"].includes(x.rol)).map((x) => `${x.rol}:${x.clave}:${x.ver}:${x.editar}`)).toEqual([
      "a-operador:partes_editar:true:true",
      "a-operador:partes_ver:true:true",
      "b-operador:partes_editar:true:true",
      "b-operador:partes_ver:true:true",
    ]);
    expect(f.filter((x) => x.clave === "partes_desactivar").map((x) => x.rol), "nunca partes_desactivar al operador").toEqual(["a-admin", "b-admin", "c-admin", "d-admin"]);
  });

  it("NO pisa una fila existente: lo que el gerente ya dejó (partes_ver con Editar apagado) queda como está, y solo se suma lo que faltaba", async () => {
    const d = (await filas()).filter((x) => x.rol === "d-operador");
    expect(d.map((x) => `${x.clave}:${x.ver}:${x.editar}`)).toEqual(["partes_editar:true:true", "partes_ver:true:false"]);
  });

  it("la empresa sin rol operador y el rol propio no reciben nada; los admin siguen con las tres", async () => {
    const f = await filas();
    expect(f.filter((x) => x.rol === "a-propio")).toEqual([]);
    for (const admin of ["a-admin", "b-admin", "c-admin", "d-admin"]) expect(f.filter((x) => x.rol === admin).map((x) => x.clave), admin).toEqual(["partes_desactivar", "partes_editar", "partes_ver"]);
    expect(f.filter((x) => x.rol === "c-admin")).toHaveLength(3);
  });

  it("cada fila lleva el empresaId de su propio rol (no cruza empresas) y no copia CapacidadSucursal", async () => {
    const r = (await q(`SELECT p."empresaId" = r."empresaId" AS ok FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = ANY($1)`, [[...TRES]])).rows;
    expect(r).toHaveLength(4 * 3 + 2 * 2 + 2); // 4 admin x 3, 2 operadores x 2, y el operador de emp-d (1 existente + 1 sembrada)
    expect(r.every((x) => x.ok)).toBe(true);
    expect((await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [[...TRES]])).rows[0].n).toBe(0);
  });

  it("es idempotente: la segunda y la tercera corrida no cambian nada", async () => {
    const antes = await filas();
    await q(leer(NOMBRE, "migration.sql"));
    await q(leer(NOMBRE, "migration.sql"));
    expect(await filas()).toEqual(antes);
  });

  it("las dos migraciones juntas dejan lo que dice la semilla del código (rolesEditarSemilla de cada clave, por rol de sistema)", async () => {
    const f = await filas();
    for (const clave of TRES) {
      const semilla: readonly string[] = ACCIONES.find((a) => a.clave === clave)!.rolesEditarSemilla;
      expect(f.some((x) => x.clave === clave && x.rol === "a-admin"), `${clave} admin`).toBe(semilla.includes("admin"));
      expect(f.some((x) => x.clave === clave && x.rol === "a-operador"), `${clave} operador`).toBe(semilla.includes("operador"));
    }
    expect(ACCIONES.find((a) => a.clave === "partes_desactivar")).toMatchObject({ nivelMinimo: "operario", rolesEditarSemilla: ["admin"] });
  });

  it("down.sql: ABORTA sin tocar nada si el estado ya no es el de la subida; con solo lo de la subida borra lo del operador, no toca al admin, se repite y vuelve a subir", async () => {
    const n0 = await total();
    // d-operador tenía una fila con Editar apagado (configurada a mano): el down se frena en vez de borrarla.
    await expect(q(leer(NOMBRE, "down.sql"))).rejects.toThrow(/No se puede bajar 20261116143000_permisos_partes_operador: hay 1 fila/);
    expect(await total(), "el down abortado no tocó nada").toBe(n0);
    // Un partes_desactivar al operador (no lo puede recibir por piso, pero la base no lo impide): también frena.
    await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-op-des', 'emp-a', 'a-operador', 'partes_desactivar', true, true)`);
    await expect(q(leer(NOMBRE, "down.sql"))).rejects.toThrow(/hay 2 fila/);
    expect(await total()).toBe(n0 + 1);
    await q(`DELETE FROM "PermisoRol" WHERE "id" = 'a-op-des'`);
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "id" = 'd-op-ver'`);
    await q(leer(NOMBRE, "down.sql"));
    const f = await filas();
    expect(f.filter((x) => x.rol.endsWith("operador"))).toEqual([]);
    expect(f.filter((x) => x.rol.endsWith("admin"))).toHaveLength(12);
    await q(leer(NOMBRE, "down.sql")); // repetible
    await q(leer(NOMBRE, "migration.sql")); // subir de nuevo
    expect((await filas()).filter((x) => x.rol.endsWith("operador"))).toHaveLength(6);
  });

  it("una capacidad por sucursal sobre partes_ver también frena la bajada", async () => {
    await q(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "habilitado") VALUES ('cap-1', 'emp-a', 'partes_ver', false)`);
    await expect(q(leer(NOMBRE, "down.sql"))).rejects.toThrow(/hay 1 fila/);
  });
});
