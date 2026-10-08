import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import type { Db } from "../../src/lib/db-tipos";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * Una corrida de `obtenerReportePorPeriodo` toca la tabla de versiones de receta UNA sola vez, con CUALQUIER operación.
 *
 * `test/reportes/catalogo-una-sola-carga.test.ts` (que no se edita) cuenta solo los `recetaVersion.findMany`. Este test cuenta TODAS las
 * operaciones sobre el modelo (`findFirst`, `groupBy`, `count`, `aggregate`…): al unificar la elección de la receta vigente en un solo lugar,
 * un lector que "reusa" el embudo no puede sumar de paso otra consulta (un `groupBy` de la última versión, un `findFirst` por plato) sin que
 * esto lo marque. Mismo fixture que ese archivo (duplicado a propósito para no tocarlo).
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("obtenerReportePorPeriodo — una sola operación sobre recetaVersion", () => {
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
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 2, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 3, unidadId: kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-01"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-03"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 80 }] });
    for (const dia of ["2026-08-04", "2026-08-05"]) {
      const r = await registrarVenta({ fecha: d(dia), seccionId, ventas: [{ productoId: pan.id, cantidadVendida: 1 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
    await prisma.movimientoStock.updateMany({ where: { productoId: pan.id, proceso: "VENTA", operacion: { fecha: d("2026-08-05") } }, data: { costoUnitarioVenta: null } });
  });

  it("una corrida del reporte hace UNA operación sobre recetaVersion, del tipo que sea", async () => {
    const operaciones: string[] = [];
    const dbContado = prisma.$extends({
      query: {
        recetaVersion: {
          $allOperations({ operation, args, query }) {
            operaciones.push(operation);
            return query(args);
          },
        },
      },
    }) as unknown as Db;

    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-02"), d("2026-08-10"), {}, dbContado, AHORA_DE_LA_CORRIDA);

    expect(rep.impactoRecetas.length, "no corrió el impacto de recetas").toBeGreaterThan(0);
    expect(rep.margen.costoTotal, "no corrió el margen nominal").toBeGreaterThan(0);
    expect(operaciones).toEqual(["findMany"]);
  });
});
