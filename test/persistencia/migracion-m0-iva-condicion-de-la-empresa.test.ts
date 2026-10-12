import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONDICIONES_IVA } from "../../src/core/fiscal/iva";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M0-IVA (Paquete 2, fase EXPANDIR) — migración 20261015101000_m0_iva_condicion_de_la_empresa: `Empresa.condicionIva`, TEXT NULL de lista cerrada (CHECK). Se corre sobre una base
 * temporal armada migración por migración, con DOS empresas cargadas ANTES de la migración (una instalación de hoy).
 *
 * Qué fija: (a) las empresas viejas quedan con NULL («no declarada») y todo lo demás intacto; (b) el CHECK rechaza un código inventado (23514), una cadena vacía y minúsculas, y acepta
 * los de la lista; (c) la lista del CHECK es EXACTAMENTE `CONDICIONES_IVA`; (d) subir, bajar y subir deja el catálogo idéntico; (e) actualizar una empresa vieja SIN mencionar la
 * condición (como hacen la consola y la política de empresa hoy) sigue andando; (f) no hay privilegios ni políticas nuevas, y `motor2_app` NO gana escritura sobre `Empresa`.
 *
 * Mutaciones: sumar un código a la lista de TS rompe (c); sacar el CHECK del SQL rompe (b) y (c); sacar el DROP COLUMN del down.sql rompe (d); poner NOT NULL o un CHECK de
 * obligatoriedad rompe (a) y (e); otorgar un GRANT nuevo rompe (f).
 */
const NOMBRE = "20261015101000_m0_iva_condicion_de_la_empresa";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

