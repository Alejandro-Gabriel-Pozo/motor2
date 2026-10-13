import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { clavesReservadasDe, RESERVADAS_EN_BASE } from "../setup/claves-reservadas-en-base";

/**
 * Paquete 3, M4.5 — migración de DATOS 20261016114000_permisos_gastos: alta de las SIETE claves de los gastos (D1: `gasto_*`; D4: las siete, semilla `admin` salvo `gasto_repartir`, piso administrador, sin copiar de `proceso_compra`, en la base desde M4 y en `ACCIONES`
 * recién desde la Etapa C) y su siembra: el rol de clave `admin` de cada empresa recibe SEIS (con Ver y Editar) y NADIE recibe `gasto_repartir`. A diferencia de lo que pasa con una acción de un módulo disponible, NO están en `ACCIONES` (módulo en desarrollo).
 *
 * La migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto: el `empresaId` de cada fila nueva sale de la fila del rol. Por eso acá hay DOS empresas, para comprobar que cada una conserva lo suyo y que nada cruza. Se corre sobre una
 * base temporal armada migración por migración (la anterior a la nuestra aplicada, la nuestra a mano).
 *
 * Mutaciones demostradas (ver el informe del paso): sacar `WHERE r."clave" = 'admin'` (la reciben todos los roles), usar `app_empresa_actual()` como empresa (falla: NULL), sembrar `gasto_repartir`, o cambiar una descripción.
 */
const NOMBRE = "20261016114000_permisos_gastos";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");
/** Solo las siete de ESTA migración (M4.5): las de M6.4, las de M7.4 y las que se sumen después las lista `RESERVADAS_EN_BASE` pero las da de alta otra. */
const CLAVES = clavesReservadasDe(NOMBRE);
const CON_SEMILLA = CLAVES.filter((c) => RESERVADAS_EN_BASE[c]!.semilla.includes("admin"));

