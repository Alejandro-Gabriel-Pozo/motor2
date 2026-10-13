import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { clavesReservadasDe, RESERVADAS_EN_BASE } from "../setup/claves-reservadas-en-base";

/**
 * Paquete 5, M7.4 — migración de DATOS 20261019103000_permisos_centros_de_costos: alta de las TRES claves de los centros de costos (`centros_costos`, `distribucion_costos`, `reporte_gastos_por_unidad`; las tres con semilla `admin` y piso
 * administrador, sin copiar de ninguna otra clave, en la base desde M7 y en `ACCIONES` recién desde la Etapa C) y su siembra: el rol de clave `admin` de cada empresa recibe las TRES (con Ver y Editar) y ningún otro rol recibe nada. NO están en
 * `ACCIONES` (módulo `centros_de_costos` en desarrollo).
 *
 * La migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto: el `empresaId` de cada fila nueva sale de la fila del rol. Por eso acá hay DOS empresas. Se corre sobre una base temporal armada migración por migración
 * (la anterior a la nuestra aplicada, la nuestra a mano).
 *
 * A diferencia de la reversa de M4.5 (destructiva), la de esta migración ABORTA si la configuración de las tres claves ya no es la semilla pura (una delegación a otro rol, un Ver o Editar apagado del admin, una capacidad por sucursal).
 *
 * Mutaciones demostradas (ver las filas O.300 a O.309 de docs/pureza-integracion.md): sacar `WHERE r."clave" = 'admin'` (la reciben todos los roles), y bajar sin la guarda del down.
 */
const NOMBRE = "20261019103000_permisos_centros_de_costos";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");
const CLAVES = clavesReservadasDe(NOMBRE);

