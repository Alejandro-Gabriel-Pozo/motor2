import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { obtenerCostoActualPorMP } from "../../src/core/reportes/comun";
import { claveCostoHistorico } from "../../src/core/reportes/costo-historico";
import { reconstruirCostosDeVenta } from "../../src/server/consultas/reportes/costo-historico";
import { listarComprasRegistradas } from "../../src/server/consultas/reportes/compras-registradas";
import { obtenerOperacionPorId } from "../../src/server/consultas/reportes/trazabilidad";

/**
 * K1c, Fase 0: una COMPRA anulada es una factura que no ocurrió, así que ningún reporte de dinero la cuenta. Hoy la aplicación todavía no puede
 * anular una compra (solo ventas): estos tests la siembran ya anulada, directo en la base, para dejar fijado el comportamiento ANTES de construir
 * la acción. Los reportes no cambian ningún número mientras no exista una compra anulada.
 *
 * Compras de harina sembradas (todas 10 kg salvo la A):
 *   A  vigente   2026-07-10 12:00    5 kg por $25     ($5/kg)
 *   B  anulada   2026-07-20 12:00   10 kg por $500    ($50/kg)
 *   C  vigente   2026-08-10 12:00   10 kg por $100    ($10/kg)
 *   D  anulada   2026-08-10 18:00   10 kg por $1000   ($100/kg), el MISMO día que C pero más tarde
 *   E  anulada   2026-08-12 12:00   10 kg por $1000   ($100/kg), de otro proveedor
 * Si una anulada se colara, siempre sería la más reciente y ganaría sobre la vigente: por eso cada caso las pone más nuevas que la que debe valer.
 */
