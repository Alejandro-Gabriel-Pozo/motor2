import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, sembrarBase, prisma, prismaAdmin, prismaSinEmpresa, prismaDuenioSinEmpresa } from "../setup/test-db";
import { baseDeEmpresa, dbDeEmpresa, transaccionDeEmpresa } from "../../src/core/auth/base";
import { verificarRolDeEjecucion, datosDelRolDeEjecucion } from "../../src/core/auth/rol-de-ejecucion";
import { reportarErrorUnaVez } from "../../src/lib/reportar-error";

/**
 * ADR-007, A5: cada operación del contexto de un usuario corre con `app.empresa_id` fijado (local a su transacción). Se prueba con DOS
 * empresas ACTIVE, donde el default de `empresaId` (`app_empresa_actual()`) es NULL salvo que haya contexto: si una fila queda en la
 * empresa correcta sin decir `empresaId`, es porque el contexto llegó a la consulta.
 */
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez: vi.fn(async () => undefined), reportarError: vi.fn(async () => undefined) }));
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
    await expect(prismaSinEmpresa.sucursal.create({ data: { nombre: "Huerfana" } })).rejects.toThrow();
  });

  it("no filtra el contexto a otros pedidos: ninguna conexión del pool queda con app.empresa_id", async () => {
    const db = dbDeEmpresa("norte");
    await Promise.all(Array.from({ length: 12 }, (_, i) => db.sucursal.create({ data: { nombre: `S${i}` } })));
    await transaccionDeEmpresa("norte", async (tx) => tx.sucursal.create({ data: { nombre: "T" } }));
    const lecturas = await Promise.all(Array.from({ length: 12 }, () => contextoDeLaConexion(prismaSinEmpresa)));
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

describe("verificarRolDeEjecucion (ADR-022: estricto siempre, sin «una sola empresa» que lo disculpe)", () => {
  const base = { usuario: "x", superusuario: false, bypassRls: false, duenio: false, contextoPreseteado: false };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
  });

  it("el rol de ejecución real (motor2_app, sin contexto) pasa con una o con dos empresas activas", async () => {
    await expect(verificarRolDeEjecucion(prismaSinEmpresa)).resolves.toBeUndefined();
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prismaSinEmpresa)).resolves.toBeUndefined();
  });

  it("un rol dueño de las tablas se niega SIEMPRE: con una empresa, con dos o con cien", async () => {
    expect((await datosDelRolDeEjecucion(prismaDuenioSinEmpresa)).duenio).toBe(true);
    await expect(verificarRolDeEjecucion(prismaDuenioSinEmpresa)).rejects.toThrow(/no queda aislado por empresa/);
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prismaDuenioSinEmpresa)).rejects.toThrow(/no queda aislado por empresa/);
  });

  it("superusuario y BYPASSRLS también se niegan, cuente la empresa que cuente (activa, suspendida, en baja o en alta)", async () => {
    for (const estado of ["ACTIVE", "SUSPENDED", "DELETING", "PROVISIONING"] as const) {
      await crearEmpresa(`norte-${estado.toLowerCase()}`);
      await prisma.empresa.update({ where: { id: `norte-${estado.toLowerCase()}` }, data: { estado } });
      await expect(verificarRolDeEjecucion(prisma, { ...base, superusuario: true }), estado).rejects.toThrow(/superusuario/);
      await expect(verificarRolDeEjecucion(prisma, { ...base, bypassRls: true }), estado).rejects.toThrow(/BYPASSRLS/);
    }
  });

  it("MOTOR2_ROL_ESTRICTO=0 (permitirPrivilegiado) es el escape de las herramientas de demo: deja pasar un rol que salta el RLS, AVISA a Sentry, y el rol sin privilegios no avisa nada", async () => {
    vi.mocked(reportarErrorUnaVez).mockClear();
    await verificarRolDeEjecucion(prisma, base, true);
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
    await verificarRolDeEjecucion(prisma, { ...base, bypassRls: true }, true);
    expect(reportarErrorUnaVez).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportarErrorUnaVez).mock.calls[0][1]).toMatchObject({ message: expect.stringContaining("BYPASSRLS") });
  });

  it("una conexión que trae contexto preseteado (app.empresa_id, app.usuario_id o app.invitacion_hash) se niega SIN escape, aunque el rol no tenga privilegios", async () => {
    // `prisma` de las pruebas abre la conexión con app.empresa_id fijado: justo lo que ADR-022 prohíbe para el proceso real.
    expect((await datosDelRolDeEjecucion(prisma)).contextoPreseteado).toBe(true);
    expect((await datosDelRolDeEjecucion(prismaSinEmpresa)).contextoPreseteado).toBe(false);
    await expect(verificarRolDeEjecucion(prisma)).rejects.toThrow(/trae app\.empresa_id/);
    await expect(verificarRolDeEjecucion(prisma, undefined, true)).rejects.toThrow(/trae app\.empresa_id/);
    await expect(verificarRolDeEjecucion(prisma, { ...base, contextoPreseteado: true }, true)).rejects.toThrow(/preset/);
  });
});
