import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Invariantes de la base del módulo POS (migración pos_mesas_cuentas): el número de mesa es único por sucursal, y una mesa tiene a
 * lo sumo UNA cuenta abierta (`cerradaEn` null) — índice único parcial manual "Cuenta_una_abierta_por_mesa_key", que Prisma no
 * declara en schema.prisma. El estado de la mesa se deriva de esa cuenta: dos abiertas a la vez lo harían ambiguo.
 */
function codigoDeError(e: unknown): string | undefined {
  return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
}

describe("POS: una sola cuenta abierta por mesa y número único por sucursal", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let usuarioId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await prisma.user.create({ data: { email: "mozo@test.com" } })).id;
  });

  it("una segunda cuenta abierta en la misma mesa choca contra el índice (P2002)", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } });

    const segunda = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } }).catch((e: unknown) => e);
    expect(codigoDeError(segunda)).toBe("P2002");
    expect(await prisma.cuenta.count({ where: { mesaId: mesa.id } })).toBe(1);
  });

  it("cerrada la primera, se puede abrir otra; las cerradas no cuentan", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const primera = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } });
    await prisma.cuenta.update({ where: { id: primera.id }, data: { cerradaEn: new Date() } });

    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } });
    // Y otra cerrada más, directamente: el historial de cuentas cerradas no tiene límite.
    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId, cerradaEn: new Date() } });

    expect(await prisma.cuenta.count({ where: { mesaId: mesa.id } })).toBe(3);
    expect(await prisma.cuenta.count({ where: { mesaId: mesa.id, cerradaEn: null } })).toBe(1);
  });

  it("dos mesas distintas pueden tener cada una su cuenta abierta", async () => {
    const [m1, m2] = await Promise.all([prisma.mesa.create({ data: { sucursalId, numero: 1 } }), prisma.mesa.create({ data: { sucursalId, numero: 2 } })]);
    await prisma.cuenta.create({ data: { mesaId: m1.id, abiertaPorId: usuarioId } });
    await prisma.cuenta.create({ data: { mesaId: m2.id, abiertaPorId: usuarioId } });
    expect(await prisma.cuenta.count({ where: { cerradaEn: null } })).toBe(2);
  });

  it("el mismo número de mesa en la misma sucursal choca (P2002); en otra sucursal está permitido", async () => {
    await prisma.mesa.create({ data: { sucursalId, numero: 7 } });

    const repetida = await prisma.mesa.create({ data: { sucursalId, numero: 7 } }).catch((e: unknown) => e);
    expect(codigoDeError(repetida)).toBe("P2002");

    await prisma.mesa.create({ data: { sucursalId: otraSucursalId, numero: 7 } });
    expect(await prisma.mesa.count({ where: { numero: 7 } })).toBe(2);
  });
});
