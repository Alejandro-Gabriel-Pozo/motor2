import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * `obtenerReportePorPeriodo` y el catálogo de productos.
 *
 * El fixture está armado para que el reporte pase por LAS TRES rutas que antes cargaban su propio catálogo:
 *  - impacto de recetas (`calcularImpactoRecetasPorPeriodo`): la harina se compró a $5 ANTES del período y a $8 dentro de él, así que el
 *    costo de la receta cambia y hay una fila de impacto;
 *  - margen nominal (`calcularCostosYMargenes`): hay un plato vendido con receta y precio;
 *  - margen Real reconstruido (`reconstruirCostosDeVenta`): una de las dos ventas se guardó SIN costo (`costoUnitarioVenta` en NULL),
 *    y esa ruta corta antes de cargar nada si no hay ventas así.
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("obtenerReportePorPeriodo — catálogo", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kg.id }] } } });
    // 10 kg a $5 el kilo el 1/8 (ANTES del período) y 10 kg a $8 el kilo el 3/8 (dentro).
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-01"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-03"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 80 }] });
    // Dos ventas del pan. La segunda se deja SIN costo guardado, para que el margen Real la reconstruya con el historial de compras.
    for (const dia of ["2026-08-04", "2026-08-05"]) {
      const r = await registrarVenta({ fecha: d(dia), seccionId, ventas: [{ productoId: pan.id, cantidadVendida: 1 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
    await prisma.movimientoStock.updateMany({ where: { productoId: pan.id, proceso: "VENTA", operacion: { fecha: d("2026-08-05") } }, data: { costoUnitarioVenta: null } });
  });

  it("caracterización: los números del reporte (fijados ANTES de compartir la carga del catálogo, y no pueden cambiar con ella)", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-02"), d("2026-08-10"), undefined, prisma, AHORA_DE_LA_CORRIDA);

    expect(rep.ventas.totalFacturado).toBe(200);
    expect(rep.compras.totalGastado).toBe(80);
    // Margen nominal: 2 ventas × (2 kg de harina a $8 = $16) = $32 de costo.
    expect(rep.margen.costoTotal).toBe(32);
    expect(rep.margen.margenTotal).toBe(168);
    // Margen Real: una venta con costo congelado ($16) y otra reconstruida con el historial ($16, harina a $8 el 5/8).
    expect(rep.margen.ingresoConCostoReal).toBe(200);
    expect(rep.margen.ingresoRealReconstruido).toBe(100);
    expect(rep.margen.margenRealTotal).toBe(168);
    expect(rep.margen.porProducto[0].margenReal).toBe(168);
    expect(rep.margen.porProducto[0].ingresoRealReconstruido).toBe(100);
    // Impacto de la receta: $10 antes del período (harina a $5), $16 ahora (a $8).
    expect(rep.impactoRecetas).toHaveLength(1);
    expect(rep.impactoRecetas[0]).toMatchObject({ costoAntes: 10, costoActual: 16, deltaCosto: 6 });
  });
});