describe("migración de datos M7.4: las tres claves de los centros de costos", () => {
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
      ["a-operador", "emp-a", "operador", "operador"],
      ["a-encargado", "emp-a", "encargado", null], // rol propio: anula y corrige compras
      ["a-vacio", "emp-a", "vacio", null],
      ["b-admin", "emp-b", "admin", "admin"], // el admin de B NO tiene ninguna fila: igual las recibe
      ["b-encargado", "emp-b", "encargado", null],
    ];
    for (const [id, empresa, nombre, clave] of roles) {
      await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    }
    // [rol, clave, ver, editar]: lo que ya podían hacer con compras y con los gastos
    const permisos: [string, string, boolean, boolean][] = [
      ["a-admin", "anular_compra", true, true],
      ["a-operador", "proceso_compra", true, true],
      ["a-encargado", "anular_compra", true, true],
      ["a-encargado", "gasto_ver", true, true],
      ["b-encargado", "conceptos_gasto", true, true],
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

  it("las tres claves de la lista de reservadas son exactamente las que da de alta, con su migración declarada, y NINGUNA está en ACCIONES todavía (módulo en desarrollo)", async () => {
    expect(CLAVES).toEqual(["centros_costos", "distribucion_costos", "reporte_gastos_por_unidad"]);
    const enBase = await base.cliente.query<{ clave: string }>(`SELECT "clave" FROM "Accion" WHERE "clave" IN ('centros_costos', 'distribucion_costos', 'reporte_gastos_por_unidad') ORDER BY 1`);
    expect(enBase.rows.map((f) => f.clave)).toEqual(CLAVES);
    expect(ACCIONES.map((a) => a.clave).filter((c) => (CLAVES as string[]).includes(c))).toEqual([]);
    for (const clave of CLAVES) expect(RESERVADAS_EN_BASE[clave]).toMatchObject({ migracion: NOMBRE, nivelMinimo: "administrador", semilla: ["admin"] });
    expect(RESERVADAS_EN_BASE.centros_costos!.contexto).toBe("empresa");
    expect([RESERVADAS_EN_BASE.distribucion_costos!.contexto, RESERVADAS_EN_BASE.reporte_gastos_por_unidad!.contexto]).toEqual(["sucursal", "sucursal"]);
  });

  it("da de alta las tres en Accion con la descripción DEFINITIVA de la lista de reservadas (la que compara la paridad)", async () => {
    for (const clave of CLAVES) {
      const r = await base.cliente.query<{ descripcion: string }>(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [clave]);
      expect(r.rows.map((f) => f.descripcion), clave).toEqual([RESERVADAS_EN_BASE[clave]!.descripcion]);
    }
  });

  it("el admin de CADA empresa recibe las tres claves (se reconoce por su clave de sistema, haya o no tenido filas antes), con Ver y Editar, y su empresaId es el de su rol", async () => {
    for (const clave of CLAVES) {
      expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
      expect((await filas(clave)).every((f) => f.ver && f.editar && f.empresa === f.deLaFila), clave).toBe(true);
    }
    const admins = await base.cliente.query<{ empresa: string; n: number }>(`SELECT "empresaId" AS empresa, count(*)::int AS n FROM "PermisoRol" WHERE "rolId" IN ('a-admin', 'b-admin') AND "accionClave" = ANY($1) GROUP BY 1 ORDER BY 1`, [CLAVES]);
    expect(admins.rows).toEqual([{ empresa: "emp-a", n: 3 }, { empresa: "emp-b", n: 3 }]);
  });

  it("NINGÚN otro rol recibe ninguna: ni el operador que carga compras, ni un rol propio con permisos de gastos, ni uno vacío (sin copia desde otras claves)", async () => {
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
    await base.cliente.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'distribucion_costos'`);
    const antes = { conteos: await conteos(), filas: await filas("distribucion_costos") };
    await base.cliente.query(leer("migration.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect({ conteos: await conteos(), filas: await filas("distribucion_costos") }).toEqual(antes);
    expect(antes.conteos.acciones).toBe(3);
    expect(antes.conteos.permisos).toBe(6);
    expect((await filas("distribucion_costos")).find((f) => f.rol === "b-admin")).toMatchObject({ ver: true, editar: false });
    await base.cliente.query(`UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'distribucion_costos'`);
  });

  it("una empresa que nace DESPUÉS no las recibe de esta migración (el alta siembra desde ACCIONES, y todavía no están ahí): volver a correrla cubre su admin", async () => {
    await base.cliente.query(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ('emp-c', 'emp-c', 'emp-c', 'America/Argentina/Buenos_Aires', 'ARS')`);
    await base.cliente.query(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ('c-admin', 'emp-c', 'admin', 'admin')`);
    expect(await quienLaTiene("centros_costos")).not.toContain("c-admin");
    await base.cliente.query(leer("migration.sql"));
    for (const clave of CLAVES) expect(await quienLaTiene(clave), clave).toContain("c-admin");
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

  it("el down ABORTA si la configuración cambió (una delegación a otro rol, un cambio del admin o una capacidad por sucursal) y no toca nada; con la semilla pura, pasa", async () => {
    const intentarBajar = async () => {
      try {
        await base.cliente.query("BEGIN");
        await base.cliente.query(leer("down.sql"));
        await base.cliente.query("COMMIT");
        return "bajó";
      } catch (error) {
        await base.cliente.query("ROLLBACK");
        return (error as Error).message;
      }
    };
    const casos: Array<[string, string, string]> = [
      ["una delegación a otro rol", `INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ('deleg', 'emp-a', 'a-encargado', 'centros_costos', true, false)`, `DELETE FROM "PermisoRol" WHERE "id" = 'deleg'`],
      ["el Editar del admin apagado", `UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'a-admin' AND "accionClave" = 'distribucion_costos'`, `UPDATE "PermisoRol" SET "puedeEditar" = true WHERE "rolId" = 'a-admin' AND "accionClave" = 'distribucion_costos'`],
      ["el Ver del admin apagado", `UPDATE "PermisoRol" SET "puedeVer" = false WHERE "rolId" = 'b-admin' AND "accionClave" = 'reporte_gastos_por_unidad'`, `UPDATE "PermisoRol" SET "puedeVer" = true WHERE "rolId" = 'b-admin' AND "accionClave" = 'reporte_gastos_por_unidad'`],
      ["una capacidad por sucursal", `INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-un', 'emp-a', 'distribucion_costos', NULL, false)`, `DELETE FROM "CapacidadSucursal" WHERE "id" = 'cap-un'`],
    ];
    const antes = await conteos();
    for (const [cual, tocar, restaurar] of casos) {
      await base.cliente.query(tocar);
      const conLoTocado = await conteos();
      expect(await intentarBajar(), cual).toMatch(/No se puede bajar M7\.4: hay 1 fila/);
      expect(await conteos(), `${cual}: no tocó nada`).toEqual(conLoTocado);
      await base.cliente.query(restaurar);
      expect(await conteos(), `${cual}: restaurado`).toEqual(antes);
    }
    // Con la semilla pura pasa y deja CERO filas de las tres, sin tocar las demás.
    const cap = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "accionClave" = ANY($1)`, [CLAVES]);
    expect(cap.rows[0]!.n).toBe(0);
    const otrasAntes = antes.otras;
    expect(await intentarBajar()).toBe("bajó");
    const despues = await conteos();
    expect([despues.acciones, despues.permisos, despues.otras]).toEqual([0, 0, otrasAntes]);
    const capacidadDeOrigen = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "id" = 'cap-a'`);
    expect(capacidadDeOrigen.rows[0]!.n).toBe(1);
  });

  it("la reversa es idempotente, y subir otra vez después de bajar deja las claves como la primera vez (sube-baja-sube)", async () => {
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    for (const clave of CLAVES) expect(await quienLaTiene(clave), clave).toEqual(["a-admin", "b-admin"]);
    expect(await conteos()).toMatchObject({ acciones: 3, permisos: 6 });
  });

  it("el migration.sql y el down.sql avisan que requieren autorización, que la reversa ABORTA, y no se disfrazan de migración de políticas de sucursal", () => {
    expect(leer("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(leer("down.sql")).toMatch(/ABORTA/);
    for (const sql of [leer("migration.sql"), leer("down.sql")]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});
