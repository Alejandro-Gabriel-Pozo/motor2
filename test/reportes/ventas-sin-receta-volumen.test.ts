import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, vaciarOperacionesPorVolumen, analizarDespuesDeCargaMasiva, prisma } from "../setup/test-db";
import { generarReporteVentasSinReceta } from "../../src/core/reportes/ventas-sin-receta";

/**
 * El reporte de ventas sin receta no puede traer una fila por venta ni armar una lista con todos los `operacionId`: con ~60k ventas la
 * versión anterior (`findMany` de todas las ventas + `operacionId: { in: [...] }`) superaba el límite de parámetros de Prisma 7. El
 * volumen se siembra directo con SQL, sin pasar por la aplicación.
 */
describe("generarReporteVentasSinReceta con decenas de miles de ventas", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let pvId: string;
  let mpId: string;

  afterEach(vaciarOperacionesPorVolumen);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    pvId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Medialuna", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 10 } })).id;
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  it("cuenta las ventas sin consumo y no las anuladas ni las que sí descontaron una MP", async () => {
    const total = 60_000;
    const conConsumo = 10_000; // ventas 1..10.000 generaron un CONSUMO de la MP
    const anuladasDesde = 59_001; // ventas 59.001..60.000 están anuladas
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId", "anuladaEn")
      SELECT 'v' || g, ${sucursalId}, 'VENTA'::"Proceso", '2026-01-01T00:00:00'::timestamp + (g || ' minutes')::interval, ${adminId},
             CASE WHEN g >= ${anuladasDesde}::int THEN '2026-06-01T00:00:00'::timestamp END
      FROM generate_series(1, ${total}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle", "precioTotal", "precioPorUnidadStock")
      SELECT 'vm' || g, 'v' || g, ${pvId}, ${seccionId}, 'VENTA'::"Proceso", -1, 'Venta', 10, 10
      FROM generate_series(1, ${total}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle")
      SELECT 'vc' || g, 'v' || g, ${mpId}, ${seccionId}, 'CONSUMO'::"Proceso", -1, 'Consumo'
      FROM generate_series(1, ${conConsumo}::int) g`;

    await analizarDespuesDeCargaMasiva();
    const filas = await generarReporteVentasSinReceta(sucursalId, prisma);

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ productoId: pvId, producto: "Medialuna", codigo: "PV_1", cantidadVentasSinReceta: anuladasDesde - 1 - conConsumo });
    expect(filas[0].primeraFecha.toISOString()).toBe("2026-01-07T22:41:00.000Z"); // minuto 10.001
    expect(filas[0].ultimaFecha.toISOString()).toBe("2026-02-10T23:20:00.000Z"); // minuto 59.000
  }, 60_000);

  it("solo cuenta ventas de la sucursal pedida y solo PV", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otra.id, "Otra sección");
    const unidad = (await prisma.unidad.findFirstOrThrow()).id;
    const otroPv = await prisma.producto.create({ data: { codigo: "PV_2", nombre: "Factura", tipo: "PV", unidadStockId: unidad, precioVenta: 5 } });
    const fecha = new Date("2026-03-01T12:00:00Z");
    for (const [sucId, secId, prodId, id] of [
      [sucursalId, seccionId, pvId, "op-a"],
      [otra.id, otraSeccion.id, otroPv.id, "op-b"],
      [sucursalId, seccionId, mpId, "op-c"], // una MP vendida (no debería existir, pero no es un PV)
    ] as const) {
      await prisma.operacion.create({ data: { id, sucursalId: sucId, proceso: "VENTA", fecha, usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: id, productoId: prodId, seccionId: secId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 1, precioPorUnidadStock: 1 } });
    }

    const filas = await generarReporteVentasSinReceta(sucursalId, prisma);
    expect(filas.map((f) => f.productoId)).toEqual([pvId]);
    expect(filas[0].cantidadVentasSinReceta).toBe(1);
  });
});
