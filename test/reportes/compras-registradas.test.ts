import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { listarComprasRegistradas, SIN_PROVEEDOR, TAMANO_PAGINA_COMPRAS } from "../../src/core/reportes/compras-registradas";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";

/**
 * Listado de compras por factura: qué se compró, a quién, con qué factura, cuándo y por cuánto. Solo lectura.
 */
describe("listarComprasRegistradas", () => {
  let sucursalId: string;
  let seccionId: string;
  let harinaId: string;
  let quesoId: string;
  let provAId: string;
  let provBId: string;

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId)).id;
    quesoId = (await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kg.id }, sucursalId)).id;
    provAId = (await prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Molino A" } })).id;
    provBId = (await prisma.proveedor.create({ data: { codigo: "PRV_B", nombre: "Lácteos B" } })).id;
  });

  async function comprar(fecha: string, proveedorId: string | undefined, nroFactura: string | undefined, items: { productoId: string; cantidad: number; precioTotal?: number }[]) {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: d(fecha), seccionId, proveedorId, nroFactura, items });
    expect(r.ok, r.mensaje).toBe(true);
  }

  it("una fila por factura con sus líneas, el total y quién la cargó; más recientes primero", async () => {
    await comprar("2026-08-01", provAId, "A-0001", [
      { productoId: harinaId, cantidad: 10, precioTotal: 50 },
      { productoId: quesoId, cantidad: 2, precioTotal: 40 },
    ]);
    await comprar("2026-08-05", provBId, "B-0007", [{ productoId: quesoId, cantidad: 5, precioTotal: 100 }]);

    const { items, nextCursor } = await listarComprasRegistradas(sucursalId, undefined, prisma);

    expect(nextCursor).toBeNull();
    expect(items.map((c) => c.nroFactura)).toEqual(["B-0007", "A-0001"]);
    const a = items[1];
    expect(a.proveedorNombre).toBe("Molino A");
    expect(a.cargadaPor).toBe("admin@test.com");
    expect(a.total).toBe(90);
    expect(a.haySinPrecio).toBe(false);
    expect(a.cantidadProductos).toBe(2); // 2 productos distintos, aunque haya más renglones si alguno se repitiera
    expect(a.renglones.map((l) => [l.productoCodigo, l.cantidad, l.unidad, l.precioTotal])).toEqual([
      ["MP_HARINA", 10, "kg", 50],
      ["MP_QUESO", 2, "kg", 40],
    ]);
  });

  it("filtra por proveedor, por «sin proveedor», por fechas y por texto del N.º de factura", async () => {
    await comprar("2026-08-01", provAId, "A-0001", [{ productoId: harinaId, cantidad: 1, precioTotal: 5 }]);
    await comprar("2026-08-05", provBId, "B-0007", [{ productoId: quesoId, cantidad: 1, precioTotal: 20 }]);
    await comprar("2026-08-09", undefined, undefined, [{ productoId: harinaId, cantidad: 1, precioTotal: 6 }]);

    const facturas = async (f: Parameters<typeof listarComprasRegistradas>[1]) => (await listarComprasRegistradas(sucursalId, f, prisma)).items.map((c) => c.nroFactura ?? "(sin)");

    expect(await facturas({ proveedorId: provAId })).toEqual(["A-0001"]);
    expect(await facturas({ proveedorId: SIN_PROVEEDOR })).toEqual(["(sin)"]);
    expect(await facturas({ desde: d("2026-08-04"), hasta: d("2026-08-06") })).toEqual(["B-0007"]);
    expect(await facturas({ factura: "b-00" })).toEqual(["B-0007"]); // sin distinguir mayúsculas
    expect(await facturas({ proveedorId: provAId, factura: "B-" })).toEqual([]);
  });

  it("los límites de fecha son días completos: una compra a las 12:00 UTC entra con `hasta` = ese mismo día (que llega a las 00:00 UTC)", async () => {
    await comprar("2026-08-09", provAId, "A-0001", [{ productoId: harinaId, cantidad: 1, precioTotal: 5 }]); // se guarda a las 12:00Z
    const facturas = async (f: Parameters<typeof listarComprasRegistradas>[1]) => (await listarComprasRegistradas(sucursalId, f, prisma)).items.map((c) => c.nroFactura);

    expect(await facturas({ hasta: new Date("2026-08-09") })).toEqual(["A-0001"]);
    expect(await facturas({ desde: new Date("2026-08-09"), hasta: new Date("2026-08-09") })).toEqual(["A-0001"]);
    expect(await facturas({ hasta: new Date("2026-08-08") })).toEqual([]);
    expect(await facturas({ desde: new Date("2026-08-10") })).toEqual([]);
  });

  it("una compra sin precio en alguna línea lo avisa y no cuenta como si tuviera importe", async () => {
    await comprar("2026-08-01", provAId, "A-0001", [
      { productoId: harinaId, cantidad: 10, precioTotal: 50 },
      { productoId: quesoId, cantidad: 2 },
    ]);
    const [c] = (await listarComprasRegistradas(sucursalId, undefined, prisma)).items;
    expect(c.haySinPrecio).toBe(true);
    expect(c.total).toBe(50);
  });

  it("cuenta un producto DISTINTO una sola vez, aunque tenga dos renglones (dos lotes) en la misma factura", async () => {
    await comprar("2026-08-01", provAId, "A-0001", [
      { productoId: harinaId, cantidad: 5, precioTotal: 25 },
      { productoId: harinaId, cantidad: 5, precioTotal: 25 }, // mismo producto, otro renglón — ej. dos lotes con vencimiento distinto
    ]);
    const [c] = (await listarComprasRegistradas(sucursalId, undefined, prisma)).items;
    expect(c.renglones).toHaveLength(2);
    expect(c.cantidadProductos).toBe(1);
  });

  it("solo lista COMPRAS de la sucursal pedida: ni otros procesos ni otras sucursales", async () => {
    await comprar("2026-08-01", provAId, "A-0001", [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }]);
    await registrarMovimiento({ proceso: "CONSUMO", fecha: d("2026-08-02"), seccionId, items: [{ productoId: harinaId, cantidad: 1 }] });

    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const seccionOtra = await sembrarSeccion(otra.id, "Depósito 2");
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } });
    await prisma.operacion.create({ data: { sucursalId: otra.id, proceso: "COMPRA", fecha: d("2026-08-03"), usuarioId: admin.id, nroFactura: "AJENA-1" } });
    void seccionOtra;

    const { items } = await listarComprasRegistradas(sucursalId, undefined, prisma);
    expect(items.map((c) => c.nroFactura)).toEqual(["A-0001"]);
    expect((await listarComprasRegistradas(otra.id, undefined, prisma)).items.map((c) => c.nroFactura)).toEqual(["AJENA-1"]);
  });

  it("pagina por cursor sin repetir ni saltear compras", async () => {
    const total = TAMANO_PAGINA_COMPRAS + 5;
    for (let i = 0; i < total; i++) {
      await prisma.operacion.create({
        data: { sucursalId, proceso: "COMPRA", fecha: new Date(Date.UTC(2026, 0, 1 + (i % 28))), usuarioId: (await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } })).id, nroFactura: `F-${i}` },
      });
    }
    const p1 = await listarComprasRegistradas(sucursalId, undefined, prisma);
    expect(p1.items).toHaveLength(TAMANO_PAGINA_COMPRAS);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listarComprasRegistradas(sucursalId, { cursor: p1.nextCursor! }, prisma);
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const todas = [...p1.items, ...p2.items].map((c) => c.idOperacion);
    expect(new Set(todas).size).toBe(total);
  });
});

describe("Compras por proveedor (Período) lleva el id del proveedor para enlazar al listado", () => {
  it("cada fila trae su proveedorId, y las compras sin proveedor traen null", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    const prov = await prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Molino A" } });
    const fecha = new Date("2026-08-01T12:00:00Z");
    await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, proveedorId: prov.id, items: [{ productoId: harina.id, cantidad: 1, precioTotal: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId: harina.id, cantidad: 1, precioTotal: 6 }] });

    const rep = await obtenerReportePorPeriodo(sucursalId, new Date("2026-07-30"), new Date("2026-08-05"), undefined, prisma);
    const porNombre = new Map(rep.compras.porProveedor.map((p) => [p.proveedor, p.proveedorId]));
    expect(porNombre.get("Molino A")).toBe(prov.id);
    expect(porNombre.get("Sin proveedor")).toBeNull();
  });
});
