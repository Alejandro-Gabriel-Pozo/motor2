import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico, resolverConteoPendiente, cancelarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * S-04 (plan de endurecimiento de seguridad, tanda T5; informe B, K2): cancelar un conteo físico revertía `conteo.diferencia`, lo que el conteo REGISTRÓ, y no lo que el conteo APLICÓ
 * al stock. Son dos cosas distintas:
 *  - un conteo pendiente resuelto como «resuelto» queda RESUELTO sin tocar el stock (la diferencia se cubrió con un movimiento real): cancelarlo después escribía
 *    `-diferencia`, un ajuste que nunca se había aplicado (stock fantasma);
 *  - un conteo pendiente resuelto con «ajustar» aplica la diferencia contra el saldo de HOY, y `conteo.diferencia` no se actualiza: cancelarlo revertía un monto DISTINTO del aplicado.
 * Arreglo: se revierte exactamente `-Σ cantidad` de los movimientos del Kardex con `conteoFisicoId` = ese conteo (lo que de verdad se aplicó), y la cancelación se audita.
 */
describe("S-04: cancelar un conteo revierte exactamente lo que ese conteo aplicó al stock", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let mpId: string;
  let unidadKgId: string;
  let insumoId: string;

  const saldo = () => calcularSaldoTotal(mpId, seccionId, prisma);
  const conteoDe = (estado?: "PENDIENTE" | "RESUELTO" | "CANCELADO") => prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId, ...(estado ? { estado } : {}) } });

  /** Mueve el stock por fuera del conteo (una venta, una merma, una compra que se carga después): `cantidad` con signo, directo al Kardex. */
  async function moverStock(cantidad: number, proceso: "CONSUMO" | "COMPRA" = cantidad < 0 ? "CONSUMO" : "COMPRA") {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(), usuarioId: adminId } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: mpId, seccionId, proceso, cantidad, detalle: "Movimiento de prueba", precioTotal: 0, precioPorUnidadStock: 0 },
    });
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

  it("un pendiente cerrado como «resuelto» nunca aplicó nada: cancelarlo NO escribe un ajuste fantasma (hoy escribía +3 de Control)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await conteoDe("PENDIENTE");
    expect(Number(conteo.diferencia)).toBe(-3);
    expect((await resolverConteoPendiente(conteo.id, "resuelto")).ok).toBe(true);
    const movimientosAntes = await prisma.movimientoStock.count();

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(10); // hoy 13: se inventaban 3 unidades que nunca existieron
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
    expect(await prisma.operacion.count({ where: { proceso: "CONTROL" } })).toBe(0);
    expect((await conteoDe()).estado).toBe("CANCELADO");
    expect(r.mensaje).toContain("No había aplicado ningún ajuste");
  });

  it("un pendiente cerrado con «ajustar» aplicó la diferencia contra el saldo de HOY (-1), no la del conteo (-3): cancelarlo revierte +1 (hoy revertía +3)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await conteoDe("PENDIENTE");
    expect(Number(conteo.diferencia)).toBe(-3);
    await moverStock(-2); // entre medio salieron 2: el saldo de hoy es 8
    expect(await saldo()).toBe(8);
    expect((await resolverConteoPendiente(conteo.id, "ajustar")).ok).toBe(true);
    expect(await saldo()).toBe(7); // se aplicó -1
    expect(Number((await conteoDe()).diferencia)).toBe(-3); // el conteo sigue diciendo -3

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(8); // vuelve al saldo de antes del ajuste (hoy 10: sobraban 2)
    const reversion = await prisma.movimientoStock.findMany({ where: { conteoFisicoId: conteo.id }, orderBy: { creadoEn: "asc" } });
    expect(reversion.map((m) => Number(m.cantidad))).toEqual([-1, 1]);
  });

  it("lo mismo con un sobrante: se contaron 5 de más, entró una compra de 3, «ajustar» aplicó +2; cancelar revierte -2 (hoy revertía -5)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await conteoDe("PENDIENTE");
    await moverStock(3); // saldo de hoy: 13
    expect((await resolverConteoPendiente(conteo.id, "ajustar")).ok).toBe(true);
    expect(await saldo()).toBe(15); // se aplicó +2

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(13); // hoy 10
  });

  it("la reversión conserva el lote del conteo", async () => {
    const lote = new Date(Date.now() + 30 * 24 * 3_600_000);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 4, loteVencimiento: lote }] });
    await registrarConteoFisico({ productoId: mpId, seccionId, loteVencimiento: lote, conteoReal: 1, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteo = await conteoDe();
    expect(await saldo()).toBe(11); // 10 sin lote + 1 del lote

    expect((await cancelarConteoFisico(conteo.id)).ok).toBe(true);

    expect(await saldo()).toBe(14);
    const lineas = await prisma.movimientoStock.findMany({ where: { conteoFisicoId: conteo.id } });
    expect(lineas).toHaveLength(2);
    expect(lineas.every((m) => m.loteVencimiento?.toISOString().slice(0, 10) === lote.toISOString().slice(0, 10))).toBe(true);
  });

  it("control: un AJUSTAR común se revierte exacto, y una segunda cancelación falla sin escribir nada", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteo = await conteoDe();
    expect(await saldo()).toBe(7);

    expect((await cancelarConteoFisico(conteo.id)).ok).toBe(true);
    expect(await saldo()).toBe(10);
    const movimientos = await prisma.movimientoStock.count();

    const otra = await cancelarConteoFisico(conteo.id);
    expect(otra.ok).toBe(false);
    expect(await prisma.movimientoStock.count()).toBe(movimientos);
  });

  it("control: un conteo sin diferencia (el stock ya coincidía) se cancela como siempre, sin tocar el stock", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 10, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteo = await conteoDe();
    const movimientosAntes = await prisma.movimientoStock.count();

    const r = await cancelarConteoFisico(conteo.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo()).toBe(10);
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
    expect((await conteoDe()).estado).toBe("CANCELADO");
  });

  it("un conteo PENDIENTE o DESCARTADO sigue sin poder cancelarse (nunca aplicó nada)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
    for (const c of await prisma.conteoFisico.findMany({ where: { productoId: mpId } })) {
      expect((await cancelarConteoFisico(c.id)).ok, c.estado).toBe(false);
    }
    expect(await saldo()).toBe(10);
  });

  describe("la cancelación se audita (hoy no dejaba ninguna fila)", () => {
    const filas = () => prisma.registroAuditoria.findMany({ where: { entidad: "ConteoFisico", campo: "estado" } });

    it("cancelar un AJUSTAR deja una fila RESUELTO → CANCELADO con el ajuste revertido, el actor y la sucursal", async () => {
      await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
      const conteo = await conteoDe();
      expect(await filas()).toHaveLength(0);

      expect((await cancelarConteoFisico(conteo.id)).ok).toBe(true);

      const auditoria = await filas();
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ entidadId: conteo.id, valorAnterior: "RESUELTO", valorNuevo: "CANCELADO", actorId: adminId, sucursalId });
      expect(auditoria[0].descripcion).toContain("Yerba");
      expect(auditoria[0].descripcion).toContain("se revirtió el ajuste de -3");
    });

    it("cancelar un «resuelto» (que nunca aplicó nada) también deja su fila, y dice que no se tocó el stock", async () => {
      await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
      const conteo = await conteoDe("PENDIENTE");
      await resolverConteoPendiente(conteo.id, "resuelto");

      expect((await cancelarConteoFisico(conteo.id)).ok).toBe(true);

      const auditoria = await filas();
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0].descripcion).toContain("no se tocó el stock");
    });

    it("una cancelación rechazada no deja fila", async () => {
      await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
      expect((await cancelarConteoFisico((await conteoDe()).id)).ok).toBe(false);
      expect(await filas()).toHaveLength(0);
    });
  });
});
