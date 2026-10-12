import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { disponibilidadPorSucursalDeProducto } from "../../src/server/consultas/catalogo/disponibilidad";

/**
 * Plan M.3 §9 (paquete 1): la tabla «Disponibilidad por sucursal» de la ficha del producto (`app/(app)/catalogo/productos/[id]/page.tsx`) lee con `ctx.db`, o sea con el alcance de la sucursal ACTIVA.
 * `Sucursal` es de gobierno (se listan todas las activas, por nombre), pero `DisponibilidadProducto` es por sucursal: con las políticas de la RLS por sucursal la ficha trae la fila REAL solo de las
 * sucursales del alcance, y las demás salen sin fila visible, o sea «No». Este test fija ese comportamiento (el declarado como esperado en el plan) en las dos bases:
 *  - con alcance en A y B: el estado real de las dos, con o sin políticas;
 *  - con alcance solo en A: A es real; B figura en la lista pero con el estado de «sin fila visible» (`false`) cuando hay políticas, y con el real cuando no las hay;
 *  - sin alcance (la base de login/elegir empresa): con políticas ninguna fila es visible, pero la ficha no rompe y lista las sucursales.
 * Detecta si la base tiene las políticas (la de CI de hoy no; después del paquete, sí).
 */
describe("la ficha del producto: disponibilidad por sucursal bajo el alcance de la base", () => {
  let A: string;
  let B: string;
  let enLasDos: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    A = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    B = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    enLasDos = (await prisma.producto.create({ data: { codigo: "ALC_AB", nombre: "En las dos", tipo: "MP", unidadStockId: kg.id } })).id;
    await prisma.disponibilidadProducto.createMany({ data: [A, B].map((sucursalId) => ({ sucursalId, productoId: enLasDos, disponible: true })) });
  });

  async function hayPoliticasDeSucursal(): Promise<boolean> {
    const [fila] = await prismaAdmin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_policies WHERE policyname = 'alcance_sucursal_select' AND tablename = 'DisponibilidadProducto'`;
    return Number(fila.n) > 0;
  }

  const estado = (filas: { sucursalId: string; sucursalNombre: string; disponible: boolean }[]) => filas.map((f) => [f.sucursalNombre, f.disponible]);

  it("con lectura en A y B (lo que ensancha un lector de varias sucursales) trae el estado real de las dos", async () => {
    const db = baseDeTest({ lectura: [A, B], escritura: [A] }).db;
    expect(estado(await disponibilidadPorSucursalDeProducto(enLasDos, db))).toEqual([["Sucursal A", true], ["Sucursal B", true]]);
  });

  it("con el alcance de la sucursal activa (lo que usa la ficha): A es real y B figura en la lista, pero solo con su estado real si la base no tiene políticas", async () => {
    const conPoliticas = await hayPoliticasDeSucursal();
    const db = baseDeTest({ lectura: [A], escritura: [A] }).db;
    expect(estado(await disponibilidadPorSucursalDeProducto(enLasDos, db))).toEqual([["Sucursal A", true], ["Sucursal B", !conPoliticas]]);
  });

  it("sin alcance no rompe: lista las sucursales, y con políticas ninguna fila es visible", async () => {
    const conPoliticas = await hayPoliticasDeSucursal();
    const filas = await disponibilidadPorSucursalDeProducto(enLasDos, baseDeTest().db);
    expect(estado(filas)).toEqual([["Sucursal A", !conPoliticas], ["Sucursal B", !conPoliticas]]);
  });
});
