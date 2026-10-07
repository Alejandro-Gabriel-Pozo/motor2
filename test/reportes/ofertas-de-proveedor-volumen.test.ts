import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, vaciarOperacionesPorVolumen, analizarDespuesDeCargaMasiva, prisma } from "../setup/test-db";
import { cargarOfertasDeProveedores, cargarProductosConProveedor } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";

/**
 * Las ofertas por proveedor se DERIVAN del Kardex vigente (Pureza Fase 4, vínculo proveedor↔producto, parte 2): una consulta con `DISTINCT ON` sobre TODAS las compras de la empresa, igual
 * que el costo de reposición. Con decenas de miles de compras tiene que devolver una fila por (producto, proveedor) —no una por compra— y en un tiempo razonable (no hay un límite de
 * parámetros que reventar porque no se trae la historia: el agrupamiento lo hace la base). Se siembra el volumen directo con SQL, sin pasar por la aplicación.
 */
describe("ofertas de proveedor con mucha historia", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  const productos: string[] = [];
  const proveedores: string[] = [];

  afterEach(vaciarOperacionesPorVolumen);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    productos.length = 0;
    proveedores.length = 0;
    for (let i = 0; i < 3; i++) productos.push((await prisma.producto.create({ data: { codigo: `MP_${i}`, nombre: `Insumo ${i}`, tipo: "MP", unidadStockId: catalogo.kg.id } })).id);
    for (let i = 0; i < 2; i++) proveedores.push((await prisma.proveedor.create({ data: { codigo: `PRV_${i}`, nombre: `Proveedor ${i}` } })).id);
  });

  it("60.000 compras → una fila por par (producto, proveedor), con el precio y la fecha de la más reciente, en pocos segundos", async () => {
    const CANTIDAD = 60_000;
    // g = 1..60000; el producto y el proveedor rotan; el precio sube con g (la última compra de cada par es la de g más grande); una de cada 7 va a $0 (nunca debe ser «el precio»).
    await prisma.$executeRaw`
      INSERT INTO "Operacion" ("id", "sucursalId", "proceso", "fecha", "usuarioId", "proveedorId")
      SELECT 'v' || g, ${sucursalId}, 'COMPRA'::"Proceso", '2023-01-01'::timestamp + (g || ' minutes')::interval, ${adminId}, (${proveedores}::text[])[1 + (g % 2)]
      FROM generate_series(1, ${CANTIDAD}::int) g`;
    await prisma.$executeRaw`
      INSERT INTO "MovimientoStock" ("id", "operacionId", "productoId", "seccionId", "proceso", "cantidad", "detalle", "precioTotal", "precioPorUnidadStock")
      SELECT 'vm' || g, 'v' || g, (${productos}::text[])[1 + (g % 3)], ${seccionId}, 'COMPRA'::"Proceso", 1, 'Compra', CASE WHEN g % 7 = 0 THEN 0 ELSE g END, CASE WHEN g % 7 = 0 THEN 0 ELSE g END
      FROM generate_series(1, ${CANTIDAD}::int) g`;
    await analizarDespuesDeCargaMasiva();

    const t0 = Date.now();
    const ofertas = await cargarOfertasDeProveedores(prisma);
    const ms = Date.now() - t0;

    expect(ofertas).toHaveLength(6); // 3 productos × 2 proveedores (g % 3 y g % 2 cubren las 6 combinaciones)
    expect(ofertas.every((o) => o.precioPorUnidadStock > 0)).toBe(true);
    // El precio de cada par es el de su compra más reciente con precio: g más grande con ese par, que no sea múltiplo de 7.
    for (const o of ofertas) {
      const pi = productos.indexOf(o.productoId);
      const vi = proveedores.indexOf(o.proveedorId);
      let g = CANTIDAD;
      while (!(g % 3 === pi && g % 2 === vi && g % 7 !== 0)) g--;
      expect(o.precioPorUnidadStock, `${pi}|${vi}`).toBe(g);
    }
    expect((await cargarProductosConProveedor(prisma)).size).toBe(3);
    expect(ms, `la derivación tardó ${ms} ms`).toBeLessThan(5_000);
  }, 120_000);
});
