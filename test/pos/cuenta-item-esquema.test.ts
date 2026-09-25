import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Esquema de «tomar pedido» (migración pos_tomar_pedido, docs/plan-tomar-pedido-2026-09-25.md, paso 1): los campos nuevos de
 * `CuentaItem` son aditivos y opcionales, y las dos referencias que protegen la historia son RESTRICT — un ítem original con una
 * fila espejo (anulación) no se puede borrar, y una Operacion VENTA enlazada a ítems de cuenta tampoco.
 */
describe("POS: esquema de CuentaItem para tomar pedido", () => {
  let cuentaId: string;
  let productoId: string;
  let usuarioId: string;
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    usuarioId = (await prisma.user.create({ data: { email: "mozo@test.com" } })).id;
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    productoId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Milanesa", tipo: "PV", unidadStockId: unidad.id, precioVenta: 9000 } })).id;
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    cuentaId = (await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } })).id;
  });

  it("una fila sin ninguno de los campos nuevos sigue siendo válida (filas anteriores a tomar pedido)", async () => {
    const item = await prisma.cuentaItem.create({ data: { cuentaId, productoId, cantidad: 2, precioUnitario: 9000 } });
    expect(item).toMatchObject({ creadoPorId: null, anulaAItemId: null, motivoAnulacion: null, operacionId: null, numeroEnvio: null });
    const cuenta = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } });
    expect(cuenta.cerradaPorId).toBeNull();
  });

  it("borrar un ítem original que tiene una fila espejo falla (RESTRICT) y no borra nada", async () => {
    const original = await prisma.cuentaItem.create({ data: { cuentaId, productoId, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: usuarioId } });
    await prisma.cuentaItem.create({
      data: { cuentaId, productoId, cantidad: -1, precioUnitario: 9000, numeroEnvio: 1, anulaAItemId: original.id, motivoAnulacion: "Se equivocó de plato", creadoPorId: usuarioId },
    });

    await expect(prisma.cuentaItem.delete({ where: { id: original.id } })).rejects.toThrow();
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
    const conAnulaciones = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: original.id }, include: { anulaciones: true } });
    expect(conAnulaciones.anulaciones.map((a) => Number(a.cantidad))).toEqual([-1]);
  });

  it("borrar una Operacion enlazada a ítems de cuenta falla (RESTRICT)", async () => {
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId } });
    await prisma.cuentaItem.create({ data: { cuentaId, productoId, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, operacionId: operacion.id } });

    await expect(prisma.operacion.delete({ where: { id: operacion.id } })).rejects.toThrow();
    expect(await prisma.operacion.count({ where: { id: operacion.id } })).toBe(1);
    const enlazados = await prisma.operacion.findUniqueOrThrow({ where: { id: operacion.id }, include: { cuentaItems: true } });
    expect(enlazados.cuentaItems).toHaveLength(1);
  });

  it("quién cerró la cuenta queda enlazado al usuario", async () => {
    await prisma.cuenta.update({ where: { id: cuentaId }, data: { cerradaEn: new Date(), cerradaPorId: usuarioId } });
    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: usuarioId }, include: { cuentasCerradas: true } });
    expect(usuario.cuentasCerradas.map((c) => c.id)).toEqual([cuentaId]);
  });
});
