import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Esquema de la migración M2 (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 6): `PromoCuenta` es la instancia de una
 * promo armable agregada a una cuenta, análoga a `Cliente` en `Cuenta`. `CuentaItem.promoCuentaId`/`precioCartaUnitario` y
 * `Operacion.promoCuentaId` son ADITIVOS y opcionales (una fila sin ellos sigue siendo válida, el caso de siempre); las tres
 * referencias nuevas son RESTRICT, mismo criterio que el resto de las referencias históricas del proyecto (`clienteId`, etc.).
 */
describe("POS: esquema de PromoCuenta (Task #16, migración M2)", () => {
  let sucursalId: string;
  let usuarioId: string;
  let cuentaId: string;
  let productoId: string;
  let promoCartaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    usuarioId = (await prisma.user.create({ data: { email: "mozo@test.com" } })).id;
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    productoId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Empanada", tipo: "PV", unidadStockId: unidad.id, precioVenta: 500 } })).id;
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    cuentaId = (await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } })).id;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: "Menú del día", precio: 2000 } })).id;
  });

  const crearPromoCuenta = () => prisma.promoCuenta.create({ data: { cuentaId, promoCartaId, precio: 2000, titulo: "Menú del día", creadoPorId: usuarioId } });

  it("una fila sin ninguno de los campos nuevos de CuentaItem/Operacion sigue siendo válida (aditivo)", async () => {
    const item = await prisma.cuentaItem.create({ data: { cuentaId, productoId, cantidad: 1, precioUnitario: 500 } });
    expect(item).toMatchObject({ promoCuentaId: null, precioCartaUnitario: null });
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId } });
    expect(operacion.promoCuentaId).toBeNull();
  });

  it("congela precio y título, distintos del actual de PromoCarta si cambia después", async () => {
    const promoCuenta = await crearPromoCuenta();
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { titulo: "Menú ejecutivo", precio: 2500 } });
    const releída = await prisma.promoCuenta.findUniqueOrThrow({ where: { id: promoCuenta.id } });
    expect(releída).toMatchObject({ titulo: "Menú del día" });
    expect(Number(releída.precio)).toBe(2000);
  });

  it("un CuentaItem componente enlaza su promoCuentaId y su precioCartaUnitario", async () => {
    const promoCuenta = await crearPromoCuenta();
    const item = await prisma.cuentaItem.create({
      data: { cuentaId, productoId, cantidad: 1, precioUnitario: 500, promoCuentaId: promoCuenta.id, precioCartaUnitario: 500 },
    });
    expect(item).toMatchObject({ promoCuentaId: promoCuenta.id });
    expect(Number(item.precioCartaUnitario)).toBe(500);
    const conItems = await prisma.promoCuenta.findUniqueOrThrow({ where: { id: promoCuenta.id }, include: { items: true } });
    expect(conItems.items.map((i) => i.id)).toEqual([item.id]);
  });

  it("dos instancias de la MISMA promo en la misma cuenta son filas separadas (dos menús con elecciones distintas)", async () => {
    const a = await crearPromoCuenta();
    const b = await crearPromoCuenta();
    expect(a.id).not.toBe(b.id);
    expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(2);
  });

  it("borrar una PromoCuenta con un CuentaItem enlazado falla (RESTRICT) y no borra nada", async () => {
    const promoCuenta = await crearPromoCuenta();
    await prisma.cuentaItem.create({ data: { cuentaId, productoId, cantidad: 1, precioUnitario: 500, promoCuentaId: promoCuenta.id } });
    await expect(prisma.promoCuenta.delete({ where: { id: promoCuenta.id } })).rejects.toThrow();
    expect(await prisma.promoCuenta.count({ where: { id: promoCuenta.id } })).toBe(1);
  });

  // ADR-007 (A2): la FK pasó a compuesta [empresaId, promoCuentaId] y Prisma ya no puede generar SET NULL (empresaId es NOT NULL):
  // la referencia es RESTRICT de verdad. Se exige el código de FK (P2003) y que la Operacion conserve su promoCuentaId, para que un
  // ON DELETE SET NULL (que fallaría por otro motivo, un NOT NULL) o un CASCADE no pasen por un simple "rechaza".
  it("borrar una PromoCuenta con una Operacion enlazada falla por la FK (RESTRICT, P2003) y la Operacion conserva su promoCuentaId", async () => {
    const promoCuenta = await crearPromoCuenta();
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId, promoCuentaId: promoCuenta.id } });
    const error = await prisma.promoCuenta.delete({ where: { id: promoCuenta.id } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
    expect(await prisma.promoCuenta.count({ where: { id: promoCuenta.id } })).toBe(1);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: operacion.id } })).promoCuentaId).toBe(promoCuenta.id);
  });

  it("borrar la Cuenta de una PromoCuenta falla (RESTRICT)", async () => {
    await crearPromoCuenta();
    await expect(prisma.cuenta.delete({ where: { id: cuentaId } })).rejects.toThrow();
    expect(await prisma.cuenta.count({ where: { id: cuentaId } })).toBe(1);
  });

  it("borrar la PromoCarta de una PromoCuenta falla (RESTRICT), aunque la promo ya esté apagada", async () => {
    await crearPromoCuenta();
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa: false } });
    await expect(prisma.promoCarta.delete({ where: { id: promoCartaId } })).rejects.toThrow();
  });
});
