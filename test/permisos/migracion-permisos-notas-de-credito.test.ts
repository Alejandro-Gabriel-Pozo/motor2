import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { clavesReservadasDe, RESERVADAS_EN_BASE } from "../setup/claves-reservadas-en-base";

/**
 * Paquete 4, M6.4 — migración de DATOS 20261018103000_permisos_notas_de_credito: alta de las TRES claves de la nota de crédito de proveedor (`nota_credito_proveedor`, `gasto_nota_credito` y `anular_nota_credito_proveedor`; Decisión 3 del dueño: semilla `admin`,
 * piso administrador, clase A, sin copiar de ninguna otra, en la base desde M6 y en `ACCIONES` recién desde la Etapa C) y su siembra: el rol de clave `admin` de cada empresa recibe las tres (con Ver y Editar) y NADIE más. A diferencia de lo que pasa con una acción de un
 * módulo disponible, NO están en `ACCIONES` (la Etapa C las suma con su guarda).
 *
 * La migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto: el `empresaId` de cada fila nueva sale de la fila del rol. Por eso acá hay DOS empresas, para comprobar que cada una conserva lo suyo y que nada cruza. Se corre sobre una
 * base temporal armada migración por migración (la anterior a la nuestra aplicada, la nuestra a mano).
 *
 * La reversa es una variante DELIBERADA de la de M4.5: ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las claves (una capacidad por sucursal, una fila de un rol que no es el `admin`, o una del admin con Ver o Editar apagado); sin eso, borra la semilla.
 *
 * Mutaciones demostradas (ver las filas O.286 a O.299 de docs/pureza-integracion.md): sacar `WHERE r."clave" = 'admin'` (la reciben todos los roles) y quitar la guarda de la reversa.
 */
const NOMBRE = "20261018103000_permisos_notas_de_credito";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");
const CLAVES = clavesReservadasDe(NOMBRE);

