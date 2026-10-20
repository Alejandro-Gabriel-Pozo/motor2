import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutarScript } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Ola «precio y carta», Fase 3, paso 3.7: `scripts/operaciones/verificar-retiro-go3a.sql`, la verificación previa de SOLO LECTURA del retiro de GO-3a (se corre antes de pedir el OK).
 *  - Estático: solo `SELECT` y un bloque `DO` que solo lee (ni escrituras, ni DDL, ni permisos, ni comandos de psql, ni cambio de rol).
 *  - Dinámico, contra una base TEMPORAL (nunca `motor2_dev` ni una real) y dentro de `BEGIN READ ONLY`, con el mismo ejecutor que usa el dueño: con GO-3a arriba y sin filas, pasa; con UNA fila
 *    en `CombinacionEnLinea`, el bloque final ABORTA; con el retiro ya aplicado (las tablas no existen), pasa.
 *
 * Mutación demostrada (roja y revertida): sacar `CombinacionEnLinea` de la lista del bloque final (rojo: «con una fila en CombinacionEnLinea, aborta»).
 */
const RAIZ = join(__dirname, "../..");
const SCRIPT = readFileSync(join(RAIZ, "scripts/operaciones/verificar-retiro-go3a.sql"), "utf8");
const RETIRO_RLS = "20261022100000_retiro_go3a_rls";
const E = "empresa_verificar";

/** Las sentencias del script sin comentarios (`--` de línea), respetando los bloques `$$ … $$`. */
function sentencias(texto: string): string[] {
  const salida: string[] = [];
  let actual = "";
  let enDolares = false;
  for (const lineaCruda of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linea = enDolares ? lineaCruda : lineaCruda.replace(/--.*$/, "");
    if (linea.trim() === "") continue;
    actual += `${linea}\n`;
    if ((linea.match(/\$\$/g) ?? []).length % 2 === 1) enDolares = !enDolares;
    if (!enDolares && /;\s*$/.test(linea)) {
      salida.push(actual.trim());
      actual = "";
    }
  }
  if (actual.trim() !== "") salida.push(actual.trim());
  return salida;
}

/** Lo que hace que una sentencia NO sea de solo lectura (vacío = solo lee). */
function problemasDeSoloLectura(texto: string): string[] {
  const problemas: string[] = [];
  for (const s of sentencias(texto)) {
    if (s.startsWith("\\")) problemas.push(`comando de psql: ${s.slice(0, 40)}`);
    else if (!/^(SELECT|DO)\b/i.test(s)) problemas.push(`no empieza con SELECT ni DO: ${s.slice(0, 50).replace(/\s+/g, " ")}`);
    const sinTextos = s.replace(/'(?:[^']|'')*'/g, "''");
    if (/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|VACUUM|REINDEX|CLUSTER|LOCK|COMMENT|SECURITY|nextval|setval|set_config|pg_terminate_backend)\b/i.test(sinTextos)) {
      problemas.push(`escribe o cambia algo: ${s.slice(0, 60).replace(/\s+/g, " ")}`);
    }
    if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(sinTextos) && !/^DO\b/i.test(s)) problemas.push(`SELECT … INTO: ${s.slice(0, 50)}`);
  }
  return problemas;
}

let base: BaseTemporalMigrada;
let hayRol = false;

