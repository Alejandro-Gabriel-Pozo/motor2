import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteVentasSinReceta } from "../../src/server/consultas/reportes/ventas-sin-receta";

/**
 * El reporte «Ventas sin receta». Desde ADR-033 («sin receta no se vende») es una VERIFICACIÓN: una venta nueva de un PV sin receta se rechaza, así que con datos nuevos da vacío; lo que
 * sigue encontrando son las ventas de antes de la regla, que acá se siembran directo en el Kardex (como quedaron escritas).
 */
describe("generarReporteVentasSinReceta", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminId: string;
  /** Una venta de ANTES de la regla (ADR-033): la fila VENTA sin ningún CONSUMO, escrita directo como quedó en el Kardex. */
  const ventaHistoricaSinConsumo = async (productoId: string) => {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-09-01T12:00:00Z"), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 50, precioPorUnidadStock: 50 } });
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("detecta el corte: PV sin receta cargada aparece, PV con receta (que sí generó consumo) no", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const conReceta = await sembrarProductoDisponible({ codigo: "PV_CON", nombre: "Con receta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const sinReceta = await sembrarProductoDisponible({ codigo: "PV_SIN", nombre: "Sin receta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 50 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: conReceta.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: conReceta.id, cantidadVendida: 1 }] }); // sí genera consumo: no debe aparecer
    // RECETA (ADR-033): una venta NUEVA sin receta ya no se registra — con datos nuevos, el reporte (una verificación) da vacío.
    const nueva = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: sinReceta.id, cantidadVendida: 1 }] });
    expect(nueva).toEqual({ ok: false, mensaje: "«Sin receta» no tiene receta: armala en Catálogo → Recetas para poder venderla." });
    expect(await generarReporteVentasSinReceta(sucursalId, prisma)).toEqual([]);
    // Las de antes de la regla (escritas sin consumo) sí aparecen.
    await ventaHistoricaSinConsumo(sinReceta.id);
    await ventaHistoricaSinConsumo(sinReceta.id);

    const filas = await generarReporteVentasSinReceta(sucursalId, prisma);
    expect(filas.find((f) => f.productoId === sinReceta.id)?.cantidadVentasSinReceta).toBe(2);
    expect(filas.find((f) => f.productoId === conReceta.id)).toBeUndefined();
  });
});
