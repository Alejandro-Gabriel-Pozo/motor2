import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, vaciarOperacionesPorVolumen, analizarDespuesDeCargaMasiva, prisma } from "../setup/test-db";
import { construirMapaProductos } from "../../src/core/reportes/comun";
import { calcularTendenciaPreciosDelPeriodo } from "../../src/core/reportes/periodo-precios";
import type { ItemPeriodo } from "../../src/core/reportes/periodo-tipos";

/**
 * "Precio anterior" de cada insumo = la última compra válida ANTES del período, de cualquiera de sus productos. La versión anterior leía
 * TODAS las compras previas de esos productos (`findMany` sin cota + orden por fecha) y se quedaba con la primera de cada insumo en JS: no
 * reventaba (con 400k compras previas tardaba ~6 s y ~3,8 s ya en SQL, sin índice parcial), pero crecía sin cota con la historia y dejaba el
 * desempate de fechas iguales librado al azar. Ahora se resuelve en SQL (1 fila por producto, desempate por id). El test de empate es el que
 * discrimina contra la versión vieja; el de volumen fija el resultado correcto con mucha historia.
 */
describe("calcularTendenciaPreciosDelPeriodo con mucha historia de compras", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaAId: string;
  let harinaBId: string;
  let azucarId: string;

  async function sembrarCompras(productoId: string, cantidad: number, opciones: { desde: string; precioTotal: number; unidades: number; prefijo: string; anuladas?: boolean }) {
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId", "anuladaEn")
      SELECT ${opciones.prefijo} || g, ${sucursalId}, 'COMPRA'::"Proceso", ${opciones.desde}::timestamp + (g || ' minutes')::interval, ${adminId},
             CASE WHEN ${opciones.anuladas ?? false}::boolean THEN '2026-06-01T00:00:00'::timestamp END
      FROM generate_series(1, ${cantidad}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle", "precioTotal", "precioPorUnidadStock")
      SELECT ${opciones.prefijo} || 'm' || g, ${opciones.prefijo} || g, ${productoId}, ${seccionId}, 'COMPRA'::"Proceso", ${opciones.unidades}::numeric, 'Compra',
             ${opciones.precioTotal}::numeric, CASE WHEN ${opciones.unidades}::numeric > 0 THEN ${opciones.precioTotal}::numeric / ${opciones.unidades}::numeric ELSE 0 END
      FROM generate_series(1, ${cantidad}::int) g`;
    await analizarDespuesDeCargaMasiva();
  }

  function compraDelPeriodo(productoId: string, cantidad: number, precioTotal: number): ItemPeriodo {
    return {
      fecha: new Date("2026-03-15T12:00:00Z"), productoId, productoNombre: "x", productoCodigo: "x", detalle: "Compra", cantidad, loteVencimiento: null,
      proveedorNombre: null, proveedorId: null, nroFactura: null, proceso: "COMPRA", seccionId, seccionNombre: "Depósito", idMovimiento: "mov-periodo",
      idOperacion: "op-periodo", precioTotal, precioPorUnidadStock: precioTotal / cantidad, costoUnitarioVenta: null, anulada: false,
    };
  }

  afterEach(vaciarOperacionesPorVolumen);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase(); // insumo "Harina"
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const azucarInsumo = await prisma.insumo.create({ data: { nombre: "Azúcar" } });
    const crear = (codigo: string, nombre: string, insumoId: string) =>
      prisma.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: catalogo.kg.id, insumoId } }).then((p) => p.id);
    harinaAId = await crear("MP_HA", "Harina 000", catalogo.insumo.id);
    harinaBId = await crear("MP_HB", "Harina 0000", catalogo.insumo.id);
    azucarId = await crear("MP_AZ", "Azúcar", azucarInsumo.id);
  });

  it("con ~60k compras previas devuelve la última compra válida de cada insumo (entre todos sus productos)", async () => {
    // Harina A: 60.000 compras viejas a $10/u (2023). Harina B (mismo insumo): una compra válida a $40/u el 2025-12-01, otra más nueva pero
    // SIN precio (se saltea) y otra más nueva pero ANULADA (se saltea) — la válida más reciente de la Harina es la de $40.
    await sembrarCompras(harinaAId, 60_000, { desde: "2023-01-01T00:00:00", precioTotal: 10, unidades: 1, prefijo: "ha" });
    await sembrarCompras(harinaBId, 1, { desde: "2025-12-01T00:00:00", precioTotal: 80, unidades: 2, prefijo: "hb" });
    await sembrarCompras(harinaBId, 1, { desde: "2025-12-15T00:00:00", precioTotal: 0, unidades: 1, prefijo: "hc" });
    await sembrarCompras(harinaBId, 1, { desde: "2025-12-20T00:00:00", precioTotal: 999, unidades: 1, prefijo: "hd", anuladas: true });
    // Azúcar: solo tiene una compra POSTERIOR al inicio del período → sin precio anterior.
    await sembrarCompras(azucarId, 1, { desde: "2026-02-01T00:00:00", precioTotal: 30, unidades: 1, prefijo: "az" });

    const productos = await construirMapaProductos(undefined, prisma);
    const desde = new Date("2026-01-01T00:00:00Z");
    const filas = await calcularTendenciaPreciosDelPeriodo(sucursalId, desde, [compraDelPeriodo(harinaAId, 1, 50), compraDelPeriodo(azucarId, 1, 20)], productos, prisma);

    const harina = filas.find((f) => f.insumo === "Harina")!;
    expect(harina).toMatchObject({ precioUnitarioPromedio: 50, precioUnitarioAnterior: 40, deltaPct: 25, deltaImpacto: 10 });
    const azucar = filas.find((f) => f.insumo === "Azúcar")!;
    expect(azucar).toMatchObject({ precioUnitarioPromedio: 20, precioUnitarioAnterior: null, deltaPct: null, deltaImpacto: null });
  }, 60_000);

  it("ante dos compras válidas con la misma fecha en el mismo insumo, gana siempre la misma (id mayor)", async () => {
    const fecha = new Date("2025-06-01T12:00:00Z");
    for (const [id, productoId, precio] of [["op-a", harinaAId, 10], ["op-z", harinaBId, 20], ["op-m", harinaAId, 15]] as const) {
      await prisma.operacion.create({ data: { id, sucursalId, proceso: "COMPRA", fecha, usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { id: `mov-${id}`, operacionId: id, productoId, seccionId, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: precio, precioPorUnidadStock: precio } });
    }
    const productos = await construirMapaProductos(undefined, prisma);
    for (let i = 0; i < 3; i++) {
      const [fila] = await calcularTendenciaPreciosDelPeriodo(sucursalId, new Date("2026-01-01T00:00:00Z"), [compraDelPeriodo(harinaAId, 1, 50)], productos, prisma);
      expect(fila.precioUnitarioAnterior).toBe(20); // mov-op-z
    }
  });

  it("ignora las compras previas de otra sucursal", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otra.id, "Otra sección");
    await prisma.operacion.create({ data: { id: "op-otra", sucursalId: otra.id, proceso: "COMPRA", fecha: new Date("2025-12-01T12:00:00Z"), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: "op-otra", productoId: harinaAId, seccionId: otraSeccion.id, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 999, precioPorUnidadStock: 999 } });
    const productos = await construirMapaProductos(undefined, prisma);
    const [fila] = await calcularTendenciaPreciosDelPeriodo(sucursalId, new Date("2026-01-01T00:00:00Z"), [compraDelPeriodo(harinaAId, 1, 50)], productos, prisma);
    expect(fila.precioUnitarioAnterior).toBeNull();
  });
});