/** Solo las empresas de este test: una migración anterior siembra además la empresa por defecto. */
const PROPIAS = `"id" IN ('emp-vieja-a', 'emp-vieja-b')`;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Columnas, restricciones, índices, privilegios y políticas de `Empresa`: lo que la migración puede tocar. */
async function fotoDeEmpresa() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Empresa' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Empresa"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Empresa' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Empresa' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Empresa' ORDER BY 1`),
    rls: await q(`SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado FROM pg_class WHERE oid = '"Empresa"'::regclass`),
  };
}

/** Corre `consulta` dentro de una transacción del dueño y SIEMPRE hace ROLLBACK: no deja nada escrito. */
async function conRollback<T>(consulta: () => Promise<T>): Promise<T> {
  await base.cliente.query("BEGIN");
  try {
    return await consulta();
  } finally {
    await base.cliente.query("ROLLBACK");
  }
}

const insertarEmpresa = (id: string, condicion: string | null) =>
  base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","condicionIva") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS',$2)`, [id, condicion]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  for (const [id, cuit] of [["emp-vieja-a", "30703088534"], ["emp-vieja-b", null]] as const) {
    await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","cuit","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,$2,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [id, cuit]);
  }
  fotoAntes = await fotoDeEmpresa();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("M0-IVA: condición de la empresa frente al IVA (migración 20261015101000)", () => {
  it("(a) al aplicar, las empresas viejas quedan con la condición en NULL y lo demás sin cambios; la tabla gana exactamente esa columna", async () => {
    const antes = await q(`SELECT * FROM "Empresa" WHERE ${PROPIAS} ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = await q<Record<string, unknown>>(`SELECT * FROM "Empresa" WHERE ${PROPIAS} ORDER BY "id"`);
    expect(despues.map((f) => f.condicionIva), "sin valor deducido: «no declarada»").toEqual([null, null]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([columna]) => columna !== "condicionIva"))), "ninguna otra columna cambió").toEqual(antes);
    const columnas = await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Empresa' AND column_name = 'condicionIva'`);
    expect(columnas).toEqual([{ columna: "condicionIva", data_type: "text", is_nullable: "YES", column_default: null }]);
  });

  it("(b) un código fuera de la lista da 23514 y los de la lista (y NULL) pasan", async () => {
    for (const malo of ["RI", "monotributo", "", "NO_ALCANZADO", "RESPONSABLE_INSCRIPTO "]) {
      await conRollback(async () => {
        await expect(insertarEmpresa("emp-mala", malo), `«${malo}»`).rejects.toMatchObject({ code: "23514", constraint: "Empresa_condicionIva_check" });
      });
    }
    await conRollback(async () => {
      for (const [i, codigo] of CONDICIONES_IVA.entries()) await insertarEmpresa(`emp-ok-${i}`, codigo);
      await insertarEmpresa("emp-null", null);
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "Empresa" WHERE "id" LIKE 'emp-ok-%'`))[0]!.n).toBe(CONDICIONES_IVA.length);
    });
  });

  it("(b2) el CHECK también frena una ACTUALIZACIÓN con un código inventado, y deja pasar la de uno válido", async () => {
    await conRollback(async () => {
      await expect(base.cliente.query(`UPDATE "Empresa" SET "condicionIva" = 'RI' WHERE "id" = 'emp-vieja-a'`)).rejects.toMatchObject({ code: "23514" });
    });
    await conRollback(async () => {
      await base.cliente.query(`UPDATE "Empresa" SET "condicionIva" = 'RESPONSABLE_INSCRIPTO' WHERE "id" = 'emp-vieja-a'`);
      expect((await q(`SELECT "id","condicionIva" FROM "Empresa" WHERE ${PROPIAS} ORDER BY "id"`))).toEqual([
        { id: "emp-vieja-a", condicionIva: "RESPONSABLE_INSCRIPTO" },
        { id: "emp-vieja-b", condicionIva: null },
      ]);
    });
  });

  it("(c) paridad: la lista del CHECK de la base es EXACTAMENTE CONDICIONES_IVA", async () => {
    const [fila] = await q<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Empresa"'::regclass AND conname = 'Empresa_condicionIva_check'`);
    expect(fila).toBeDefined();
    const lista = [...fila!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    expect([...lista].sort(), "los códigos del CHECK").toEqual([...CONDICIONES_IVA].sort());
    expect(new Set(lista).size, "sin repetidos").toBe(lista.length);
    expect(fila!.def).toContain(`"condicionIva" IS NULL`);
  });

  it("(e) actualizar una empresa vieja SIN mencionar la condición (como la consola y la política de hoy) sigue pasando: no hay obligatoriedad", async () => {
    await conRollback(async () => {
      const r = await base.cliente.query(`UPDATE "Empresa" SET "nombre" = 'Otro nombre', "permisosEditables" = false WHERE "id" = 'emp-vieja-a'`);
      expect(r.rowCount).toBe(1);
      expect((await q(`SELECT "condicionIva" FROM "Empresa" WHERE "id" = 'emp-vieja-a'`))).toEqual([{ condicionIva: null }]);
    });
    expect(await q(`SELECT conname FROM pg_constraint WHERE conrelid = '"Empresa"'::regclass AND NOT convalidated`), "ninguna restricción NOT VALID").toEqual([]);
  });

  it("(f) sin privilegios ni políticas nuevas, y motor2_app NO gana escritura sobre Empresa; solo se suman la columna y el CHECK", async () => {
    const despues = (await fotoDeEmpresa()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    for (const k of ["politicas", "indices", "privilegios", "rls"]) expect(despues[k], k).toEqual(antes[k]);
    expect(despues.restricciones.length, "una restricción más").toBe(antes.restricciones.length + 1);
    expect(despues.columnas.length, "una columna más").toBe(antes.columnas.length + 1);
    // Ni un GRANT por columna: la columna nueva hereda los privilegios de TABLA (ACL propia de la columna vacía), así que motor2_app sigue sin poder escribirla donde hoy no escribe Empresa.
    expect(await q(`SELECT attacl::text AS acl FROM pg_attribute WHERE attrelid = '"Empresa"'::regclass AND attname = 'condicionIva'`), "sin ACL propia en la columna").toEqual([{ acl: null }]);
  });

  it("(d) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo como antes (con las empresas viejas intactas) y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeEmpresa();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeEmpresa(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect((await q(`SELECT "id","cuit" FROM "Empresa" WHERE ${PROPIAS} ORDER BY "id"`)), "los datos de antes siguen").toEqual([
      { id: "emp-vieja-a", cuit: "30703088534" },
      { id: "emp-vieja-b", cuit: null },
    ]);
    await base.cliente.query(leer("down.sql")); // idempotente (IF EXISTS)
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeEmpresa(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