describe("migración de datos M4.5: las siete claves de los gastos", () => {
  let base: BaseTemporalMigrada;

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
    const r = await base.cliente.query<{ acciones: number; permisos: number; otras: number }>(
      `SELECT (SELECT count(*)::int FROM "Accion" WHERE "clave" = ANY($1)) AS acciones,
              (SELECT count(*)::int FROM "PermisoRol" WHERE "accionClave" = ANY($1)) AS permisos,
              (SELECT count(*)::int FROM "PermisoRol" WHERE NOT ("accionClave" = ANY($1))) AS otras`,
      [CLAVES],
    );
    return r.rows[0]!;
  };

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(NOMBRE);
    const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);

    // Claves de origen que NO deben contagiar a las nuevas: algunas las sembró el seed original y ninguna migración las crea, así que una base temporal no las trae.
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
      ["b-admin", "emp-b", "admin", "admin"], // el admin de B NO tiene ninguna fila: igual las recibe
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

  it("las siete claves de la lista de reservadas son exactamente las que da de alta, y NINGUNA está en ACCIONES todavía (módulo en desarrollo)", async () => {
    expect(CLAVES).toHaveLength(7);
    expect(CLAVES.every((c) => c === "conceptos_gasto" || c === "reporte_gastos_empresa" || c.startsWith("gasto_"))).toBe(true);
    expect(CLAVES.filter((c) => c.startsWith("servicio_"))).toEqual([]);
    const enBase = await base.cliente.query<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" LIKE 'gasto\\_%' OR "clave" IN ('conceptos_gasto', 'reporte_gastos_empresa') OR "clave" LIKE 'servicio\\_%' ORDER BY 1`);
    expect(enBase.rows.map((f) => f.clave)).toEqual(CLAVES);
    expect(ACCIONES.map((a) => a.clave).filter((c) => (CLAVES as string[]).includes(c))).toEqual([]);
  });

  it("da de alta las siete en Accion con la descripción DEFINITIVA de la lista de reservadas (la que compara la paridad)", async () => {
    for (const clave of CLAVES) {
      const r = await base.cliente.query<{ descripcion: string }>(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [clave]);
      expect(r.rows.map((f) => f.descripcion), clave).toEqual([RESERVADAS_EN_BASE[clave]!.descripcion]);
    }
  });

  it("el admin de CADA empresa recibe las seis claves con semilla (se reconoce por su clave de sistema, haya o no tenido filas antes), con Ver y Editar, y su empresaId es el de su rol", async () => {
    for (const clave of CON_SEMILLA) {
      expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
      expect((await filas(clave)).every((f) => f.ver && f.editar && f.empresa === f.deLaFila), clave).toBe(true);
    }
    expect(CON_SEMILLA).toEqual(CLAVES.filter((c) => c !== "gasto_repartir"));
    const admins = await base.cliente.query<{ empresa: string; n: number }>(`SELECT "empresaId" AS empresa, count(*)::int AS n FROM "PermisoRol" WHERE "rolId" IN ('a-admin', 'b-admin') AND "accionClave" = ANY($1) GROUP BY 1 ORDER BY 1`, [CLAVES]);
    expect(admins.rows).toEqual([{ empresa: "emp-a", n: 6 }, { empresa: "emp-b", n: 6 }]);
  });

  it("`gasto_repartir` NO la recibe NADIE (ni el admin ni el operador): se delega a mano", async () => {
    expect(await filas("gasto_repartir")).toEqual([]);
    const accion = await base.cliente.query(`SELECT 1 FROM "Accion" WHERE "clave" = 'gasto_repartir'`);
    expect(accion.rowCount).toBe(1);
  });

  it("NINGÚN otro rol recibe ninguna: ni el operador que carga compras, ni un rol propio que anula o corrige compras, ni uno vacío (sin copia desde proceso_compra)", async () => {
    const r = await base.cliente.query<{ rol: string }>(`SELECT DISTINCT "rolId" AS rol FROM "PermisoRol" WHERE "accionClave" = ANY($1) ORDER BY 1`, [CLAVES]);
    expect(r.rows.map((f) => f.rol)).toEqual(["a-admin", "b-admin"]);
  });

  it("NO cruza empresas: cada fila nueva tiene el empresaId de su rol", async () => {
    const r = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE p."accionClave" = ANY($1) AND p."empresaId" <> r."empresaId"`, [CLAVES]);
    expect(r.rows[0]!.n).toBe(0);
  });

  it("NO copia CapacidadSucursal (sin fila la capacidad está habilitada) y no toca las filas de origen", async () => {
    const cap = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [CLAVES]);
    expect(cap.rows[0]!.n).toBe(0);
    const origen = await base.cliente.query<{ total: number; editan: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE "puedeEditar")::int AS editan FROM "PermisoRol" WHERE "id" LIKE '%|%'`);
    expect(origen.rows[0]).toEqual({ total: 5, editan: 5 });
  });

  it("es idempotente y NO pisa una fila existente: correrla otra vez da los mismos conteos y no reactiva lo que el gerente apagó", async () => {
    await base.cliente.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'gasto_anular'`);
    const antes = { conteos: await conteos(), filas: await filas("gasto_anular") };
    await base.cliente.query(leer("migration.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect({ conteos: await conteos(), filas: await filas("gasto_anular") }).toEqual(antes);
    expect(antes.conteos.acciones).toBe(7);
    expect(antes.conteos.permisos).toBe(12);
    expect((await filas("gasto_anular")).find((f) => f.rol === "b-admin")).toMatchObject({ ver: true, editar: false });
  });

  it("una empresa que nace DESPUÉS no las recibe de esta migración (el alta siembra desde ACCIONES, y todavía no están ahí): volver a correrla cubre su admin", async () => {
    await base.cliente.query(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-c', 'emp-c', 'emp-c', 'America/Argentina/Buenos_Aires', 'ARS')`);
    await base.cliente.query(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('c-admin', 'emp-c', 'admin', 'admin')`);
    expect(await quienLaTiene("gasto_ver")).not.toContain("c-admin");
    await base.cliente.query(leer("migration.sql"));
    for (const clave of CON_SEMILLA) expect(await quienLaTiene(clave), clave).toContain("c-admin");
    expect(await quienLaTiene("gasto_repartir")).not.toContain("c-admin");
    await base.cliente.query(`DELETE FROM "PermisoRol" WHERE "rolId" = 'c-admin'`);
    await base.cliente.query(`DELETE FROM "Rol" WHERE "id" = 'c-admin'`);
    await base.cliente.query(`DELETE FROM "Empresa" WHERE "id" = 'emp-c'`);
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

  it("down.sql deja CERO filas de las siete (Accion, PermisoRol y CapacidadSucursal) y no toca las demás", async () => {
    await base.cliente.query(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-gasto', 'emp-a', 'gasto_ver', NULL, false)`);
    const otrasAntes = (await conteos()).otras;

    await base.cliente.query(leer("down.sql"));

    const cuenta = async (tabla: string, columna: string) => (await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${tabla}" WHERE "${columna}" = ANY($1)`, [CLAVES])).rows[0]!.n;
    expect([await cuenta("Accion", "clave"), await cuenta("PermisoRol", "accionClave"), await cuenta("CapacidadSucursal", "accionClave")]).toEqual([0, 0, 0]);
    expect((await conteos()).otras).toBe(otrasAntes);
    const capacidadDeOrigen = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "id" = 'cap-a'`);
    expect(capacidadDeOrigen.rows[0]!.n).toBe(1);
  });

  it("la reversa es idempotente, y subir otra vez después de bajar deja las claves como la primera vez (sube-baja-sube)", async () => {
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    for (const clave of CON_SEMILLA) expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
    expect(await quienLaTiene("gasto_repartir")).toEqual([]);
    expect(await conteos()).toMatchObject({ acciones: 7, permisos: 12 });
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa es destructiva y que son las últimas de M4", () => {
    expect(leer("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(leer("migration.sql")).toMatch(/gasto_\*/);
    expect(leer("down.sql")).toMatch(/DESTRUCTIVA/);
    expect(leer("down.sql")).toMatch(/antes de M4\.4/);
  });
});
