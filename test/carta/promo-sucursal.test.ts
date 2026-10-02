import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { precioDePromo, seleccionDeSucursalDePromo, wherePromoOfrecidaEn } from "../../src/core/carta/promo-sucursal";

/**
 * CARACTERIZACIÓN de la semántica de "sin fila" de `PromoCartaSucursal` (ADR-009, familia opt-in): una promo es de la empresa y UNA sucursal
 * la ofrece solo si tiene una fila ACTIVA ahí. Sin fila = no se ofrece. El precio local de la fila es opcional: sin precio local rige el de
 * la empresa.
 */
describe("promo por sucursal: sin fila = no se ofrece; precioLocal null = precio de la empresa", () => {
  let sucursalA: string;
  let sucursalB: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Promos", orden: 1 } })).id;
  });

  const promo = (titulo: string, sucursales: { sucursalId: string; activa?: boolean; precioLocal?: number }[], activa = true) =>
    prisma.promoCarta.create({ data: { seccionCartaId: seccionId, titulo, precio: 25000, activa, sucursales: { create: sucursales } } });
  const titulosOfrecidos = async (sucursalId: string) =>
    (await prisma.promoCarta.findMany({ where: wherePromoOfrecidaEn(sucursalId), orderBy: { titulo: "asc" } })).map((p) => p.titulo);

  it("una promo sin ninguna fila de sucursal no se ofrece en ninguna", async () => {
    await promo("Sin filas", []);
    expect(await titulosOfrecidos(sucursalA)).toEqual([]);
    expect(await titulosOfrecidos(sucursalB)).toEqual([]);
  });

  it("una promo con fila solo en A se ofrece en A y NO en B (sin fila en B)", async () => {
    await promo("Solo A", [{ sucursalId: sucursalA }]);
    expect(await titulosOfrecidos(sucursalA)).toEqual(["Solo A"]);
    expect(await titulosOfrecidos(sucursalB)).toEqual([]);
  });

  it("una fila apagada (activa=false) equivale a no tener fila; una promo inactiva no se ofrece aunque tenga fila activa", async () => {
    await promo("Apagada en A", [{ sucursalId: sucursalA, activa: false }]);
    await promo("Inactiva", [{ sucursalId: sucursalA }], false);
    expect(await titulosOfrecidos(sucursalA)).toEqual([]);
  });

  it("precioLocal null (o sin fila) = precio de la empresa; con precioLocal rige el local, solo en esa sucursal", async () => {
    const creada = await promo("Con local en A", [{ sucursalId: sucursalA, precioLocal: 22000 }, { sucursalId: sucursalB }]);
    const conFilas = await prisma.promoCarta.findUniqueOrThrow({
      where: { id: creada.id },
      select: { precio: true, sucursales: seleccionDeSucursalDePromo(sucursalA) },
    });
    const enB = await prisma.promoCarta.findUniqueOrThrow({
      where: { id: creada.id },
      select: { precio: true, sucursales: seleccionDeSucursalDePromo(sucursalB) },
    });
    expect(precioDePromo(conFilas.precio, conFilas.sucursales[0], true)).toBe(22000);
    expect(precioDePromo(enB.precio, enB.sucursales[0], true)).toBe(25000);
    expect(precioDePromo(conFilas.precio, undefined, true)).toBe(25000);
  });

  it("R1: con la capacidad precio_local apagada, el precioLocal de la fila no rige: se cobra el de la empresa (la fila no se borra)", async () => {
    const creada = await promo("Con local en A", [{ sucursalId: sucursalA, precioLocal: 22000 }]);
    const enA = await prisma.promoCarta.findUniqueOrThrow({ where: { id: creada.id }, select: { precio: true, sucursales: seleccionDeSucursalDePromo(sucursalA) } });
    expect(precioDePromo(enA.precio, enA.sucursales[0], false)).toBe(25000);
    expect(precioDePromo(enA.precio, enA.sucursales[0], true)).toBe(22000);
  });
});
