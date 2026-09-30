import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, prisma, prismaAdmin } from "../setup/test-db";
import { baseDeEmpresa, dbDeEmpresa, transaccionDeEmpresa } from "../../src/core/auth/base";
import { verificarRolDeEjecucion, datosDelRolDeEjecucion } from "../../src/core/auth/rol-de-ejecucion";

/**
 * ADR-007, A5: cada operación del contexto de un usuario corre con `app.empresa_id` fijado (local a su transacción). Se prueba con DOS
 * empresas ACTIVE, donde el default de `empresaId` (`app_empresa_actual()`) es NULL salvo que haya contexto: si una fila queda en la
 * empresa correcta sin decir `empresaId`, es porque el contexto llegó a la consulta.
 */
afterAll(() => prismaAdmin.$disconnect());

async function crearEmpresa(id: string) {
  return prisma.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
}

async function contextoDeLaConexion(cliente: Pick<typeof prisma, "$queryRaw">) {
  const [fila] = await cliente.$queryRaw<Array<{ valor: string | null }>>`SELECT current_setting('app.empresa_id', true) AS valor`;
  return fila.valor;
}

describe("dbDeEmpresa / transaccionDeEmpresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    await crearEmpresa("norte");
  });

  it("una operación de modelo sin empresaId queda en la empresa del cliente (el default lee el contexto)", async () => {
    const creada = await dbDeEmpresa("norte").sucursal.create({ data: { nombre: "Sucursal Norte" } });
    expect(creada.empresaId).toBe("norte");
    const otra = await dbDeEmpresa("empresa_principal").sucursal.create({ data: { nombre: "Sucursal Principal 2" } });
    expect(otra.empresaId).toBe("empresa_principal");
  });

  it("una consulta cruda y un INSERT crudo también llevan el contexto", async () => {
    const db = dbDeEmpresa("norte");
    expect(await contextoDeLaConexion(db)).toBe("norte");
    await db.$executeRaw`INSERT INTO "Sucursal" (id, nombre) VALUES ('suc-cruda', 'Cruda')`;
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: "suc-cruda" } })).empresaId).toBe("norte");
  });

  it("sin contexto, con dos empresas activas, un alta sin empresaId falla (el sentido seguro)", async () => {
    await expect(prisma.sucursal.create({ data: { nombre: "Huerfana" } })).rejects.toThrow();
  });

  it("no filtra el contexto a otros pedidos: ninguna conexión del pool queda con app.empresa_id", async () => {
    const db = dbDeEmpresa("norte");
    await Promise.all(Array.from({ length: 12 }, (_, i) => db.sucursal.create({ data: { nombre: `S${i}` } })));
    await transaccionDeEmpresa("norte", async (tx) => tx.sucursal.create({ data: { nombre: "T" } }));
    const lecturas = await Promise.all(Array.from({ length: 12 }, () => contextoDeLaConexion(prisma)));
    expect(lecturas.every((valor) => !valor)).toBe(true);
  });

  it("transaccionDeEmpresa fija el contexto antes de cualquier consulta, para todas las de la transacción", async () => {
    const dentro = await transaccionDeEmpresa("norte", async (tx) => {
      const primera = await tx.sucursal.create({ data: { nombre: "Uno" } });
      const segunda = await tx.sucursal.create({ data: { nombre: "Dos" } });
      return { primera, segunda, contexto: await contextoDeLaConexion(tx) };
    });
    expect(dentro.contexto).toBe("norte");
    expect(dentro.primera.empresaId).toBe("norte");
    expect(dentro.segunda.empresaId).toBe("norte");
  });

  it("transaccionDeEmpresa revierte todo si falla, y acepta opciones", async () => {
    await expect(
      transaccionDeEmpresa(
        "norte",
        async (tx) => {
          await tx.sucursal.create({ data: { id: "revertida", nombre: "R" } });
          throw new Error("falla");
        },
        { timeout: 5000 }
      )
    ).rejects.toThrow("falla");
    expect(await prisma.sucursal.findUnique({ where: { id: "revertida" } })).toBeNull();
  });

  it("baseDeEmpresa arma db y transaccion de la MISMA empresa", async () => {
    const base = baseDeEmpresa("norte");
    expect((await base.db.sucursal.create({ data: { nombre: "Por db" } })).empresaId).toBe("norte");
    const porTransaccion = await base.transaccion((tx) => tx.sucursal.create({ data: { nombre: "Por transaccion" } }));
    expect(porTransaccion.empresaId).toBe("norte");
  });
});

describe("verificarRolDeEjecucion", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
  });

  it("el rol de ejecución real (motor2_app) pasa con una o con dos empresas activas", async () => {
    await expect(verificarRolDeEjecucion(prisma)).resolves.toBeUndefined();
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prisma)).resolves.toBeUndefined();
  });

  it("un rol dueño de las tablas se tolera con UNA empresa activa y se niega con más de una", async () => {
    expect((await datosDelRolDeEjecucion(prismaAdmin)).duenio).toBe(true);
    await expect(verificarRolDeEjecucion(prismaAdmin)).resolves.toBeUndefined();
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prismaAdmin)).rejects.toThrow(/no queda aislado por empresa/);
  });

  it("superusuario y BYPASSRLS también se niegan con más de una empresa; una empresa suspendida no cuenta", async () => {
    await crearEmpresa("norte");
    const base = { usuario: "x", superusuario: false, bypassRls: false, duenio: false };
    await expect(verificarRolDeEjecucion(prisma, { ...base, superusuario: true })).rejects.toThrow(/superusuario/);
    await expect(verificarRolDeEjecucion(prisma, { ...base, bypassRls: true })).rejects.toThrow(/BYPASSRLS/);
    await prisma.empresa.update({ where: { id: "norte" }, data: { estado: "SUSPENDED" } });
    await expect(verificarRolDeEjecucion(prisma, { ...base, superusuario: true })).resolves.toBeUndefined();
  });
});
