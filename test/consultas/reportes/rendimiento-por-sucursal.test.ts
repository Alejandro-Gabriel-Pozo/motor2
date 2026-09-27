import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, prisma } from "../../setup/test-db";
import { compararRendimientosPorSucursal } from "../../../src/core/reportes/rendimiento-por-sucursal";
import { compararRendimientosDeSucursales } from "../../../src/server/consultas/reportes/rendimiento-por-sucursal";

/**
 * `src/server/consultas/reportes/rendimiento-por-sucursal.ts` (Task #41, Fase D7) contra Postgres real.
 *
 * Es un envoltorio fino de `compararRendimientosPorSucursal` (core/reportes, cubierta en detalle por
 * test/reportes/rendimiento-por-sucursal.test.ts): acá se fija que DELEGA sin cambiar nada — mismas sucursales, mismo
 * filtro, mismo resultado — y que el `db` por defecto es el singleton `prisma` (o el `tx` que se le pase).
 */
describe("server/consultas/reportes/rendimiento-por-sucursal", () => {
  let central: { id: string; nombre: string };
  let norte: { id: string; nombre: string };
  let fuera: { id: string; nombre: string };
  let pan: { id: string; nombre: string };
  let tarta: { id: string; nombre: string };
  let lineaPanHarina: string;
  let lineaTartaHarina: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    central = { id: base.sucursal.id, nombre: base.sucursal.nombre };
    norte = await prisma.sucursal.create({ data: { nombre: "Norte" }, select: { id: true, nombre: true } });
    fuera = await prisma.sucursal.create({ data: { nombre: "Fuera de membresía" }, select: { id: true, nombre: true } });
    const { kg } = await sembrarCatalogoBase();

    const harina = await sembrarProductoDisponible({ codigo: "MP_D7_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, central.id);
    pan = await sembrarProductoDisponible({ codigo: "PV_D7_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, central.id);
    tarta = await sembrarProductoDisponible({ codigo: "PV_D7_TARTA", nombre: "Tarta", tipo: "PV", unidadStockId: kg.id, precioVenta: 300 }, central.id);

    // Pan: v1 (vieja) y v2 (vigente) — solo la vigente debe aparecer.
    await prisma.recetaVersion.create({
      data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 5, mermaPorcentaje: 0, unidadId: kg.id }] } },
    });
    const panV2 = await prisma.recetaVersion.create({
      data: { productoId: pan.id, version: 2, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 1, mermaPorcentaje: 25, unidadId: kg.id }] } },
      include: { ingredientes: true },
    });
    lineaPanHarina = panV2.ingredientes[0].id;

    const tartaV1 = await prisma.recetaVersion.create({
      data: { productoId: tarta.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, mermaPorcentaje: 0, unidadId: kg.id }] } },
      include: { ingredientes: true },
    });
    lineaTartaHarina = tartaV1.ingredientes[0].id;

    // Calibraciones: Pan en Central (2 kg, 50 %) y en la sucursal FUERA de la lista; Tarta sin calibrar en ninguna.
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaPanHarina, sucursalId: central.id, cantidad: 2, mermaPorcentaje: 50 } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaPanHarina, sucursalId: fuera.id, cantidad: 99, mermaPorcentaje: 99 } });
  });

  it("delega: con los datos sembrados devuelve EXACTAMENTE lo mismo que la función de core con el mismo `db`", async () => {
    const sucursales = [central, norte];
    for (const filtro of [{}, { todas: true }, { productoId: tarta.id, todas: true }, { productoId: tarta.id }]) {
      const deConsulta = await compararRendimientosDeSucursales(sucursales, filtro);
      const deCore = await compararRendimientosPorSucursal(sucursales, filtro, prisma);
      expect(deConsulta).toEqual(deCore);
    }
  });

  it("sin filtro: solo la línea calibrada (Pan, receta vigente v2), con la columna de cada sucursal pedida y nada de la de afuera", async () => {
    const filas = await compararRendimientosDeSucursales([central, norte], {});

    expect(filas).toHaveLength(1);
    const [fila] = filas;
    expect(fila).toMatchObject({
      productoId: pan.id,
      productoNombre: "Pan",
      recetaIngredienteId: lineaPanHarina,
      insumoNombre: "Harina",
      unidadNombre: "kg",
      central: { cantidad: 1, mermaPorcentaje: 25, bruto: 1.25 },
      algunaCalibrada: true,
    });
    expect(Array.from(fila.porSucursal.keys())).toEqual([central.id, norte.id]);
    expect(fila.porSucursal.get(central.id)).toEqual({ cantidad: 2, mermaPorcentaje: 50, bruto: 3, calibrado: true, desviacionPorcentaje: 140 });
    expect(fila.porSucursal.get(norte.id)).toMatchObject({ cantidad: 1, mermaPorcentaje: 25, bruto: 1.25, calibrado: false, desviacionPorcentaje: 0 });
    expect(fila.porSucursal.has(fuera.id)).toBe(false);
  });

  it("pasa el filtro tal cual: `todas` suma la línea sin calibrar y `productoId` recorta a ese producto", async () => {
    const todas = await compararRendimientosDeSucursales([central, norte], { todas: true });
    expect(todas.map((f) => f.recetaIngredienteId)).toEqual([lineaPanHarina, lineaTartaHarina]);

    const soloTarta = await compararRendimientosDeSucursales([central, norte], { productoId: tarta.id, todas: true });
    expect(soloTarta.map((f) => f.productoId)).toEqual([tarta.id]);
    expect(soloTarta[0].algunaCalibrada).toBe(false);

    // Tarta sin `todas`: no tiene calibración en ninguna sucursal pedida → vacío.
    await expect(compararRendimientosDeSucursales([central, norte], { productoId: tarta.id })).resolves.toEqual([]);
  });

  it("pasa las sucursales tal cual: con solo Norte, la calibración de Central no cuenta y la línea no aparece por defecto", async () => {
    await expect(compararRendimientosDeSucursales([norte], {})).resolves.toEqual([]);

    const conFuera = await compararRendimientosDeSucursales([fuera], {});
    expect(conFuera).toHaveLength(1);
    expect(conFuera[0].porSucursal.get(fuera.id)).toMatchObject({ cantidad: 99, mermaPorcentaje: 99, calibrado: true });
  });

  it("acepta el cliente de una transacción como `db`", async () => {
    const filas = await prisma.$transaction((tx) => compararRendimientosDeSucursales([central, norte], {}, tx));
    expect(filas.map((f) => f.recetaIngredienteId)).toEqual([lineaPanHarina]);
    expect(filas[0].porSucursal.get(central.id)?.bruto).toBe(3);
  });
});
