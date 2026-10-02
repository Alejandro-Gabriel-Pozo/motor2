import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Migración de datos 20261001120000_gerente_unico_por_empresa: cada empresa queda con UN gerente. Si tenía varios, el más antiguo; si no tenía
 * ninguno, su admin activo más antiguo. Acá hay DOS empresas para comprobar que cada una se resuelve por separado.
 *
 * Estos tests siembran a propósito empresas con VARIOS gerentes (el dato que la migración repara): el índice único parcial que creó después S-13
 * (`UsuarioEmpresa_empresaId_gerente_key`) lo impediría, así que se lo suelta mientras corren y se lo recrea al terminar.
 */
const INDICE_GERENTE_UNICO = `CREATE UNIQUE INDEX IF NOT EXISTS "UsuarioEmpresa_empresaId_gerente_key" ON "UsuarioEmpresa"("empresaId") WHERE "rolEmpresa" = 'gerente'`;

const SQL = readFileSync(join(__dirname, "../../prisma/migrations/20261001120000_gerente_unico_por_empresa/migration.sql"), "utf8");
const SENTENCIAS = SQL.replace(/\r\n/g, "\n")
  .split(";\n")
  .map((s) =>
    s
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0);

async function correrMigracion() {
  for (const sentencia of SENTENCIAS) await prismaAdmin.$executeRawUnsafe(sentencia);
}

