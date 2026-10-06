import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * S-13: una empresa tiene UN solo gerente y la base lo hace cumplir (índice único parcial sobre `UsuarioEmpresa("empresaId") WHERE "rolEmpresa" = 'gerente'`).
 * El chequeo previo de la migración (el bloque DO) se prueba corriéndolo contra datos con dos gerentes.
 *
 * Mutación: borrar el índice deja en rojo "rechaza un segundo gerente" y "el índice existe y es parcial".
 */
const NORTE = "norte";
const INDICE = "UsuarioEmpresa_empresaId_gerente_key";
const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20261001240000_gerente_unico_indice/migration.sql"), "utf8").replace(/\r\n/g, "\n");
const PRECHEQUEO = SQL.match(/DO \$\$[\s\S]*?\n\$\$;/)?.[0] ?? "";
const CREAR_INDICE = SQL.match(/CREATE UNIQUE INDEX[^;]*;/)?.[0].replace(/;$/, "") ?? "";

afterAll(() => prismaAdmin.$disconnect());

async function persona(email: string, empresaId: string, rolEmpresa: string | null = null) {
  const u = await prismaAdmin.user.create({ data: { email } });
  await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: u.id, empresaId, rolEmpresa } });
  return u.id;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.create({ data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
});

describe("índice único parcial: un gerente por empresa", () => {
  it("el índice existe, es único y es parcial sobre rolEmpresa = 'gerente'", async () => {
    const [fila] = await prismaAdmin.$queryRaw<Array<{ def: string }>>`SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${INDICE}`;
    expect(fila?.def).toMatch(/CREATE UNIQUE INDEX/);
    expect(fila?.def).toMatch(/\("empresaId"\)/);
    expect(fila?.def).toMatch(/WHERE \("rolEmpresa" = 'gerente'::text\)/);
  });

  it("rechaza un segundo gerente en la misma empresa", async () => {
    await persona("a@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
    await expect(persona("b@test.com", EMPRESA_POR_DEFECTO_ID, "gerente")).rejects.toThrow(/Unique constraint|UsuarioEmpresa_empresaId_gerente_key/);
  });

  it("rechaza ascender a un segundo gerente por UPDATE", async () => {
    await persona("a@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
    const otro = await persona("b@test.com", EMPRESA_POR_DEFECTO_ID);
    await expect(prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: otro, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } })).rejects.toThrow();
  });

  it("deja un gerente por empresa, y cualquier cantidad de personas sin rol o con otro rol", async () => {
    await persona("a@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
    await persona("b@test.com", NORTE, "gerente");
    await persona("c@test.com", EMPRESA_POR_DEFECTO_ID);
    await persona("d@test.com", EMPRESA_POR_DEFECTO_ID);
    await persona("e@test.com", EMPRESA_POR_DEFECTO_ID, "auditor");
    await persona("f@test.com", EMPRESA_POR_DEFECTO_ID, "auditor");
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { rolEmpresa: "gerente" } })).toBe(2);
  });

  it("el traspaso (baja al actual y sube al nuevo en una transacción) sigue andando", async () => {
    const a = await persona("a@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
    const b = await persona("b@test.com", EMPRESA_POR_DEFECTO_ID);
    await prismaAdmin.$transaction([
      prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: a, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: null } }),
      prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: b, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } }),
    ]);
    expect((await prismaAdmin.usuarioEmpresa.findMany({ where: { rolEmpresa: "gerente" } })).map((g) => g.usuarioId)).toEqual([b]);
  });
});

describe("chequeo previo de la migración", () => {
  it("se pudo extraer el chequeo y la sentencia del índice del SQL de la migración", () => {
    expect(PRECHEQUEO).toContain("RAISE EXCEPTION");
    expect(CREAR_INDICE).toContain(INDICE);
  });

  it("con dos gerentes en una empresa se detiene y nombra la empresa; con datos limpios pasa", async () => {
    await prismaAdmin.$executeRawUnsafe(`DROP INDEX "${INDICE}"`);
    try {
      await persona("a@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
      await persona("b@test.com", EMPRESA_POR_DEFECTO_ID, "gerente");
      await persona("c@test.com", NORTE, "gerente");
      await expect(prismaAdmin.$executeRawUnsafe(PRECHEQUEO)).rejects.toThrow(new RegExp(`${EMPRESA_POR_DEFECTO_ID} \\(2 gerentes\\)`));
      await prismaAdmin.usuarioEmpresa.updateMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, usuario: { email: "b@test.com" } }, data: { rolEmpresa: null } });
      await prismaAdmin.$executeRawUnsafe(PRECHEQUEO);
    } finally {
      await limpiarBaseDeTest();
      await prismaAdmin.$executeRawUnsafe(CREAR_INDICE);
    }
  });
});
