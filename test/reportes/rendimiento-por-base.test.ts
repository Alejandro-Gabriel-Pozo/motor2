import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularRendimientoRecetasSimples } from "../../src/server/consultas/reportes/rendimiento-recetas";
import { compararRendimientosPorSucursal } from "../../src/server/consultas/reportes/rendimiento-por-sucursal";
import { ZONA_ARGENTINA, mediodiaDelDia } from "../../src/core/tiempo/zona-horaria";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { CASOS_DE_RENDIMIENTO_POR_BASE } from "./rendimiento-por-base.reglas";

/**
 * M3d (docs/diseno-merma-m3d-rendimiento-y-calibracion-2026-11-17.md, nivel 10): el reporte de rendimiento lee la BASE de la versión de cada línea. La misma comida cargada en neto o en bruto
 * tiene que dar el mismo bruto teórico y el mismo desvío, y «Usar este valor» (`cantidadEstimada`) tiene que ser neto en una receta neta y BRUTO en una bruta. Los valores esperados salen del
 * oráculo escrito a mano (`rendimiento-por-base.reglas.ts`). Contra Postgres real.
 */
describe("reporte de rendimiento según la base de la línea (M3d)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-01-31");
  const dentroDelRango = mediodiaDelDia("2026-01-15", ZONA_ARGENTINA);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    unidadKgId = (await sembrarCatalogoBase()).kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Un plato con un insumo, la receta escrita directo con la base pedida, 10 comprados y 20 vendidos (estimado bruto 0,5). */
  async function sembrarEscenario(c: (typeof CASOS_DE_RENDIMIENTO_POR_BASE)[number]) {
    const insumo = await sembrarProductoDisponible({ codigo: "MP_BASE", nombre: "Bife de chorizo", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const plato = await sembrarProductoDisponible({ codigo: "PV_BASE", nombre: "Bife a la criolla", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    const receta = await prisma.recetaVersion.create({
      data: {
        productoId: plato.id,
        version: 1,
        baseDeCantidad: c.base,
        ingredientes: { create: [{ insumoProductoId: insumo.id, cantidad: c.cantidadCargada, mermaPorcentaje: c.mermaPorcentaje, unidadId: unidadKgId }] },
      },
      include: { ingredientes: true },
    });
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: dentroDelRango, seccionId, items: [{ productoId: insumo.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: plato.id, cantidadVendida: 20 }] });
    return { insumo, plato, recetaIngredienteId: receta.ingredientes[0].id };
  }

  it.each(CASOS_DE_RENDIMIENTO_POR_BASE)("simple: $base cantidad $cantidadCargada · merma $mermaPorcentaje % → estimado y desvío del oráculo", async (c) => {
    await sembrarEscenario(c);
    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].baseDeCantidad).toBe(c.base);
    expect(filas[0].cantidadActual).toBe(c.cantidadCargada);
    expect(filas[0].cantidadEstimada).toBe(c.estimadoEnLaBase);
    expect(filas[0].desviacionPorcentaje).toBe(c.desviacionPorcentaje);
  });

  it("simple: con una calibración de la sucursal sobre una línea BRUTA, el desvío se calcula con el bruto calibrado (no se vuelve a sumar la merma)", async () => {
    const c = CASOS_DE_RENDIMIENTO_POR_BASE[1]; // BRUTA 0,44 · merma 10
    const { recetaIngredienteId } = await sembrarEscenario(c);
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId, cantidad: 0.5, mermaPorcentaje: null } });
    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas[0].calibradoLocal).toBe(true);
    expect(filas[0].cantidadActual).toBe(0.5);
    expect(filas[0].cantidadActualCentral).toBe(0.44);
    // estimado bruto 0,5 contra teórico bruto calibrado 0,5 (bruta: la cantidad ya es el bruto) → desvío 0.
    expect(filas[0].desviacionPorcentaje).toBe(0);
  });

  it("comparativo por sucursal: cada línea se pasa a bruto con la base de SU versión (la bruta no suma la merma otra vez)", async () => {
    const neta = CASOS_DE_RENDIMIENTO_POR_BASE[0];
    const bruta = CASOS_DE_RENDIMIENTO_POR_BASE[1];
    const insumoN = await sembrarProductoDisponible({ codigo: "MP_N", nombre: "Harina neta", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const platoN = await sembrarProductoDisponible({ codigo: "PV_N", nombre: "Pan neto", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const insumoB = await sembrarProductoDisponible({ codigo: "MP_B", nombre: "Harina bruta", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const platoB = await sembrarProductoDisponible({ codigo: "PV_B", nombre: "Pan bruto", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const rN = await prisma.recetaVersion.create({
      data: { productoId: platoN.id, version: 1, baseDeCantidad: "NETA", ingredientes: { create: [{ insumoProductoId: insumoN.id, cantidad: neta.cantidadCargada, mermaPorcentaje: 10, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    const rB = await prisma.recetaVersion.create({
      data: { productoId: platoB.id, version: 1, baseDeCantidad: "BRUTA", ingredientes: { create: [{ insumoProductoId: insumoB.id, cantidad: bruta.cantidadCargada, mermaPorcentaje: 10, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    // Una calibración en cada línea, en la base de su línea.
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: rN.ingredientes[0].id, sucursalId, cantidad: 0.5, mermaPorcentaje: null } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: rB.ingredientes[0].id, sucursalId, cantidad: 0.55, mermaPorcentaje: null } });

    const filas = await compararRendimientosPorSucursal([{ id: sucursalId, nombre: "Central" }], {}, prisma);
    const filaN = filas.find((f) => f.productoNombre === "Pan neto")!;
    const filaB = filas.find((f) => f.productoNombre === "Pan bruto")!;
    expect(filaN.baseDeCantidad).toBe("NETA");
    expect(filaB.baseDeCantidad).toBe("BRUTA");
    expect(filaN.central.bruto).toBe(0.44); // 0,4 × 1,10
    expect(filaN.porSucursal.get(sucursalId)!.bruto).toBe(0.55); // 0,5 × 1,10
    expect(filaB.central.bruto).toBe(0.44); // bruta: la cantidad ya es el bruto
    expect(filaB.porSucursal.get(sucursalId)!.bruto).toBe(0.55); // bruta: 0,55 tal cual
    // Las dos líneas, la misma comida con el mismo bruto: el mismo desvío.
    expect(filaN.porSucursal.get(sucursalId)!.desviacionPorcentaje).toBe(filaB.porSucursal.get(sucursalId)!.desviacionPorcentaje);
  });
});
