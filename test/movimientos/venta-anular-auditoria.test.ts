import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularVenta, registrarVenta } from "../../src/server/actions/movimientos/venta";
import { listarRegistrosAuditoria } from "../../src/core/permisos/auditoria";

/** `anularVenta` deja rastro en la auditoría administrativa, igual que `anularCompra`. */
describe("anularVenta: auditoría", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let panId: string;

  async function vender(nroFactura?: string) {
    const r = await registrarVenta({ fecha: new Date("2026-08-06T12:00:00Z"), seccionId, nroFactura, ventas: [{ productoId: panId, cantidadVendida: 1 }] });
    expect(r.ok, r.mensaje).toBe(true);
    return prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" }, orderBy: { creadoEn: "desc" } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    panId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId)).id;
    await prisma.recetaVersion.create({ data: { productoId: panId, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 1, unidadId: kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00Z"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 50 }] });
  });

  it("anular una venta deja UNA fila de auditoría con quién, cuándo y de cuál", async () => {
    const venta = await vender("F-100");

    const r = await anularVenta(venta.id);
    expect(r.ok, r.mensaje).toBe(true);

    const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: venta.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ campo: "anuladaEn", valorAnterior: null, actorId: adminId, sucursalId });
    expect(filas[0].valorNuevo).not.toBeNull();
    expect(filas[0].descripcion).toContain("Venta del 2026-08-06");
    expect(filas[0].descripcion).toContain("F-100");
    // La fecha de la fila coincide con la marca de anulación de la propia venta.
    const anulada = await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } });
    expect(filas[0].valorNuevo).toBe(anulada.anuladaEn!.toISOString());
  });

  it("aparece en el listado de la pantalla de auditoría, filtrando por la entidad Operación", async () => {
    const venta = await vender();
    await anularVenta(venta.id);

    const { items } = await listarRegistrosAuditoria({ entidad: "Operacion" });
    expect(items.map((f) => f.entidadId)).toContain(venta.id);
  });

  it("una anulación rechazada (ya estaba anulada) no deja una segunda fila", async () => {
    const venta = await vender();
    await anularVenta(venta.id);
    const otra = await anularVenta(venta.id);

    expect(otra.ok).toBe(false);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: venta.id } })).toBe(1);
  });

  it("una anulación que falla no deja rastro en la auditoría (la fila se escribe dentro de la misma transacción)", async () => {
    const r = await anularVenta("no-existe");
    expect(r.ok).toBe(false);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });
});