const NORTE = "norte";
const EMPRESAS = [EMPRESA_POR_DEFECTO_ID, NORTE];
const dia = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("migración de datos: un gerente por empresa", () => {
  const sucursal: Record<string, string> = {};
  const rolAdmin: Record<string, string> = {};
  const rolOperador: Record<string, string> = {};

  let habiaIndice = false;

  beforeAll(async () => {
    habiaIndice = (await prismaAdmin.$queryRaw<unknown[]>`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'UsuarioEmpresa_empresaId_gerente_key'`).length > 0;
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.$executeRawUnsafe('DROP INDEX IF EXISTS "UsuarioEmpresa_empresaId_gerente_key"');
    await prismaAdmin.empresa.create({
      data: { id: NORTE, nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
    });
    for (const empresaId of EMPRESAS) {
      sucursal[empresaId] = (await prismaAdmin.sucursal.create({ data: { nombre: `Suc ${empresaId}`, empresaId } })).id;
      rolAdmin[empresaId] = (await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId } })).id;
      rolOperador[empresaId] = (await prismaAdmin.rol.create({ data: { nombre: "operador", empresaId } })).id;
    }
  });

  afterAll(async () => {
    await limpiarBaseDeTest();
    if (habiaIndice) await prismaAdmin.$executeRawUnsafe(INDICE_GERENTE_UNICO);
  });

  /** Una persona con su pertenencia a la empresa y su membresía de sucursal, creadas el día indicado. */
  async function persona(
    empresaId: string,
    email: string,
    o: { dia: number; rol?: "admin" | "operador"; rolEmpresa?: string | null; activoSucursal?: boolean; activoEmpresa?: boolean },
  ) {
    const usuario = await prismaAdmin.user.create({ data: { email } });
    await prismaAdmin.usuarioEmpresa.create({
      data: { usuarioId: usuario.id, empresaId, rolEmpresa: o.rolEmpresa ?? null, activo: o.activoEmpresa ?? true, creadoEn: dia(o.dia) },
    });
    await prismaAdmin.usuarioSucursal.create({
      data: {
        usuarioId: usuario.id,
        empresaId,
        sucursalId: sucursal[empresaId],
        rolId: (o.rol ?? "admin") === "admin" ? rolAdmin[empresaId] : rolOperador[empresaId],
        activo: o.activoSucursal ?? true,
        creadoEn: dia(o.dia),
      },
    });
    return usuario.id;
  }

  const gerentesDe = async (empresaId: string) =>
    (await prismaAdmin.usuarioEmpresa.findMany({ where: { empresaId, rolEmpresa: "gerente" }, include: { usuario: true } })).map((g) => g.usuario.email);

  it("tiene las dos sentencias esperadas (quitar los sobrantes, nombrar al faltante)", () => {
    expect(SENTENCIAS.length).toBe(2);
  });

  it("una empresa sin gerente queda con su admin activo más antiguo, cada empresa por separado", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "segundo@central.com", { dia: 5 });
    await persona(EMPRESA_POR_DEFECTO_ID, "primero@central.com", { dia: 2 });
    await persona(NORTE, "primero@norte.com", { dia: 9 });
    await persona(NORTE, "segundo@norte.com", { dia: 10 });

    await correrMigracion();

    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual(["primero@central.com"]);
    expect(await gerentesDe(NORTE)).toEqual(["primero@norte.com"]);
  });

  it("no elige a quien no puede serlo: un operador, un admin desactivado ni alguien con la cuenta de empresa apagada", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "operador@central.com", { dia: 1, rol: "operador" });
    await persona(EMPRESA_POR_DEFECTO_ID, "baja-sucursal@central.com", { dia: 2, activoSucursal: false });
    await persona(EMPRESA_POR_DEFECTO_ID, "baja-empresa@central.com", { dia: 3, activoEmpresa: false });
    await persona(EMPRESA_POR_DEFECTO_ID, "elegido@central.com", { dia: 4 });

    await correrMigracion();

    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual(["elegido@central.com"]);
  });

  it("una empresa que ya tiene gerente no cambia, aunque haya un admin más antiguo", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "antiguo@central.com", { dia: 1 });
    await persona(EMPRESA_POR_DEFECTO_ID, "gerente@central.com", { dia: 8, rolEmpresa: "gerente" });

    await correrMigracion();

    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual(["gerente@central.com"]);
  });

  it("una empresa con más de un gerente queda con el más antiguo; la otra empresa no se toca", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "reciente@central.com", { dia: 9, rolEmpresa: "gerente" });
    await persona(EMPRESA_POR_DEFECTO_ID, "antiguo@central.com", { dia: 3, rolEmpresa: "gerente" });
    await persona(EMPRESA_POR_DEFECTO_ID, "otro@central.com", { dia: 6, rolEmpresa: "gerente" });
    await persona(NORTE, "unico@norte.com", { dia: 9, rolEmpresa: "gerente" });

    await correrMigracion();

    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual(["antiguo@central.com"]);
    expect(await gerentesDe(NORTE)).toEqual(["unico@norte.com"]);
    const quitados = await prismaAdmin.usuarioEmpresa.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, usuario: { email: { in: ["reciente@central.com", "otro@central.com"] } } } });
    expect(quitados.map((q) => q.rolEmpresa)).toEqual([null, null]);
  });

  it("no pisa otro rol de empresa de un usuario que no es el elegido", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "auditor@central.com", { dia: 7, rolEmpresa: "auditor" });
    await persona(EMPRESA_POR_DEFECTO_ID, "elegido@central.com", { dia: 2 });

    await correrMigracion();

    const auditor = await prismaAdmin.usuarioEmpresa.findFirstOrThrow({ where: { usuario: { email: "auditor@central.com" } } });
    expect(auditor.rolEmpresa).toBe("auditor");
    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual(["elegido@central.com"]);
  });

  it("una empresa sin ningún admin queda sin gerente (no inventa uno)", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "operador@central.com", { dia: 1, rol: "operador" });
    await correrMigracion();
    expect(await gerentesDe(EMPRESA_POR_DEFECTO_ID)).toEqual([]);
  });

  it("es idempotente: una segunda corrida no cambia nada", async () => {
    await persona(EMPRESA_POR_DEFECTO_ID, "a@central.com", { dia: 2 });
    await persona(EMPRESA_POR_DEFECTO_ID, "b@central.com", { dia: 3 });
    await persona(NORTE, "a@norte.com", { dia: 4, rolEmpresa: "gerente" });
    await persona(NORTE, "b@norte.com", { dia: 5, rolEmpresa: "gerente" });

    await correrMigracion();
    const primera = await prismaAdmin.usuarioEmpresa.findMany({ orderBy: { id: "asc" }, select: { id: true, rolEmpresa: true } });
    await correrMigracion();
    const segunda = await prismaAdmin.usuarioEmpresa.findMany({ orderBy: { id: "asc" }, select: { id: true, rolEmpresa: true } });

    expect(segunda).toEqual(primera);
  });
});