/** Corre el script como el ejecutor del dueño, dentro de BEGIN READ ONLY y siempre con ROLLBACK. Devuelve el error, o `null` si pasó. */
async function verificar(): Promise<Error | null> {
  const c = base.cliente;
  await c.query("BEGIN READ ONLY");
  try {
    await ejecutarScript(SCRIPT, c, {}, { literal: (v: string) => c.escapeLiteral(v), identificador: (v: string) => c.escapeIdentifier(v) });
    return null;
  } catch (e) {
    return e as Error;
  } finally {
    await c.query("ROLLBACK");
  }
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  if (!hayRol) return;
  await base.aplicarAntesDe(RETIRO_RLS);
  const c: Client = base.cliente;
  await c.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await c.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_v',$1,'Centro')`, [E]);
  await c.query(`INSERT INTO "User" ("id","email") VALUES ('u_v','verificar@ejemplo.test')`);
  await c.query(`INSERT INTO "Rol" ("id","empresaId","nombre","clave") VALUES ('rol_admin_v',$1,'admin','admin')`, [E]);
  // La clave de GO-3a sembrada al admin, como la dejó su migración (es la semilla: no bloquea).
  await c.query(`INSERT INTO "PermisoRol" ("id","empresaId","rolId","accionClave","puedeVer","puedeEditar") VALUES ('pr_v',$1,'rol_admin_v','grupos_de_precio_definir',true,true)`, [E]);
  await c.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_v',$1,'u','CANTIDAD')`, [E]);
  await c.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_v',$1,'PV','Café','PV','uni_v',1000)`, [E]);
  await c.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('gru_v',$1,'Tamaño','MEDIDA',1,1)`, [E]);
  await c.query(`INSERT INTO "OpcionDeGrupo" ("id","empresaId","grupoId","nombre") VALUES ('op_v',$1,'gru_v','Grande')`, [E]);
  await c.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa_v',$1,'suc_v',1)`, [E]);
  await c.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cta_v',$1,'mesa_v','u_v')`, [E]);
  await c.query(`INSERT INTO "CuentaItem" ("id","empresaId","cuentaId","productoId","cantidad","precioUnitario") VALUES ('item_v',$1,'cta_v','prod_v',1,1000)`, [E]);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("verificar-retiro-go3a.sql: verificación previa de SOLO LECTURA del retiro de GO-3a", () => {
  it("estático: solo SELECT y un DO que solo lee (y el detector ve lo que escribe)", () => {
    const todas = sentencias(SCRIPT);
    expect(todas.length).toBeGreaterThan(5);
    expect(todas.filter((s) => /^DO\b/i.test(s))).toHaveLength(1);
    expect(problemasDeSoloLectura(SCRIPT)).toEqual([]);
    expect(problemasDeSoloLectura("SELECT 1;\nDELETE FROM \"PermisoRol\";")).not.toEqual([]);
    expect(problemasDeSoloLectura("DO $$\nBEGIN\n  DROP TABLE \"GrupoDePrecio\";\nEND\n$$;")).not.toEqual([]);
    expect(problemasDeSoloLectura("SELECT set_config('x', 'y', false);")).not.toEqual([]);
    expect(problemasDeSoloLectura("\\i otro.sql")).not.toEqual([]);
    expect(problemasDeSoloLectura("SELECT 'DROP TABLE x' AS texto; -- DELETE")).toEqual([]);
  });

  it("dinámico: con GO-3a arriba y sin filas (la clave solo con la semilla), pasa dentro de BEGIN READ ONLY", async () => {
    if (!hayRol) return;
    expect(await verificar()).toBeNull();
  });

  it("dinámico: con UNA fila en CombinacionEnLinea, el bloque final ABORTA (y no escribió nada)", async () => {
    if (!hayRol) return;
    const c = base.cliente;
    await c.query("BEGIN");
    try {
      await c.query(`INSERT INTO "CombinacionDeProducto" ("id","empresaId","productoId","opcionEje1Id") VALUES ('cb_v',$1,'prod_v','op_v')`, [E]);
      await c.query(`INSERT INTO "CombinacionEnLinea" ("id","empresaId","cuentaItemId","combinacionId","origenPrecio") VALUES ('foto_v',$1,'item_v','cb_v','ADITIVO')`, [E]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    // Sin la combinación: solo la foto cuenta, para que el rojo de la mutación (sacar CombinacionEnLinea de la lista) se vea.
    await c.query(`ALTER TABLE "CombinacionEnLinea" DROP CONSTRAINT "CombinacionEnLinea_empresaId_combinacionId_fkey"`);
    await c.query(`DELETE FROM "CombinacionDeProducto"`);
    try {
      const error = await verificar();
      expect(error?.message).toMatch(/verificación del retiro de GO-3a: BLOQUEA \(1 fila/);
      expect(Number((await c.query(`SELECT count(*) AS n FROM "CombinacionEnLinea"`)).rows[0].n)).toBe(1);
    } finally {
      await c.query(`DELETE FROM "CombinacionEnLinea"`);
    }
  });

  it("dinámico: con el retiro aplicado (las tablas y la columna ya no existen), pasa", async () => {
    if (!hayRol) return;
    await base.aplicarRestantes();
    expect(await verificar()).toBeNull();
  });
});
