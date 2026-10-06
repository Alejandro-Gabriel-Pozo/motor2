import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { compararRendimientosPorSucursal } from "../../src/server/consultas/reportes/rendimiento-por-sucursal";

describe("compararRendimientosPorSucursal (D8, paso 8)", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let sucursalFueraId: string;
  let unidadKgId: string;
  let pv: { id: string; nombre: string };
  let mp: { id: string; nombre: string };
  let recetaIngredienteId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    sucursalFueraId = (await prisma.sucursal.create({ data: { nombre: "Fuera de membresía" } })).id;
    const { kg } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalAId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mp = await sembrarProductoDisponible({ codigo: "MP_CMP", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId }, sucursalAId);
    pv = await sembrarProductoDisponible({ codigo: "PV_CMP", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalAId);
    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 25, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    recetaIngredienteId = receta.ingredientes[0].id;
  });

  it("bruto vs neto: la columna comparada es cantidad × (1 + merma/100), no la cantidad neta sola", async () => {
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2, mermaPorcentaje: 50 } });

    const filas = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], {}, prisma);
    const fila = filas[0];
    expect(fila.central).toEqual({ cantidad: 1, mermaPorcentaje: 25, bruto: 1.25 });
    const valorA = fila.porSucursal.get(sucursalAId)!;
    expect(valorA.cantidad).toBe(2);
    expect(valorA.mermaPorcentaje).toBe(50);
    expect(valorA.bruto).toBe(3); // 2 × 1.5
    expect(valorA.calibrado).toBe(true);
  });

  it("desvío: % de diferencia entre el bruto de la sucursal y el bruto central", async () => {
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2.5, mermaPorcentaje: 0 } });
    // Central bruto = 1.25. Sucursal bruto = 2.5. Desvío = (2.5-1.25)/1.25*100 = 100%.
    const filas = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], {}, prisma);
    expect(filas[0].porSucursal.get(sucursalAId)!.desviacionPorcentaje).toBe(100);
  });

  it("'sin calibrar': una sucursal sin override da el valor central, calibrado=false, desvío 0", async () => {
    // Calibra SOLO A, para que la línea aparezca en el resultado por defecto (algunaCalibrada).
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2, mermaPorcentaje: null } });

    const filas = await compararRendimientosPorSucursal(
      [{ id: sucursalAId, nombre: "Central" }, { id: sucursalBId, nombre: "Norte" }],
      {},
      prisma
    );
    const fila = filas[0];
    const valorB = fila.porSucursal.get(sucursalBId)!;
    expect(valorB.calibrado).toBe(false);
    expect(valorB.cantidad).toBe(1);
    expect(valorB.mermaPorcentaje).toBe(25);
    expect(valorB.desviacionPorcentaje).toBe(0);
  });

  it("filtro por defecto: sin ninguna calibración, la línea no aparece; con ?todas=1 (filtro.todas), sí", async () => {
    const sinFiltro = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], {}, prisma);
    expect(sinFiltro).toHaveLength(0);

    const conTodas = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], { todas: true }, prisma);
    expect(conTodas).toHaveLength(1);
    expect(conTodas[0].algunaCalibrada).toBe(false);
  });

  it("filtro por productoId: solo la receta de ese producto", async () => {
    const otroPv = await sembrarProductoDisponible({ codigo: "PV_CMP2", nombre: "Otro plato", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalAId);
    await prisma.recetaVersion.create({ data: { productoId: otroPv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2, mermaPorcentaje: null } });

    const filas = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], { productoId: pv.id, todas: true }, prisma);
    expect(filas.map((f) => f.productoId)).toEqual([pv.id]);
  });

  it("Postgres: una sucursal FUERA de la lista de sucursales pedida nunca aparece, aunque tenga su propio override", async () => {
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalFueraId, cantidad: 99, mermaPorcentaje: 99 } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2, mermaPorcentaje: null } });

    const filas = await compararRendimientosPorSucursal([{ id: sucursalAId, nombre: "Central" }], {}, prisma);
    expect(filas[0].porSucursal.has(sucursalFueraId)).toBe(false);
    expect(Array.from(filas[0].porSucursal.keys())).toEqual([sucursalAId]);
  });
});
