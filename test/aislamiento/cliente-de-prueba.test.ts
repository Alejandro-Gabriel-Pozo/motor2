import { afterAll, describe, expect, it } from "vitest";
import { prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";

/**
 * Los clientes de las pruebas (ADR-022): `prisma` y `prismaAdmin` abren la conexión con la empresa de prueba fijada; `prismaSinEmpresa` es el del proceso, sin contexto
 * (el que usa `src/`). Una transacción que fija otra empresa la pisa solo mientras dura.
 */
afterAll(() => prismaAdmin.$disconnect());

const empresaDeLaConexion = async (cliente: typeof prisma) => (await cliente.$queryRaw<Array<{ e: string | null }>>`SELECT NULLIF(current_setting('app.empresa_id', true), '') AS e`)[0].e;

describe("clientes de las pruebas", () => {
  it("prisma y prismaAdmin traen la empresa de prueba desde que abren la conexión", async () => {
    expect(await empresaDeLaConexion(prisma)).toBe(EMPRESA_DE_PRUEBA_ID);
    expect(await empresaDeLaConexion(prismaAdmin)).toBe(EMPRESA_DE_PRUEBA_ID);
  });

  it("prismaSinEmpresa no trae ninguna: es el cliente del proceso, sin contexto", async () => {
    expect(await empresaDeLaConexion(prismaSinEmpresa)).toBeNull();
  });

  it("una transacción que fija otra empresa la pisa mientras dura, y al terminar vuelve la de prueba", async () => {
    const dentro = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', 'otra', true)`;
      return (await tx.$queryRaw<Array<{ e: string }>>`SELECT current_setting('app.empresa_id', true) AS e`)[0].e;
    });
    expect(dentro).toBe("otra");
    expect(await empresaDeLaConexion(prisma)).toBe(EMPRESA_DE_PRUEBA_ID);
  });
});
