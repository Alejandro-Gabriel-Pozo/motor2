import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico, resolverConteoPendiente, cancelarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * M-2 / D7 (auditoría final; decisión del dueño del 2026-10-08, la misma regla que ya cumple `anularVenta`): un conteo físico NO se cancela si después hubo OTRO conteo (con o sin movimiento) o un
 * ajuste del mismo producto en la misma sección. El escenario que se cerraba: el conteo 1 ajusta -5 (10 → 5), el conteo 2 confirma que quedan 5, y se cancelaba el 1: la reversión devolvía +5 y el
 * saldo quedaba en 10 contra 5 físicos, aunque el conteo 2 había confirmado 5.
 */
describe("M-2: cancelar un conteo con otro posterior se rechaza (CONTEO_POSTERIOR)", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let mpId: string;
  let unidadKgId: string;
  let insumoId: string;

  const saldo = () => calcularSaldoTotal(mpId, seccionId, prisma);
  const conteos = () => prisma.conteoFisico.findMany({ where: { productoId: mpId }, orderBy: { creadoEn: "asc" } });

  async function contar(conteoReal: number, accion: "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR" = "AJUSTAR") {
    const r = await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal, fechaConteo: new Date(), accion });
    expect(r.ok, r.mensaje).toBe(true);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mpId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Yerba", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId)).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  it("el escenario de la auditoría: conteo 1 ajusta -5, conteo 2 confirma 5; cancelar el 1 se rechaza y el saldo sigue en 5 (antes volvía a 10 contra 5 físicos)", async () => {
    await contar(5); // ajusta -5: saldo 5
    await contar(5); // el stock ya coincide: RESUELTO sin movimiento
    const [primero, segundo] = await conteos();
    expect(await saldo()).toBe(5);
    const movimientosAntes = await prisma.movimientoStock.count();
    const auditoriaAntes = await prisma.registroAuditoria.count();

    const r = await cancelarConteoFisico(primero.id);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(
      "No se puede cancelar este conteo: después de hacerse hubo otro conteo físico o un ajuste de stock de Yerba (Depósito), y cancelarlo ahora desharía a ciegas un stock que ya se reconcilió. Corregí la diferencia con un ajuste de stock.",
    );
    expect(await saldo()).toBe(5);
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
    expect(await prisma.registroAuditoria.count()).toBe(auditoriaAntes);
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: primero.id } })).estado).toBe("RESUELTO");
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: segundo.id } })).estado).toBe("RESUELTO");
  });

  it.each([
    ["«Falta movimiento» (queda pendiente)", "FALTA_MOVIMIENTO"],
    ["«Descartar»", "DESCARTAR"],
  ] as const)("un conteo posterior %s, que no escribió ningún movimiento, también frena la cancelación", async (_nombre, accion) => {
    await contar(5);
    await contar(2, accion);
    const [primero] = await conteos();
    const r = await cancelarConteoFisico(primero.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
    expect(await saldo()).toBe(5);
  });

  it("un pendiente ANTERIOR cerrado con «ajustar» DESPUÉS (su línea de Kardex es posterior al conteo) también frena la cancelación", async () => {
    await contar(8, "FALTA_MOVIMIENTO"); // pendiente, no toca el stock
    await contar(5); // conteo 2: ajusta -5
    const [pendiente, aplicado] = await conteos();
    // se cierra el pendiente (más viejo) con «ajustar» ahora: su línea de Kardex nace DESPUÉS del conteo 2
    expect((await resolverConteoPendiente(pendiente.id, "ajustar")).ok).toBe(true);

    const r = await cancelarConteoFisico(aplicado.id);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
  });

  it("un ajuste manual de stock posterior (proceso AJUSTE) frena la cancelación", async () => {
    await contar(5);
    const [conteo] = await conteos();
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: adminId, detalleLibre: "Ajuste de inventario" } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: mpId, seccionId, proceso: "AJUSTE", cantidad: 1, detalle: "Ajuste manual", precioTotal: 0, precioPorUnidadStock: 0 } });

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
    expect(await saldo()).toBe(6);
  });

  it("control: el conteo MÁS RECIENTE se cancela (y el anterior queda libre apenas el posterior se cancela)", async () => {
    await contar(5);
    await contar(5);
    const [primero, segundo] = await conteos();

    expect((await cancelarConteoFisico(primero.id)).ok).toBe(false);
    expect((await cancelarConteoFisico(segundo.id)).ok).toBe(true); // el último no tiene posterior
    const r = await cancelarConteoFisico(primero.id); // el posterior ya está cancelado: no cuenta
    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(10);
  });

  it("control: un conteo de OTRO producto, una compra o un consumo posteriores no frenan la cancelación", async () => {
    await contar(5);
    const [conteo] = await conteos();
    const otroId = (await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId)).id;
    await registrarConteoFisico({ productoId: otroId, seccionId, conteoReal: 1, fechaConteo: new Date(), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 2 }] });

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(12);
  });
});
