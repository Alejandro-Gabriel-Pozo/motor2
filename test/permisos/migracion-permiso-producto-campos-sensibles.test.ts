import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M.2 (P1) — migración de DATOS 20261013120000_permiso_producto_campos_sensibles: alta de la clave fina `producto_campos_sensibles` (cambiar el precio de
 * venta, el factor de conversión y las unidades de un producto; definir el factor de una presentación de compra) y COPIA de lo que cada rol ya podía:
 * todo rol que HOY edita `producto_editar` o `producto_presentaciones` recibe la clave nueva (Ver y Editar), más el rol de clave `admin` de cada empresa.
 * Quien podía cambiar esos campos antes de la migración puede después: la clave fina no le quita nada a nadie el día que se despliega (la restricción llega
 * cuando el dueño la quite del rol, a propósito).
 *
 * La migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto: el `empresaId` de cada fila nueva sale de la fila de origen. Por
 * eso acá hay DOS empresas, para comprobar que cada una conserva lo suyo y que nada cruza. Se corre sobre una base temporal armada migración por migración
 * (la anterior a la nuestra aplicada, la nuestra a mano), así que no depende de la base de desarrollo.
 *
 * NO copia `CapacidadSucursal` a propósito: sin fila, la capacidad de una acción está habilitada en toda sucursal; copiar el «apagado» de otra clave
 * sería inventar una restricción que nadie pidió.
 */
const NOMBRE = "20261013120000_permiso_producto_campos_sensibles";
const CLAVE = "producto_campos_sensibles";
const leer = (archivo: string) => readFileSync(join(__dirname, "../../prisma/migrations", NOMBRE, archivo), "utf8");

