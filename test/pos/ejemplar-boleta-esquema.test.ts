import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Esquema de la numeración de la boleta (migración pos_numeracion_boleta, docs/plan-numeracion-boleta-2026-09-25.md, paso 2): cada fila
 * de `EjemplarBoleta` es un papel impreso. Las unicidades garantizan que un número/ejemplar no se repita en la sucursal (en otra sí) y
 * las dos referencias que protegen la historia son RESTRICT: ni la cuenta ni el ejemplar A corregido se pueden borrar.
 */
describe("POS: esquema de EjemplarBoleta", () => {
  let sucursalId: string;
  let usuarioId: string;
  let mesaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    usuarioId = (await prisma.user.create({ data: { email: "cajero@test.com" } })).id;
    mesaId = (await prisma.mesa.create({ data: { sucursalId, numero: 1 } })).id;
  });

  const nuevaCuenta = async (mesa = mesaId) => (await prisma.cuenta.create({ data: { mesaId: mesa, abiertaPorId: usuarioId, cerradaEn: new Date(), cerradaPorId: usuarioId } })).id;

  it("el ejemplar vale 1 (A) por defecto y la corrección queda en null", async () => {
    const ejemplar = await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: await nuevaCuenta(), numero: 1, emitidoPorId: usuarioId } });
    expect(ejemplar).toMatchObject({ numero: 1, ejemplar: 1, corrigeAId: null, motivo: null });
    expect(ejemplar.emitidoEn).toBeInstanceOf(Date);
  });

  it("rechaza el mismo (sucursal, número, ejemplar) repetido", async () => {
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: await nuevaCuenta(), numero: 7, ejemplar: 1, emitidoPorId: usuarioId } });
    const otraCuenta = await nuevaCuenta();
    await expect(prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: otraCuenta, numero: 7, ejemplar: 1, emitidoPorId: usuarioId } })).rejects.toThrow();
    expect(await prisma.ejemplarBoleta.count()).toBe(1);
  });

  it("rechaza dos ejemplares iguales de la misma cuenta", async () => {
    const cuentaId = await nuevaCuenta();
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId, numero: 1, emitidoPorId: usuarioId } });
    await expect(prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId, numero: 2, emitidoPorId: usuarioId } })).rejects.toThrow();
  });

  it("el mismo número en OTRA sucursal se acepta (la numeración es por sucursal)", async () => {
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: await nuevaCuenta(), numero: 1, emitidoPorId: usuarioId } });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    await prisma.ejemplarBoleta.create({ data: { sucursalId: norte.id, cuentaId: await nuevaCuenta(mesaNorte.id), numero: 1, emitidoPorId: usuarioId } });
    expect(await prisma.ejemplarBoleta.count({ where: { numero: 1 } })).toBe(2);
  });

  it("borrar una Cuenta con un ejemplar emitido falla (RESTRICT) y no borra nada", async () => {
    const cuentaId = await nuevaCuenta();
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId, numero: 1, emitidoPorId: usuarioId } });
    await expect(prisma.cuenta.delete({ where: { id: cuentaId } })).rejects.toThrow();
    expect(await prisma.cuenta.count({ where: { id: cuentaId } })).toBe(1);
    expect(await prisma.ejemplarBoleta.count({ where: { cuentaId } })).toBe(1);
  });

  it("borrar un ejemplar A que tiene una corrección falla (RESTRICT); la corrección queda enlazada a su A", async () => {
    const cuentaId = await nuevaCuenta();
    const a = await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId, numero: 1, emitidoPorId: usuarioId } });
    const b = await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId, numero: 1, ejemplar: 2, corrigeAId: a.id, motivo: "Se anuló el flan", emitidoPorId: usuarioId } });

    await expect(prisma.ejemplarBoleta.delete({ where: { id: a.id } })).rejects.toThrow();
    expect(await prisma.ejemplarBoleta.count({ where: { cuentaId } })).toBe(2);
    const conCorrecciones = await prisma.ejemplarBoleta.findUniqueOrThrow({ where: { id: a.id }, include: { correcciones: true } });
    expect(conCorrecciones.correcciones.map((c) => c.id)).toEqual([b.id]);
  });
});
