import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, vaciarOperacionesPorVolumen, analizarDespuesDeCargaMasiva, prisma } from "../setup/test-db";
import { obtenerCostoActualPorMP } from "../../src/core/reportes/comun";

/**
 * El costo de reposición trae 1 fila por producto (la compra más reciente), no una por compra: con ~55k compras (3 años de una
 * sucursal grande) la versión anterior —`findMany` de toda la historia con `include`— reventaba por el límite de parámetros de
 * Prisma 7 (lo encontró el benchmark de A5). Estos tests siembran el volumen directo con SQL, sin pasar por la aplicación.
 */
describe("obtenerCostoActualPorMP con mucha historia y con empates", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let azucarId: string;

  async function sembrarCompras(productoId: string, cantidad: number, opciones: { desde: string; precio: number; prefijo: string }) {
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId")
      SELECT ${opciones.prefijo} || g, ${sucursalId}, 'COMPRA'::"Proceso", ${opciones.desde}::timestamp + (g || ' minutes')::interval, ${adminId}
      FROM generate_series(1, ${cantidad}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle", "precioTotal", "precioPorUnidadStock")
      SELECT ${opciones.prefijo} || 'm' || g, ${opciones.prefijo} || g, ${productoId}, ${seccionId}, 'COMPRA'::"Proceso", 1, 'Compra', ${opciones.precio}::numeric, ${opciones.precio}::numeric
      FROM generate_series(1, ${cantidad}::int) g`;
    await analizarDespuesDeCargaMasiva();
  }

  afterEach(vaciarOperacionesPorVolumen);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    azucarId = (await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  it("con decenas de miles de compras devuelve la más reciente de cada producto (con y sin fecha de corte)", async () => {
    // Harina: 60.000 compras a $10, una por minuto desde 2023-01-01; la última (minuto 60.000) es la del 2023-02-11 — más una
    // compra más nueva a $77 con proveedor. Azúcar: 5.000 compras a $3 (más viejas).
    await sembrarCompras(harinaId, 60_000, { desde: "2023-01-01T00:00:00", precio: 10, prefijo: "h" });
    await sembrarCompras(azucarId, 5_000, { desde: "2022-01-01T00:00:00", precio: 3, prefijo: "a" });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } });
    const reciente = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-01T12:00:00Z"), usuarioId: adminId, proveedorId: proveedor.id } });
    await prisma.movimientoStock.create({ data: { operacionId: reciente.id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 77, precioPorUnidadStock: 77 } });

    const hoy = await obtenerCostoActualPorMP(sucursalId, prisma);
    expect(hoy.size).toBe(2);
    expect(hoy.get(harinaId)).toMatchObject({ precioPorUnidadStock: 77, proveedorNombre: "Molino" });
    expect(hoy.get(harinaId)?.fecha?.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(hoy.get(azucarId)).toMatchObject({ precioPorUnidadStock: 3, proveedorNombre: null });

    const antes = await obtenerCostoActualPorMP(sucursalId, prisma, new Date("2026-01-01T00:00:00Z"));
    expect(antes.get(harinaId)?.precioPorUnidadStock).toBe(10);
    expect(antes.get(harinaId)?.fecha?.toISOString()).toBe("2023-02-11T16:00:00.000Z");
  }, 60_000);

  it("ante dos compras con la misma fecha gana la de id mayor, siempre la misma", async () => {
    const fecha = new Date("2026-08-01T12:00:00Z");
    for (const [id, precio] of [["op-a", 10], ["op-z", 20], ["op-m", 15]] as const) {
      await prisma.operacion.create({ data: { id, sucursalId, proceso: "COMPRA", fecha, usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { id: `mov-${id}`, operacionId: id, productoId: harinaId, seccionId, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: precio, precioPorUnidadStock: precio } });
    }
    for (let i = 0; i < 3; i++) {
      expect((await obtenerCostoActualPorMP(sucursalId, prisma)).get(harinaId)?.precioPorUnidadStock).toBe(20); // mov-op-z
    }
  });
});