describe("migración de datos M.2: la clave fina producto_campos_sensibles", () => {
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

    // Las claves de origen: algunas las sembró el seed original y no las crea ninguna migración, así que una base temporal no las trae.
    for (const clave of ["alta_producto", "producto_editar", "producto_presentaciones"]) {
      await q(`INSERT INTO "Accion" ("clave", "descripcion") VALUES ($1, $1) ON CONFLICT ("clave") DO NOTHING`, [clave]);
    }
    for (const e of ["emp-a", "emp-b"]) {
      await q(`INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda") VALUES ($1, $1, $1, 'America/Argentina/Buenos_Aires', 'ARS')`, [e]);
    }
    // [id, empresa, nombre, clave de sistema]
    const roles: [string, string, string, string | null][] = [
      ["a-admin", "emp-a", "admin", "admin"], // edita producto_editar (como de fábrica)
      ["a-operador", "emp-a", "operador", "operador"], // edita producto_editar (como de fábrica)
      ["a-encargado", "emp-a", "encargado", null], // rol propio con producto_editar en Editar
      ["a-presentaciones", "emp-a", "presentaciones", null], // solo producto_presentaciones en Editar
      ["a-ambas", "emp-a", "ambas", null], // las dos claves en Editar: UNA sola fila nueva
      ["a-solo-ver", "emp-a", "solover", null], // producto_editar en Ver, no en Editar
      ["a-vacio", "emp-a", "vacio", null], // sin ninguna fila
      ["a-otra-cosa", "emp-a", "otracosa", null], // edita otras claves, no las dos
      ["b-admin", "emp-b", "admin", "admin"], // el admin de B NO tiene ninguna fila: igual la recibe
      ["b-encargado", "emp-b", "encargado", null], // rol propio de B con producto_editar
      ["b-vacio", "emp-b", "vacio", null],
    ];
    for (const [id, empresa, nombre, clave] of roles) {
      await q(`INSERT INTO "Rol" ("id", "empresaId", "nombre", "clave") VALUES ($1, $2, $3, $4)`, [id, empresa, nombre, clave]);
    }
    // [rol, clave, ver, editar]
    const permisos: [string, string, boolean, boolean][] = [
      ["a-admin", "producto_editar", true, true],
      ["a-operador", "producto_editar", true, true],
      ["a-encargado", "producto_editar", true, true],
      ["a-presentaciones", "producto_presentaciones", true, true],
      ["a-ambas", "producto_editar", true, true],
      ["a-ambas", "producto_presentaciones", true, true],
      ["a-solo-ver", "producto_editar", true, false],
      ["a-solo-ver", "producto_presentaciones", true, false],
      ["a-otra-cosa", "alta_producto", true, true],
      ["b-encargado", "producto_editar", true, true],
    ];
    for (const [rol, clave, ver, editar] of permisos) {
      const empresa = rol.startsWith("a-") ? "emp-a" : "emp-b";
      await q(`INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ($1, $2, $3, $4, $5, $6)`, [`${rol}|${clave}`, empresa, rol, clave, ver, editar]);
    }
    // Una capacidad de sucursal APAGADA para la clave de origen: la migración no la copia.
    await q(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-a', 'emp-a', 'producto_editar', NULL, false)`);

    await q(leer("migration.sql"));
  }, 240_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("da de alta la clave en Accion con la descripción IDÉNTICA a la del catálogo del código", async () => {
    const r = await base.cliente.query<{ descripcion: string }>(`SELECT "descripcion" FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(r.rows.map((f) => f.descripcion)).toEqual([ACCIONES.find((a) => a.clave === CLAVE)!.descripcion]);
  });

  it("el admin la recibe en cada empresa, haya o no tenido filas de producto (el rol se reconoce por su clave de sistema, no por el nombre)", async () => {
    const tiene = await quienLaTiene();
    expect(tiene).toContain("a-admin");
    expect(tiene).toContain("b-admin");
  });

  it("el operador de fábrica y un rol propio con producto_editar en Editar la reciben", async () => {
    const tiene = await quienLaTiene();
    expect(tiene).toEqual(expect.arrayContaining(["a-operador", "a-encargado", "b-encargado"]));
  });

  it("un rol con solo producto_presentaciones en Editar la recibe", async () => {
    expect(await quienLaTiene()).toContain("a-presentaciones");
  });

  it("un rol con las dos claves en Editar recibe UNA sola fila (no dos)", async () => {
    expect((await quienLaTiene()).filter((r) => r === "a-ambas")).toEqual(["a-ambas"]);
  });

  it("un rol con solo Ver NO la recibe; tampoco un rol sin nada ni uno que edita otras claves", async () => {
    const tiene = await quienLaTiene();
    for (const r of ["a-solo-ver", "a-vacio", "a-otra-cosa", "b-vacio"]) expect(tiene, r).not.toContain(r);
  });

  it("el conjunto exacto de roles que la reciben es el esperado, con Ver y Editar en true", async () => {
    const filas = await filasDeLaClave();
    expect(filas.map((f) => f.rol)).toEqual(["a-admin", "a-ambas", "a-encargado", "a-operador", "a-presentaciones", "b-admin", "b-encargado"]);
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
    // Los ids de las filas de origen son «rol|clave»: 9 filas sembradas (7 con Editar, 2 solo con Ver), ninguna cambió.
    const origen = await base.cliente.query<{ total: number; editan: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE "puedeEditar")::int AS editan FROM "PermisoRol" WHERE "id" LIKE '%|producto_%'`
    );
    expect(origen.rows[0]).toEqual({ total: 9, editan: 7 });
  });

  it("es idempotente y NO pisa una fila existente: correrla otra vez no duplica ni reactiva lo que el admin apagó", async () => {
    // El admin de la empresa A le sacó la clave fina al encargado (Ver sí, Editar no) y a B le sumaron una a mano.
    await base.cliente.query(`UPDATE "PermisoRol" SET "puedeEditar" = false WHERE "rolId" = 'a-encargado' AND "accionClave" = $1`, [CLAVE]);
    const antes = await filasDeLaClave();
    await base.cliente.query(leer("migration.sql"));
    await base.cliente.query(leer("migration.sql"));
    const despues = await filasDeLaClave();
    expect(despues).toEqual(antes);
    expect(despues.find((f) => f.rol === "a-encargado")).toMatchObject({ ver: true, editar: false });
    const acciones = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Accion" WHERE "clave" = $1`, [CLAVE]);
    expect(acciones.rows[0].n).toBe(1);
  });

  it("down.sql deja CERO filas de la clave (Accion, PermisoRol y CapacidadSucursal) y no toca las demás", async () => {
    // Una capacidad de la clave (alguien la configuró después de la migración): la reversa la borra primero por la FK.
    await base.cliente.query(`INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado") VALUES ('cap-sensibles', 'emp-a', $1, NULL, false)`, [CLAVE]);
    const otrasAntes = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" <> $1`, [CLAVE]);

    await base.cliente.query(leer("down.sql"));

    const cuenta = async (tabla: string, columna: string) =>
      (await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${tabla}" WHERE "${columna}" = $1`, [CLAVE])).rows[0].n;
    expect([await cuenta("Accion", "clave"), await cuenta("PermisoRol", "accionClave"), await cuenta("CapacidadSucursal", "accionClave")]).toEqual([0, 0, 0]);
    const otrasDespues = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PermisoRol" WHERE "accionClave" <> $1`, [CLAVE]);
    expect(otrasDespues.rows[0].n).toBe(otrasAntes.rows[0].n);
    const capacidadDeOrigen = await base.cliente.query<{ n: number }>(`SELECT count(*)::int AS n FROM "CapacidadSucursal" WHERE "id" = 'cap-a'`);
    expect(capacidadDeOrigen.rows[0].n).toBe(1);
  });
});