describe("las compras anuladas no cuentan en los reportes de dinero", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminId: string;
  let harinaId: string;
  let platoId: string;
  let proveedorAnuladorId: string;

  const d = (iso: string) => new Date(`${iso}Z`);

  async function compra(fecha: Date, cantidad: number, precioTotal: number, opciones: { anulada?: boolean; proveedorId?: string } = {}) {
    const operacion = await prisma.operacion.create({
      data: {
        sucursalId,
        proceso: "COMPRA",
        fecha,
        usuarioId: adminId,
        proveedorId: opciones.proveedorId ?? null,
        ...(opciones.anulada ? { anuladaEn: new Date(), anuladaPorId: adminId } : {}),
      },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad, detalle: "Compra", precioTotal, precioPorUnidadStock: precioTotal / cantidad },
    });
    return operacion;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;

    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } })).id;
    platoId = (await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } })).id;
    await prisma.recetaVersion.create({ data: { productoId: platoId, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 1, unidadId: unidadKgId }] } } });
    const proveedorVigente = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino Vigente" } });
    proveedorAnuladorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Molino Anulado" } })).id;

    await compra(d("2026-07-10T12:00:00"), 5, 25);
    await compra(d("2026-07-20T12:00:00"), 10, 500, { anulada: true });
    await compra(d("2026-08-10T12:00:00"), 10, 100, { proveedorId: proveedorVigente.id });
    await compra(d("2026-08-10T18:00:00"), 10, 1000, { anulada: true });
    await compra(d("2026-08-12T12:00:00"), 10, 1000, { anulada: true, proveedorId: proveedorAnuladorId });
  });

  it("el gasto del período, el gasto por insumo y la tendencia de precios solo cuentan la compra vigente", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-01"), new Date("2026-08-31"), undefined, prisma);

    expect(rep.compras.totalGastado).toBe(100); // solo C; sin el filtro serían 2100
    expect(rep.compras.porProveedor.map((p) => p.proveedor)).toEqual(["Molino Vigente"]);

    const harina = rep.gastoPorInsumo.porInsumo.find((f) => f.insumo === "Harina");
    expect(harina?.importe).toBe(100);
    expect(harina?.cantidadCompras).toBe(1);

    const precio = rep.tendenciaPrecios.find((f) => f.insumo === "Harina");
    expect(precio?.precioUnitarioPromedio).toBe(10); // ni D ni E ($100/kg) entran en el promedio
    expect(precio?.cantidadComprada).toBe(10);
  });

  it("el precio de referencia anterior ignora la compra anulada más reciente", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-01"), new Date("2026-08-31"), undefined, prisma);
    const precio = rep.tendenciaPrecios.find((f) => f.insumo === "Harina");
    // La última compra ANTES de agosto es B ($50/kg, anulada): tiene que valer A ($5/kg, vigente).
    expect(precio?.precioUnitarioAnterior).toBe(5);
  });

  it("el ratio Compras/Ventas del período anterior no cuenta la compra anulada (y compara lo mismo que el actual)", async () => {
    // Una venta en julio (el período anterior a agosto): $200. Compras de julio vigentes: solo A ($25) → 12,5 %. Con B serían 525 / 200.
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: d("2026-07-15T12:00:00"), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: platoId, seccionId, proceso: "VENTA", cantidad: -2, detalle: "Venta", precioTotal: 200, precioPorUnidadStock: 100 } });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-08-01"), new Date("2026-08-31"), undefined, prisma);
    expect(rep.ratioGastoVentas.porcentajePeriodoAnterior).toBe(12.5);
  });

  it("el costo de reposición (compra más reciente) ignora las anuladas, con y sin fecha de corte", async () => {
    const hoy = await obtenerCostoActualPorMP(sucursalId, prisma);
    expect(hoy.get(harinaId)?.precioPorUnidadStock).toBe(10); // C, no D ni E
    expect(hoy.get(harinaId)?.fecha?.toISOString().slice(0, 10)).toBe("2026-08-10");

    const antesDeAgosto = await obtenerCostoActualPorMP(sucursalId, prisma, d("2026-08-01T00:00:00"));
    expect(antesDeAgosto.get(harinaId)?.precioPorUnidadStock).toBe(5); // A, no B
  });

  it("el costo reconstruido de una venta ignora las anuladas, tanto en la ventana como en la semilla", async () => {
    const costos = await reconstruirCostosDeVenta(sucursalId, [
      { productoId: platoId, fecha: d("2026-08-11T12:00:00") }, // semilla: la última antes del 11/8 es D (anulada, mismo día que C) → tiene que ser C
      { productoId: platoId, fecha: d("2026-09-05T12:00:00") }, // ventana: E (anulada) cae adentro → tiene que seguir siendo C
    ], prisma);
    expect(costos.get(claveCostoHistorico(platoId, "2026-08-11"))).toBe(10);
    expect(costos.get(claveCostoHistorico(platoId, "2026-09-05"))).toBe(10);
  });

  it("el listado de compras registradas muestra la anulada marcada, con quién y cuándo, y sin ocultarla", async () => {
    const { items } = await listarComprasRegistradas(sucursalId, { desde: new Date("2026-08-01"), hasta: new Date("2026-08-31") }, prisma);
    const anuladas = items.filter((c) => c.anuladaEn);
    const vigentes = items.filter((c) => !c.anuladaEn);
    expect(anuladas).toHaveLength(2);
    expect(vigentes).toHaveLength(1);
    expect(anuladas.every((c) => c.anuladaPorEmail === "admin@test.com")).toBe(true);
    expect(vigentes[0].anuladaPorEmail).toBeNull();
    expect(vigentes[0].total).toBe(100);
  });

  it("la trazabilidad informa la anulación de una compra, no solo de una venta", async () => {
    const anulada = await prisma.operacion.findFirstOrThrow({ where: { proveedorId: proveedorAnuladorId } });
    const datos = await obtenerOperacionPorId(sucursalId, anulada.id, prisma);
    expect(datos?.proceso).toBe("COMPRA");
    expect(datos?.anuladaEn).not.toBeNull();
    expect(datos?.anuladaPorEmail).toBe("admin@test.com");
  });
});
