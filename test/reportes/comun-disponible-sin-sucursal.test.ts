import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, prisma } from "../setup/test-db";
import { construirMapaProductos } from "../../src/core/reportes/comun";
import { disponibilidadEnAlgunaSucursal } from "../../src/core/catalogo/public-servidor";

/**
 * R2 (decisión del dueño, 2026-10-01): `construirMapaProductos` SIN sucursal (reportes de Catálogo Central) deja `disponible` en
 * "disponible en ALGUNA sucursal" — antes era un `true` fijo. Con sucursal, sigue siendo el de ESA sucursal.
 */
describe("construirMapaProductos: `disponible` sin sucursal = disponible en alguna sucursal", () => {
  let sucA: string;
  let sucB: string;
  let enAmbas: string;
  let soloEnB: string;
  let apagadoEnTodas: string;
  let sinFilas: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const { sucursal } = await sembrarBase();
    const { kg, categoria } = await sembrarCatalogoBase();
    sucA = sucursal.id;
    sucB = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const crear = async (codigo: string) =>
      (await prisma.producto.create({ data: { codigo, nombre: codigo, tipo: "PV", unidadStockId: kg.id, categoriaId: categoria.id, precioVenta: 1000 } })).id;
    enAmbas = await crear("AMBAS");
    soloEnB = await crear("SOLO-B");
    apagadoEnTodas = await crear("APAGADO");
    sinFilas = await crear("SIN-FILAS");
    await prisma.disponibilidadProducto.createMany({
      data: [
        { sucursalId: sucA, productoId: enAmbas, disponible: true },
        { sucursalId: sucB, productoId: enAmbas, disponible: true },
        { sucursalId: sucB, productoId: soloEnB, disponible: true },
        { sucursalId: sucA, productoId: soloEnB, disponible: false },
        { sucursalId: sucA, productoId: apagadoEnTodas, disponible: false },
        { sucursalId: sucB, productoId: apagadoEnTodas, disponible: false },
      ],
    });
  });

  it("sin sucursal: true si alguna sucursal lo tiene disponible; false si está apagado en todas o no tiene filas", async () => {
    const mapa = await construirMapaProductos(undefined, prisma);
    expect(mapa.get(enAmbas)?.disponible).toBe(true);
    expect(mapa.get(soloEnB)?.disponible).toBe(true);
    expect(mapa.get(apagadoEnTodas)?.disponible).toBe(false);
    expect(mapa.get(sinFilas)?.disponible).toBe(false);
  });

  it("con sucursal: sigue siendo el de ESA sucursal", async () => {
    const enA = await construirMapaProductos(sucA, prisma);
    expect(enA.get(enAmbas)?.disponible).toBe(true);
    expect(enA.get(soloEnB)?.disponible).toBe(false);
    const enB = await construirMapaProductos(sucB, prisma);
    expect(enB.get(soloEnB)?.disponible).toBe(true);
  });

  it("disponibilidadEnAlgunaSucursal: lote vacío no consulta y devuelve un mapa vacío", async () => {
    expect((await disponibilidadEnAlgunaSucursal([], prisma)).size).toBe(0);
  });
});
