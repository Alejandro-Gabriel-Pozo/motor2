import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularVenta, registrarVenta } from "../../src/server/actions/movimientos/venta";
import { listarRegistrosAuditoria } from "../../src/core/permisos/auditoria";
import { registrarVentaEnTx } from "../../src/core/movimientos/registrar-venta";

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

    const { items } = await listarRegistrosAuditoria({ entidad: "Operacion", incluirFilasDeEmpresa: true, sucursalIds: [sucursalId] }, prisma);
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

/** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, D4, paso 9): anular un componente de una promo ya cobrada
 *  anula TODOS sus hermanos juntos, nunca uno suelto. */
describe("anularVenta: D4 — anula a los hermanos de la misma promo", () => {
  let sucursalId: string;
  let sucursalNombre: string;
  let seccionId: string;
  let adminId: string;
  let gaseosaId: string;
  let empanadaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalNombre = base.sucursal.nombre;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
    gaseosaId = (await sembrarProductoDisponible({ codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: kg.id, precioVenta: 500 }, sucursalId)).id;
    empanadaId = (await sembrarProductoDisponible({ codigo: "PV_EMPA", nombre: "Empanada", tipo: "PV", unidadStockId: kg.id, precioVenta: 700 }, sucursalId)).id;
  });

  async function venderPromoDeDosComponentes() {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: adminId } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús D4" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 1000 } });
    const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 1000, titulo: "Menú del día", creadoPorId: adminId } });

    const actor = { usuarioId: adminId, sucursalId, sucursalNombre };
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, actor, {
        fecha: new Date("2026-08-06T12:00:00Z"),
        origen: { tipo: "seccion" as const, seccionId },
        lineas: [
          { productoId: gaseosaId, cantidadVendida: 1, promoCuentaId: promoCuenta.id },
          { productoId: empanadaId, cantidadVendida: 1, promoCuentaId: promoCuenta.id },
        ],
      })
    );
    if (!r.ok) throw new Error(r.mensaje);
    return r.operacionIds;
  }

  it("anular UN componente anula el otro también, cada uno con su propia Operacion AJUSTE y fila de auditoría", async () => {
    const [opGaseosa, opEmpanada] = await venderPromoDeDosComponentes();

    const r = await anularVenta(opGaseosa);
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("2 componentes");

    const [gaseosaAnulada, empanadaAnulada] = await Promise.all([
      prisma.operacion.findUniqueOrThrow({ where: { id: opGaseosa } }),
      prisma.operacion.findUniqueOrThrow({ where: { id: opEmpanada } }),
    ]);
    expect(gaseosaAnulada.anuladaEn).not.toBeNull();
    expect(empanadaAnulada.anuladaEn).not.toBeNull();

    // Dos Operaciones AJUSTE de reversión, una por componente (no una sola compartida).
    const ajustes = await prisma.operacion.findMany({ where: { proceso: "AJUSTE", sucursalId } });
    expect(ajustes).toHaveLength(2);

    // Una fila de auditoría por cada Operacion anulada.
    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: { in: [opGaseosa, opEmpanada] } } });
    expect(auditoria).toHaveLength(2);

    // El stock de los dos componentes quedó revertido (venta PV sin receta: solo la fila VENTA, -1 cada una, ya revertida).
    const saldoGaseosa = await prisma.movimientoStock.aggregate({ where: { productoId: gaseosaId }, _sum: { cantidad: true } });
    expect(Number(saldoGaseosa._sum.cantidad ?? 0)).toBe(0);
  });

  it("anular el otro componente primero da el mismo resultado (no importa cuál se elija)", async () => {
    const [opGaseosa, opEmpanada] = await venderPromoDeDosComponentes();
    const r = await anularVenta(opEmpanada);
    expect(r.ok).toBe(true);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: opGaseosa } })).anuladaEn).not.toBeNull();
  });

  it("anular una promo ya anulada rechaza sin duplicar nada", async () => {
    const [opGaseosa] = await venderPromoDeDosComponentes();
    await anularVenta(opGaseosa);
    const otra = await anularVenta(opGaseosa);
    expect(otra.ok).toBe(false);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(2);
  });

  it("una venta suelta (sin promoCuentaId) sigue anulando SOLO esa Operacion, como siempre", async () => {
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: gaseosaId, cantidadVendida: 1 }] });
    expect(r.ok).toBe(true);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    const anulacion = await anularVenta(venta.id);
    expect(anulacion.ok).toBe(true);
    expect(anulacion.mensaje).not.toContain("componentes");
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
  });
});
