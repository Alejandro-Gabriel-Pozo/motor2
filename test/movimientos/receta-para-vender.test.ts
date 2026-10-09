import { beforeEach, describe, expect, it } from "vitest";

import { limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { cargarRecetaVigenteParaVender } from "../../src/server/lecturas/movimientos/receta-para-vender";

/**
 * `cargarRecetaVigenteParaVender` (Hito 5, 5.1-2): la lectura de la receta vigente de un PV para venderlo en una sucursal, en números planos. Las matrices de la venta ya fijan lo que
 * ESCRIBE la venta con esa lectura; este test fija la lectura misma, a la vista, en lo que las matrices no pueden ver porque no cambia el resultado: que traiga SOLO las calibraciones
 * de la sucursal que vende (`rendimientosLocales: { where: { sucursalId } }`: `rendimientoEfectivo` ignora las ajenas, así que traerlas de más no cambia ni una fila, pero sí lo que
 * viaja por la red), el orden de los ingredientes (por id, no por inserción) y de los sustitutos (por `orden`), la conversión de cada `Decimal` a `number` y el `[]` del plato sin receta.
 */
describe("cargarRecetaVigenteParaVender: la receta de un PV en números planos, con las calibraciones de ESA sucursal", () => {
  let centralId: string;
  let norteId: string;
  let panId: string;
  let harinaId: string;
  let azucarId: string;
  let sustitutosEnOrden: string[];

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, centralId)).id;
    azucarId = (await sembrarProductoDisponible({ codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: kg.id }, centralId)).id;
    panId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, centralId)).id;
    const insumoA = await prisma.insumo.create({ data: { nombre: "Harina 000" } });
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina 0000" } });

    const version = await prisma.recetaVersion.create({ data: { productoId: panId, version: 1 } });
    // Se inserta primero «ing-2» y después «ing-1»: la lectura los devuelve por id.
    await prisma.recetaIngrediente.create({ data: { id: "ing-2", recetaVersionId: version.id, insumoProductoId: azucarId, cantidad: 0.3, unidadId: kg.id, mermaPorcentaje: 0 } });
    await prisma.recetaIngrediente.create({ data: { id: "ing-1", recetaVersionId: version.id, insumoProductoId: harinaId, cantidad: 0.5, unidadId: kg.id, mermaPorcentaje: 10 } });
    // Los sustitutos de «ing-1» se insertan al revés de su `orden`.
    await prisma.sustitutoRecetaIngrediente.create({ data: { recetaIngredienteId: "ing-1", insumoSustitutoId: insumoB.id, orden: 2 } });
    await prisma.sustitutoRecetaIngrediente.create({ data: { recetaIngredienteId: "ing-1", insumoSustitutoId: insumoA.id, orden: 1 } });
    sustitutosEnOrden = [insumoA.id, insumoB.id];
    // Central calibró la harina (cantidad 0,45 y merma sin tocar); Norte, otra distinta (0,4 y 5 %).
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: "ing-1", sucursalId: centralId, cantidad: 0.45, mermaPorcentaje: null } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: "ing-1", sucursalId: norteId, cantidad: 0.4, mermaPorcentaje: 5 } });
  });

  it("devuelve los ingredientes por id, con Number() hecho, los sustitutos por orden y SOLO las calibraciones de la sucursal pedida", async () => {
    const deCentral = await prisma.$transaction((tx) => cargarRecetaVigenteParaVender(tx, { productoId: panId, sucursalId: centralId }));
    expect(deCentral).toEqual([
      { insumoProductoId: harinaId, cantidad: 0.5, mermaPorcentaje: 10, rendimientosLocales: [{ sucursalId: centralId, cantidad: 0.45, mermaPorcentaje: null }], insumoSustitutoIds: sustitutosEnOrden },
      { insumoProductoId: azucarId, cantidad: 0.3, mermaPorcentaje: 0, rendimientosLocales: [], insumoSustitutoIds: [] },
    ]);
    // Los valores son `number` (no `Decimal`): la conversión se hace en el borde de la lectura.
    expect(typeof deCentral[0]!.cantidad).toBe("number");
    expect(typeof deCentral[0]!.rendimientosLocales[0]!.cantidad).toBe("number");

    const deNorte = await prisma.$transaction((tx) => cargarRecetaVigenteParaVender(tx, { productoId: panId, sucursalId: norteId }));
    expect(deNorte.map((i) => i.rendimientosLocales)).toEqual([[{ sucursalId: norteId, cantidad: 0.4, mermaPorcentaje: 5 }], []]);
  });

  it("un plato sin receta devuelve una lista vacía", async () => {
    const sinReceta = await sembrarProductoDisponible({ codigo: "PV_SIN_RECETA", nombre: "Sin receta", tipo: "PV", unidadStockId: (await prisma.unidad.findFirstOrThrow()).id, precioVenta: 100 }, centralId);
    expect(await prisma.$transaction((tx) => cargarRecetaVigenteParaVender(tx, { productoId: sinReceta.id, sucursalId: centralId }))).toEqual([]);
  });
});
