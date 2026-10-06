import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, vaciarOperacionesPorVolumen, analizarDespuesDeCargaMasiva, prisma } from "../setup/test-db";
import { obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";

/**
 * El historial de un producto sin rango de fechas devuelve todos sus eventos: con ~60k movimientos la versión anterior (`findMany` con
 * `include` de sección, operación y proveedor) superaba el límite de parámetros de Prisma 7. El volumen se siembra directo con SQL.
 */
describe("obtenerHistorialProducto con decenas de miles de movimientos", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let azucarId: string;

  afterEach(vaciarOperacionesPorVolumen);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    azucarId = (await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
  });

  it("devuelve todos los eventos con su saldo corriente, sección, proveedor, anulación y sustituto", async () => {
    const total = 60_000;
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } });
    // 60.000 compras de 1 kg de harina, una por minuto (la 2 es un consumo de 1 kg que sustituye a azúcar: solo un CONSUMO puede sustituir); las compras 1..30.000 con proveedor; las 59.001..60.000 anuladas.
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId", "proveedorId", "nroFactura", "anuladaEn")
      SELECT 'h' || g, ${sucursalId}, 'COMPRA'::"Proceso", '2026-01-01T00:00:00'::timestamp + (g || ' minutes')::interval, ${adminId},
             CASE WHEN g <= 30000 THEN ${proveedor.id} END, CASE WHEN g = 1 THEN 'A-1' END,
             CASE WHEN g > 59000 THEN '2026-06-01T00:00:00'::timestamp END
      FROM generate_series(1, ${total}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle", "precioTotal", "precioPorUnidadStock", "sustituyeAProductoId")
      SELECT 'hm' || g, 'h' || g, ${harinaId}, ${seccionId}, CASE WHEN g = 2 THEN 'CONSUMO' ELSE 'COMPRA' END::"Proceso", CASE WHEN g = 2 THEN -1 ELSE 1 END, 'Compra', 10, 10, CASE WHEN g = 2 THEN ${azucarId} END
      FROM generate_series(1, ${total}::int) g`;
    // Un movimiento de OTRO producto no aparece.
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId") VALUES ('otro', ${sucursalId}, 'COMPRA'::"Proceso", '2026-01-01T00:00:00'::timestamp, ${adminId})`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle") VALUES ('otrom', 'otro', ${azucarId}, ${seccionId}, 'COMPRA'::"Proceso", 5, 'Compra')`;

    await analizarDespuesDeCargaMasiva();
    const historial = await obtenerHistorialProducto(sucursalId, harinaId, undefined, undefined, undefined, prisma);

    expect(historial).not.toBeNull();
    expect(historial).toMatchObject({ producto: "Harina", saldoActual: total - 2, totalMovimientos: total, totalConteos: 0, unidadStockNombre: "kg" });
    expect(historial!.eventos).toHaveLength(total);
    const [primero, segundo] = historial!.eventos;
    expect(primero).toMatchObject({ tipo: "movimiento", seccionNombre: "Cocina", proveedorNombre: "Molino", nroFactura: "A-1", saldoCorriente: 1, anulada: false, sustituyeANombre: null, idOperacion: "h1" });
    expect(segundo).toMatchObject({ sustituyeANombre: "Azúcar", saldoCorriente: 0 });
    const ultimo = historial!.eventos.at(-1)!;
    expect(ultimo).toMatchObject({ idOperacion: `h${total}`, saldoCorriente: total - 2, anulada: true, proveedorNombre: null });
    expect(historial!.eventos.filter((e) => e.anulada)).toHaveLength(1000);

    // Con rango: el saldo corriente arranca del acumulado anterior a `desde`.
    const acotado = await obtenerHistorialProducto(sucursalId, harinaId, undefined, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), prisma);
    expect(acotado!.totalMovimientos).toBe(total);
    expect(acotado!.eventos.length).toBe(1440); // minutos del 2026-02-01
    expect(acotado!.eventos[0].saldoCorriente).toBe(44_638); // el evento 44.640 cae en 2026-02-01T00:00 exacto: 44.639 anteriores + él, menos el consumo de 1 kg del evento 2 (2 kg netos)
  }, 120_000);

  it("no mezcla los movimientos del mismo producto en otra sucursal y respeta el filtro de sección", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otra.id, "Otra sección");
    const segundaSeccion = await sembrarSeccion(sucursalId, "Barra");
    for (const [id, sucId, secId, cantidad] of [
      ["op-1", sucursalId, seccionId, 3],
      ["op-2", sucursalId, segundaSeccion.id, 4],
      ["op-3", otra.id, otraSeccion.id, 100],
    ] as const) {
      await prisma.operacion.create({ data: { id, sucursalId: sucId, proceso: "COMPRA", fecha: new Date("2026-03-01T12:00:00Z"), usuarioId: adminId } });
      await prisma.movimientoStock.create({ data: { operacionId: id, productoId: harinaId, seccionId: secId, proceso: "COMPRA", cantidad, detalle: "Compra" } });
    }

    const todas = await obtenerHistorialProducto(sucursalId, harinaId, undefined, undefined, undefined, prisma);
    expect(todas!.eventos.map((e) => e.seccionNombre).sort()).toEqual(["Barra", "Cocina"]);
    expect(todas!.saldoActual).toBe(7);
    const soloBarra = await obtenerHistorialProducto(sucursalId, harinaId, segundaSeccion.id, undefined, undefined, prisma);
    expect(soloBarra!.eventos.map((e) => e.seccionNombre)).toEqual(["Barra"]);
  });
});
