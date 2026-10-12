import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Paquete 3, M3a — migración de DATOS 20261016100000_permiso_compra_repartir: alta de la clave `compra_repartir` (repartir una factura de proveedor entre sucursales y atender las
 * facturas «pendientes de reparto») y su siembra: D3 del dueño = el rol de clave `admin` de cada empresa, con Ver y Editar, y NADIE más. A diferencia de M.2 NO se copia de otra
 * clave: hoy nadie reparte facturas, así que nadie pierde nada.
 *
 * La migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto: el `empresaId` de cada fila nueva sale de la fila del rol. Por eso acá hay DOS empresas,
 * para comprobar que cada una conserva lo suyo y que nada cruza. Se corre sobre una base temporal armada migración por migración (la anterior a la nuestra aplicada, la nuestra a mano).
 */
const NOMBRE = "20261016100000_permiso_compra_repartir";
const CLAVE = "compra_repartir";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos M3a: la clave compra_repartir", () => {
  let base: BaseTemporalMigrada;

  const filasDeLaClave = async () => {
    const r = await base.cliente.query<{ rol: string; empresa: string; ver: boolean; editar: boolean; deLaFila: string }>(
      `SELECT p."rolId" AS rol, p."empresaId" AS empresa, p."puedeVer" AS ver, p."puedeEditar" AS editar, r."empresaId" AS "deLaFila"
       FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = $1 ORDER BY p."rolId"`,
      [CLAVE]
    );
    return r.rows;
  };
  const quienLaTiene = async () => (await filasDeLaClave()).map((f) => f.rol);

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

    // Claves de origen que NO deben contagiar a la nueva: algunas las sembró el seed original y ninguna migración las crea, así que una base temporal no las trae.
    for (const clave of ["proceso_compra", "anular_compra", "corregir_compra"]) {
      await q(`INSERT INTO "Accion" ("clave", "descripcion") VALUES ($1, $1) ON CONFLICT ("clave") DO NOTHING`, [clave]);
    }
    for (const e of ["emp-a", "emp-b"]) {
      await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    }
    // [id, empresa, nombre, clave de sistema]
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"],
      ["a-operador", "emp-a", "operador", "operador"], // carga compras de fábrica
      ["a-encargado", "emp-a", "encargado", null], // rol propio: anula y corrige compras
      ["a-vacio", "emp-a", "vacio", null],
      ["b-admin", "emp-b", "admin", "admin"], // el admin de B NO tiene ninguna fila: igual la recibe
      ["b-encargado", "emp-b", "encargado", null],
    ];
    for (const [id, empresa, nombre, clave] of roles) {
      await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    }
    // [rol, clave, ver, editar]: lo que ya podían hacer con compras
    const permisos: [string, string, boolean, boolean][] = [
      ["a-admin", "anular_compra", true, true],
      ["a-operador", "proceso_compra", true, true],
      ["a-encargado", "anular_compra", true, true],
      ["a-encargado", "corregir_compra", true, true],
      ["b-encargado", "anular_compra", true, true],
    ];
    for (const [rol, clave, ver, editar] of permisos) {
      const empresa = rol.startsWith("a-") ? "emp-a" : "emp-b";
      await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ($1, $2, $3, $4, $5, $6)`, [`${rol}|${clave}`, empresa, rol, clave, ver, editar]);
    }
    // Una capacidad de sucursal APAGADA para una clave de origen: la migración no la copia.
    await q(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-a', 'emp-a', 'anular_compra', NULL, false)`);

    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("da de alta la clave en Accion con la descripción IDÉNTICA a la del catálogo del código", async () => {
    const r = await base.cliente.query<{ descripcion: string }>(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(r.rows.map((f) => f.descripcion)).toEqual([ACCIONES.find((a) => a.clave === CLAVE)!.descripcion]);
  });

  it("el admin la recibe en cada empresa, haya o no tenido filas de compras (el rol se reconoce por su clave de sistema, no por el nombre)", async () => {
    const tiene = await quienLaTiene();
    expect(tiene).toContain("a-admin");
    expect(tiene).toContain("b-admin");
  });

  it("NINGÚN otro rol la recibe: ni el operador que carga compras, ni un rol propio que anula o corrige compras, ni uno vacío", async () => {
    expect(await quienLaTiene()).toEqual(["a-admin", "b-admin"]);
  });

  it("las filas nuevas tienen Ver y Editar en true", async () => {
    const filas = await filasDeLaClave();
    expect(filas.every((f) => f.ver && f.editar)).toBe(true);
  });

  it("NO cruza empresas: el empresaId de cada fila nueva es el de su rol, y el de cada empresa sigue siendo el suyo", async () => {
    const filas = await filasDeLaClave();
    expect(filas.filter((f) => f.empresa !== f.deLaFila)).toEqual([]);
    expect(filas.filter((f) => f.rol.startsWith("a-")).every((f) => f.empresa === "emp-a")).toBe(true);
    expect(filas.filter((f) => f.rol.startsWith("b-")).every((f) => f.empresa === "emp-b")).toBe(true);
  });

  it("NO copia CapacidadSucursal (sin fila la capacidad está habilitada): ni apagada ni de ninguna clase", async () => {
    const r = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = $1`, [CLAVE]);
    expect(r.rows[0].n).toBe(0);
  });

  it("no toca las filas de origen", async () => {
    const origen = await base.cliente.query<{ total: number; editan: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE "puedeEditar")::int AS editan FROM "PermisoRol" WHERE "id" LIKE '%|%'`);
    expect(origen.rows[0]).toEqual({ total: 5, editan: 5 });
  });

  it("es idempotente y NO pisa una fila existente: correrla otra vez no duplica ni reactiva lo que el gerente apagó", async () => {
    await base.cliente.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = $1`, [CLAVE]);
    const antes = await filasDeLaClave();
    await base.cliente.query(leer("migration.sql"));
    await base.cliente.query(leer("migration.sql"));
    const despues = await filasDeLaClave();
    expect(despues).toEqual(antes);
    expect(despues.find((f) => f.rol === "b-admin")).toMatchObject({ ver: true, editar: false });
    const acciones = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(acciones.rows[0].n).toBe(1);
  });

  it("una empresa que nace DESPUÉS no la recibe de esta migración (la siembra del alta sale de ACCIONES, no de la migración): el rol admin de una empresa nueva se cubre volviendo a correrla", async () => {
    await base.cliente.query(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-c', 'emp-c', 'emp-c', 'America/Argentina/Buenos_Aires', 'ARS')`);
    await base.cliente.query(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('c-admin', 'emp-c', 'admin', 'admin')`);
    expect(await quienLaTiene()).not.toContain("c-admin");
    await base.cliente.query(leer("migration.sql"));
    expect(await quienLaTiene()).toContain("c-admin");
    // vuelve al estado anterior para la prueba del down
    await base.cliente.query(`DELETE FROM "PermisoRol" WHERE "rolId" = 'c-admin'`);
    await base.cliente.query(`DELETE FROM "Rol" WHERE "id" = 'c-admin'`);
    await base.cliente.query(`DELETE FROM "Empresa" WHERE "id" = 'emp-c'`);
  });

  it("down.sql deja CERO filas de la clave (Accion, PermisoRol y CapacidadSucursal) y no toca las demás", async () => {
    await base.cliente.query(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-repartir', 'emp-a', $1, NULL, false)`, [CLAVE]);
    const otrasAntes = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" <> $1`, [CLAVE]);

    await base.cliente.query(leer("down.sql"));

    const cuenta = async (tabla: string, columna: string) => (await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${tabla}" WHERE "${columna}" = $1`, [CLAVE])).rows[0].n;
    expect([await cuenta("Accion", "clave"), await cuenta("PermisoRol", "accionClave"), await cuenta("CapacidadSucursal", "accionClave")]).toEqual([0, 0, 0]);
    const otrasDespues = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" <> $1`, [CLAVE]);
    expect(otrasDespues.rows[0].n).toBe(otrasAntes.rows[0].n);
    const capacidadDeOrigen = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "id" = 'cap-a'`);
    expect(capacidadDeOrigen.rows[0].n).toBe(1);
  });

  it("subir otra vez después de bajar deja la clave como la primera vez (sube-baja-sube)", async () => {
    await base.cliente.query(leer("migration.sql"));
    expect(await quienLaTiene()).toEqual(["a-admin", "b-admin"]);
  });
});