describe("migración de datos M6.4: las tres claves de la nota de crédito de proveedor", () => {
  let base: BaseTemporalMigrada;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

  const filas = async (clave: string) => {
    const r = await base.cliente.query<{ rol: string; empresa: string; ver: boolean; editar: boolean; deLaFila: string }>(
      `SELECT p."rolId" AS rol, p."empresaId" AS empresa, p."puedeVer" AS ver, p."puedeEditar" AS editar, r."empresaId" AS "deLaFila"
       FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = $1 ORDER BY p."rolId"`,
      [clave],
    );
    return r.rows;
  };
  const quienLaTiene = async (clave: string) => (await filas(clave)).map((f) => f.rol);
  const conteos = async () => {
    const r = await base.cliente.query<{ acciones: number; permisos: number; capacidades: number; otras: number }>(
      `SELECT (SELECT count(*)::int FROM "Accion" WHERE "clave" = ANY($1)) AS acciones,
              (SELECT count(*)::int FROM "PermisoRol" WHERE "accionClave" = ANY($1)) AS permisos,
              (SELECT count(*)::int FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)) AS capacidades,
              (SELECT count(*)::int FROM "PermisoRol" WHERE NOT ("accionClave" = ANY($1))) AS otras`,
      [CLAVES],
    );
    return r.rows[0]!;
  };

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);

    // Claves de origen que NO deben contagiar a las nuevas: algunas las sembró el seed original y ninguna migración las crea, así que una base temporal no las trae.
    for (const clave of ["proceso_compra", "anular_compra", "corregir_compra", "gasto_anular"]) {
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
      ["b-admin", "emp-b", "admin", "admin"], // el admin de B NO tiene ninguna fila: igual las recibe
      ["b-encargado", "emp-b", "encargado", null],
    ];
    for (const [id, empresa, nombre, clave] of roles) {
      await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    }
    // [rol, clave, ver, editar]: lo que ya podían hacer con compras y gastos
    const permisos: [string, string, boolean, boolean][] = [
      ["a-admin", "anular_compra", true, true],
      ["a-operador", "proceso_compra", true, true],
      ["a-encargado", "anular_compra", true, true],
      ["a-encargado", "corregir_compra", true, true],
      ["a-encargado", "gasto_anular", true, true],
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

  it("las tres claves de la lista de reservadas de esta migración son exactamente las que da de alta, y NINGUNA está en ACCIONES todavía", async () => {
    expect(CLAVES).toEqual(["anular_nota_credito_proveedor", "gasto_nota_credito", "nota_credito_proveedor"]);
    for (const clave of CLAVES) expect(RESERVADAS_EN_BASE[clave], clave).toMatchObject({ contexto: "sucursal", nivelMinimo: "administrador", semilla: ["admin"] });
    const enBase = await q(`SELECT "clave" FROM "Accion" WHERE "clave" LIKE '%nota\\_credito%' ORDER BY 1`);
    expect(enBase.rows.map((f) => f.clave)).toEqual(CLAVES);
    expect(ACCIONES.map((a) => a.clave).filter((c) => (CLAVES as string[]).includes(c))).toEqual([]);
  });

  it("da de alta las tres en Accion con la descripción DEFINITIVA de la lista de reservadas (la que compara la paridad)", async () => {
    for (const clave of CLAVES) {
      const r = await q(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [clave]);
      expect(r.rows.map((f) => f.descripcion), clave).toEqual([RESERVADAS_EN_BASE[clave]!.descripcion]);
    }
  });

  it("el admin de CADA empresa recibe las tres claves (se reconoce por su clave de sistema, haya o no tenido filas antes), con Ver y Editar, y su empresaId es el de su rol", async () => {
    for (const clave of CLAVES) {
      expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
      expect((await filas(clave)).every((f) => f.ver && f.editar && f.empresa === f.deLaFila), clave).toBe(true);
    }
    const admins = await q(`SELECT "empresaId" AS empresa, count(*)::int AS n FROM "PermisoRol" WHERE "rolId" IN ('a-admin', 'b-admin') AND "accionClave" = ANY($1) GROUP BY 1 ORDER BY 1`, [CLAVES]);
    expect(admins.rows).toEqual([{ empresa: "emp-a", n: 3 }, { empresa: "emp-b", n: 3 }]);
  });

  it("NINGÚN otro rol recibe ninguna: ni el operador que carga compras, ni un rol propio que anula o corrige compras o gastos, ni uno vacío (sin copia desde otras claves)", async () => {
    const r = await q(`SELECT DISTINCT "rolId" AS rol FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES]);
    expect(r.rows.map((f) => f.rol)).toEqual(["a-admin", "b-admin"]);
  });

  it("NO cruza empresas: cada fila nueva tiene el empresaId de su rol", async () => {
    const r = await q(`SELECT count(*)::int AS n FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = ANY($1) AND p."empresaId" <> r."empresaId"`, [CLAVES]);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("NO copia CapacidadSucursal (sin fila la capacidad está habilitada) y no toca las filas de origen", async () => {
    expect((await conteos()).capacidades).toBe(0);
    const origen = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE "puedeEditar")::int AS editan FROM "PermisoRol" WHERE "id" LIKE '%|%'`);
    expect(origen.rows[0]).toEqual({ total: 6, editan: 6 });
  });

  it("es idempotente y NO pisa una fila existente: correrla otra vez da los mismos conteos y no reactiva lo que el gerente apagó", async () => {
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'gasto_nota_credito'`);
    const antes = { conteos: await conteos(), filas: await filas("gasto_nota_credito") };
    await q(leer("migration.sql"));
    await q(leer("migration.sql"));
    expect({ conteos: await conteos(), filas: await filas("gasto_nota_credito") }).toEqual(antes);
    expect(antes.conteos).toMatchObject({ acciones: 3, permisos: 6 });
    expect((await filas("gasto_nota_credito")).find((f) => f.rol === "b-admin")).toMatchObject({ ver: true, editar: false });
    await q(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'gasto_nota_credito'`);
  });

  it("una empresa que nace DESPUÉS no las recibe de esta migración (el alta siembra desde ACCIONES, y todavía no están ahí): volver a correrla cubre su admin", async () => {
    await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-c', 'emp-c', 'emp-c', 'America/Argentina/Buenos_Aires', 'ARS')`);
    await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('c-admin', 'emp-c', 'admin', 'admin')`);
    expect(await quienLaTiene("nota_credito_proveedor")).not.toContain("c-admin");
    await q(leer("migration.sql"));
    for (const clave of CLAVES) expect(await quienLaTiene(clave), clave).toContain("c-admin");
    await q(`DELETE FROM "PermisoRol" WHERE "rolId" = 'c-admin'`);
    await q(`DELETE FROM "Rol" WHERE "id" = 'c-admin'`);
    await q(`DELETE FROM "Empresa" WHERE "id" = 'emp-c'`);
  });

  it("dos corridas SIMULTÁNEAS de la migración (reintento o doble despliegue) no duplican ni fallan: las dos terminan y los conteos no cambian", async () => {
    const antes = await conteos();
    const { Client } = await import("pg");
    const otro = new Client({ connectionString: base.url });
    await otro.connect();
    try {
      await Promise.all([base.cliente.query(leer("migration.sql")), otro.query(leer("migration.sql"))]);
    } finally {
      await otro.end();
    }
    expect(await conteos()).toEqual(antes);
  });

  it("la reversa ABORTA, sin tocar nada, si alguien configuró algo a mano: una capacidad por sucursal, una fila de un rol que no es el admin, o una del admin con Ver o Editar apagado", async () => {
    const intrusos: Array<[string, string]> = [
      ["una capacidad por sucursal", `INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-nota', 'emp-a', 'nota_credito_proveedor', NULL, false)`],
      ["una fila de un rol que no es el admin", `INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('a-encargado|nota', 'emp-a', 'a-encargado', 'nota_credito_proveedor', true, true)`],
      ["el admin con Editar apagado", `UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'a-admin' AND "accionClave" = 'anular_nota_credito_proveedor'`],
      ["el admin con Ver apagado", `UPDATE "PermisoRol" SET "puedeVer" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'gasto_nota_credito'`],
    ];
    const restauraciones = [
      `DELETE FROM "CapacidadSucursal" WHERE "id" = 'cap-nota'`,
      `DELETE FROM "PermisoRol" WHERE "id" = 'a-encargado|nota'`,
      `UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'a-admin' AND "accionClave" = 'anular_nota_credito_proveedor'`,
      `UPDATE "PermisoRol" SET "puedeVer" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'gasto_nota_credito'`,
    ];
    const limpio = await conteos();
    for (const [i, [que, sql]] of intrusos.entries()) {
      await q(sql);
      const conIntruso = await conteos();
      await expect(q(leer("down.sql")), que).rejects.toThrow(/No se puede bajar M6\.4: hay 1 fila/);
      expect(await conteos(), `${que}: no se borró nada`).toEqual(conIntruso);
      await q(restauraciones[i]!);
      expect(await conteos(), `${que}: restaurado`).toEqual(limpio);
    }
  });

  it("sin configuración a mano, la reversa deja CERO filas de las tres (Accion y PermisoRol) y no toca las demás ni las de origen", async () => {
    const otrasAntes = (await conteos()).otras;
    await q(leer("down.sql"));
    expect(await conteos()).toEqual({ acciones: 0, permisos: 0, capacidades: 0, otras: otrasAntes });
    const capacidadDeOrigen = await q(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "id" = 'cap-a'`);
    expect(capacidadDeOrigen.rows[0]!.n).toBe(1);
    const origen = await q(`SELECT count(*)::int AS total FROM "PermisoRol" WHERE "id" LIKE '%|%'`);
    expect(origen.rows[0]!.total).toBe(6);
  });

  it("la reversa es idempotente, y subir otra vez después de bajar deja las claves como la primera vez (sube-baja-sube)", async () => {
    await q(leer("down.sql"));
    await q(leer("migration.sql"));
    for (const clave of CLAVES) expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
    expect(await conteos()).toMatchObject({ acciones: 3, permisos: 6, capacidades: 0 });
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta, y no se disfrazan de migración de políticas de sucursal", () => {
    expect(leer("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(leer("migration.sql")).toMatch(/Idempotente/);
    expect(leer("down.sql")).toMatch(/ABORTA/);
    expect(leer("down.sql")).toMatch(/M6\.4, M6\.3, M6\.2, M6\.1/);
    for (const archivo of ["migration.sql", "down.sql"]) {
      expect(leer(archivo)).not.toContain("alcance_sucursal_");
      expect(leer(archivo)).not.toContain("app_sucursales_");
    }
  });
});
