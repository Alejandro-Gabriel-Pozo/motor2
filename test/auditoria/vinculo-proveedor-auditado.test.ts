import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";

/**
 * El precio del vínculo proveedor↔producto (`ProveedorPorProducto.precioPorUnidadStock`) lo escribe un `$executeRaw` dentro de la compra. Decisión del dueño (2026-10-08): ese cambio de
 * plata se AUDITA (trabajo 1.10 de la rama `pureza-integracion`): una fila `ProveedorPorProducto` en el registro de auditoría cuando el precio cambia (o el par es nuevo), con el precio
 * anterior y el nuevo, de quien compró y en su sucursal. Una compra que no cambia el precio —el mismo, o de fecha atrasada, que el SQL no deja pisar— no deja fila.
 */
describe("la compra audita el cambio de precio del vínculo proveedor↔producto", () => {
  let sucursalId: string;
  let seccionId: string;
  let productoId: string;
  let proveedorId: string;
  let adminId: string;

  const comprar = (fecha: string, precioTotal: number, cantidad = 10) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: new Date(fecha), seccionId, proveedorId, items: [{ productoId, cantidad, precioTotal }] });
  const filas = () => prisma.registroAuditoria.findMany({ where: { entidad: "ProveedorPorProducto" }, orderBy: { creadoEn: "asc" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    await sembrarMotivosYDestinos();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    productoId = (await sembrarProductoDisponible({ codigo: "MP_ACEITE_AUD", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_AUD", nombre: "Distribuidora Aud" } })).id;
  });

  it("la primera compra (el par es nuevo): precio anterior null → el de la compra, de quien compró y en su sucursal", async () => {
    expect((await comprar("2026-09-10", 1000)).ok).toBe(true); // 1000 / 10 = 100 por unidad de stock
    const f = await filas();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ campo: "precioPorUnidadStock", valorAnterior: null, valorNuevo: "100", actorId: adminId, sucursalId });
    expect(f[0].descripcion).toContain('"Aceite"');
    expect(f[0].descripcion).toContain('"Distribuidora Aud"');
    expect(f[0].entidadId.startsWith(`${productoId}:${proveedorId}:`)).toBe(true);
  });

  it("una compra con otro precio deja una fila nueva con el anterior y el nuevo", async () => {
    await comprar("2026-09-10", 1000);
    await comprar("2026-09-20", 1200); // 120 por unidad
    const f = await filas();
    expect(f).toHaveLength(2);
    expect(f[1]).toMatchObject({ valorAnterior: "100", valorNuevo: "120" });
  });

  it("una compra al mismo precio no deja fila (no cambió nada)", async () => {
    await comprar("2026-09-10", 1000);
    await comprar("2026-09-20", 2000, 20); // 100 por unidad otra vez
    expect(await filas()).toHaveLength(1);
  });

  it("una compra de fecha atrasada no pisa el precio y por lo tanto no deja fila", async () => {
    await comprar("2026-09-20", 1200);
    await comprar("2026-08-01", 800); // la factura vieja, cargada hoy: el SQL no la deja pisar
    const f = await filas();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ valorNuevo: "120" });
  });

  it("una compra rechazada (stock o validación) no deja fila: la auditoría va en la misma transacción", async () => {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-10"), seccionId, proveedorId: "no-existe", items: [{ productoId, cantidad: 10, precioTotal: 1000 }] });
    expect(r.ok).toBe(false);
    expect(await filas()).toHaveLength(0);
  });
});
