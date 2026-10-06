import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../setup/test-db";
import { datosDeAuditoria } from "../../plataforma/src/servidor/auditoria";

/**
 * `datosDeAuditoria` arma la fila de `AuditoriaPlataforma` sin claves `undefined`: Prisma 7 las rechaza (`explicitly undefined values are not allowed`) y por eso el ingreso
 * de la consola (acción `ingreso`, sin detalle) fallaba en el primer CI que la corrió. Se prueba con una creación real, sin y con detalle y empresa afectada.
 */
const AUTOR = { adminId: "admin-1", adminEmail: "admin@plataforma.test" };

beforeEach(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
});

afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$disconnect();
  await prisma.$disconnect();
});

describe("datosDeAuditoria", () => {
  it("sin detalle ni empresa no lleva esas claves (ni como undefined) y la fila se crea", async () => {
    const datos = datosDeAuditoria(AUTOR, "ingreso");
    expect(Object.keys(datos).sort()).toEqual(["accion", "adminEmail", "adminId"]);
    const fila = await prismaAdmin.auditoriaPlataforma.create({ data: datos });
    expect(fila).toMatchObject({ accion: "ingreso", detalle: null, empresaAfectadaId: null });
  });

  it("con detalle y empresa afectada los lleva", async () => {
    const datos = datosDeAuditoria(AUTOR, "empresa-suspendida", "empresa-x", { motivo: "prueba" });
    const fila = await prismaAdmin.auditoriaPlataforma.create({ data: datos });
    expect(fila).toMatchObject({ empresaAfectadaId: "empresa-x", detalle: { motivo: "prueba" } });
  });

  it("documenta la causa: el cliente rechaza un undefined explícito, que es justo lo que la función evita", async () => {
    await expect(prismaAdmin.auditoriaPlataforma.create({ data: { ...AUTOR, accion: "ingreso", detalle: undefined } })).rejects.toThrow(/undefined/);
  });
});
