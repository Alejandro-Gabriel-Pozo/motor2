import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { diagnosticarBase, type Consulta } from "../../scripts/verificar-registro-de-modulos";

/**
 * P5 contra Postgres real: las consultas del script (la comparación `creadoEn` vs `finished_at` en SQL) y la regla completa. La base de test tiene
 * la migración del registro aplicada (la empresa por defecto con sus 9 módulos) y se deja así al terminar, porque el build verifica después.
 */
const consulta: Consulta = async (sql, params = []) => (await prismaAdmin.$queryRawUnsafe(sql, ...params)) as Array<Record<string, unknown>>;
const datosDeEmpresa = { zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" } as const;
const ANTES = new Date("2000-01-01T00:00:00Z");

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

describe("verificar-registro-de-modulos contra la base", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("la base de test, tal como la deja la migración, no tiene fallas", async () => {
    expect((await diagnosticarBase(consulta)).fallas).toEqual([]);
  });

  it("detecta que a una empresa ACTIVE anterior a la migración le falta el registro (la vuelta atrás del ensayo O0)", async () => {
    const copia = await prismaAdmin.moduloEmpresa.findMany();
    await prismaAdmin.moduloEmpresa.deleteMany();
    try {
      const d = await diagnosticarBase(consulta);
      expect(d.fallas).toHaveLength(1);
      expect(d.fallas[0]).toContain("principal [ACTIVE]");
    } finally {
      await prismaAdmin.moduloEmpresa.createMany({ data: copia });
    }
  });

  it("una empresa creada después de la migración sin filas solo avisa; la misma con fecha anterior falla", async () => {
    await prismaAdmin.empresa.create({ data: { id: "nueva", nombre: "Nueva", slug: "nueva", estado: "ACTIVE", ...datosDeEmpresa } });
    const nueva = await diagnosticarBase(consulta);
    expect(nueva.fallas).toEqual([]);
    expect(nueva.avisos.join("\n")).toContain("nueva [ACTIVE]");

    await prismaAdmin.empresa.update({ where: { id: "nueva" }, data: { creadoEn: ANTES } });
    const vieja = await diagnosticarBase(consulta);
    expect(vieja.fallas).toHaveLength(1);
    expect(vieja.fallas[0]).toContain("nueva [ACTIVE]");
  });

  it("lista una fila con un módulo que no existe en el catálogo", async () => {
    await prismaAdmin.moduloEmpresa.create({ data: { empresaId: "empresa_principal", modulo: "inventado" } });
    const d = await diagnosticarBase(consulta);
    expect(d.fallas).toEqual([]);
    expect(d.avisos.join("\n")).toContain("«inventado»");
  });

  it("si la migración no figura como aplicada, es un error (no un registro «vacío»)", async () => {
    await expect(diagnosticarBase(async (sql) => (sql.includes("_prisma_migrations") ? [] : consulta(sql)))).rejects.toThrow(/no figura como aplicada/);
  });

  it("lo mismo vale para la migración de la clave de los roles de sistema (G1)", async () => {
    const sinLaClave: Consulta = async (sql, params = []) =>
      sql.includes("_prisma_migrations") && params[0] === "20261006120000_clave_de_rol_de_sistema" ? [] : consulta(sql, params);
    await expect(diagnosticarBase(sinLaClave)).rejects.toThrow(/20261006120000_clave_de_rol_de_sistema no figura como aplicada/);
  });

  it("falla si una empresa tiene un rol «admin» sin la clave «admin»", async () => {
    await prismaAdmin.rol.create({ data: { empresaId: "empresa_principal", nombre: "admin" } });
    const d = await diagnosticarBase(consulta);
    expect(d.fallas).toHaveLength(1);
    expect(d.fallas[0]).toContain("principal [ACTIVE]");
    expect(d.fallas[0]).toContain("clave");
  });
});
