import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración 20261006120000_clave_de_rol_de_sistema (G1): `Rol.clave`, con backfill desde los nombres «admin» y «operador». Se corre acá contra la base
 * de pruebas, sentencia por sentencia y como DUEÑO. Cada test termina con la base en el estado NUEVO (el que espera el resto de la suite).
 */
const CARPETA = join(__dirname, "../../prisma/migrations/20261006120000_clave_de_rol_de_sistema");

/** Parte un .sql en sentencias respetando los bloques `$$ … $$` (un DO tiene `;` adentro). */
function sentenciasDe(archivo: string): string[] {
  const sql = readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const salida: string[] = [];
  let actual = "";
  let dentroDeBloque = false;
  for (const linea of sql.split("\n")) {
    actual += linea + "\n";
    if ((linea.match(/\$\$/g) ?? []).length % 2 === 1) dentroDeBloque = !dentroDeBloque;
    if (!dentroDeBloque && linea.trimEnd().endsWith(";")) {
      salida.push(actual.trim());
      actual = "";
    }
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

const MIGRACION = sentenciasDe("migration.sql");
const REVERSA = sentenciasDe("down.sql");

async function correr(sentencias: string[]) {
  for (const s of sentencias) await prismaAdmin.$executeRawUnsafe(s);
}

const claves = async () =>
  Object.fromEntries((await prismaAdmin.rol.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID } })).map((r) => [r.nombre, r.clave]));

describe("migración de la clave de los roles de sistema", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  afterEach(async () => {
    await correr(MIGRACION); // idempotente: deja el estado nuevo aunque el test haya vuelto al viejo
  });

  it("el backfill da clave a «admin» y «operador» y deja en NULL cualquier otro rol", async () => {
    await correr(REVERSA);
    await prismaAdmin.$executeRawUnsafe(
      `INSERT INTO "Rol" ("id", "empresaId", "nombre") VALUES ('r-admin', '${EMPRESA_POR_DEFECTO_ID}', 'admin'), ('r-op', '${EMPRESA_POR_DEFECTO_ID}', 'operador'), ('r-otro', '${EMPRESA_POR_DEFECTO_ID}', 'encargado')`
    );

    await correr(MIGRACION);
    expect(await claves()).toEqual({ admin: "admin", operador: "operador", encargado: null });
  });

  it("es idempotente y no pisa una clave que ya estaba", async () => {
    await prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "admin", clave: "admin" } });
    await correr(MIGRACION);
    await correr(MIGRACION);
    expect(await claves()).toEqual({ admin: "admin" });
  });

  it("el índice único impide dos roles con la misma clave en una empresa, pero admite varios sin clave", async () => {
    await prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "admin", clave: "admin" } });
    await expect(prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "jefe", clave: "admin" } })).rejects.toThrow(/Unique constraint|clave/);
    await prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "uno" } });
    await prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "dos" } });
    expect(Object.keys(await claves())).toEqual(expect.arrayContaining(["admin", "uno", "dos"]));
  });

  it("el CHECK rechaza una clave vacía o con mayúsculas", async () => {
    for (const clave of ["", "Admin", "con espacio", "1admin"]) {
      await expect(prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: `x-${clave}`, clave } })).rejects.toThrow(/Rol_clave_formato_check|check constraint/);
    }
  });

  it("la reversa saca la columna, el índice y el CHECK sin tocar los roles", async () => {
    await prismaAdmin.rol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, nombre: "admin", clave: "admin" } });
    await correr(REVERSA);

    const columna = await prismaAdmin.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Rol' AND column_name = 'clave'`
    );
    const indice = await prismaAdmin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'Rol_empresaId_clave_key'`);
    const roles = await prismaAdmin.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "Rol" WHERE "nombre" = 'admin'`);
    expect([columna[0].n, indice[0].n, roles[0].n]).toEqual([0, 0, 1]);
  });
});
