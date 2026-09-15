import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarConteoFisico, resolverConteoPendiente, cancelarConteoFisico } from "../../src/server/actions/conteo-fisico";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("Conteo Físico", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Yerba", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    mpId = mp.id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  it("AJUSTAR escribe el movimiento de corrección y el saldo queda en lo contado", async () => {
    const resultado = await registrarConteoFisico({
      productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR",
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(7);

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("RESUELTO");
    expect(Number(conteo.diferencia)).toBe(-3);
  });

  it("FALTA_MOVIMIENTO no toca el stock y queda PENDIENTE", async () => {
    const resultado = await registrarConteoFisico({
      productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO",
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10); // sin cambios

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("PENDIENTE");
  });

  it("DESCARTAR no toca el stock y no cuenta como conteo válido", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10);

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("DESCARTADO");
  });

  it("diferencia 0 queda RESUELTO aunque la acción elegida no ajuste", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 10, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("RESUELTO");
  });

  it("resolverConteoPendiente('resuelto') cierra sin tocar stock", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    const resultado = await resolverConteoPendiente(conteo.id, "resuelto");
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10);
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteo.id } })).estado).toBe("RESUELTO");
  });

  it("resolverConteoPendiente('ajustar') ajusta contra el saldo de HOY, no el del día del conteo", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    // Entre medio se cargó otra Compra — el saldo de "hoy" ya no es el de cuando se contó.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 3 }] });

    const resultado = await resolverConteoPendiente(conteo.id, "ajustar");
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(15); // 13 (10+3) + ajuste de 2 = 15
  });

  it("cancelarConteoFisico revierte exactamente el ajuste, y una segunda cancelación falla", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(7);

    const cancelado = await cancelarConteoFisico(conteo.id);
    expect(cancelado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10); // vuelve al saldo de antes del ajuste

    const segundaCancelacion = await cancelarConteoFisico(conteo.id);
    expect(segundaCancelacion.ok).toBe(false);
  });

  it("cancelarConteoFisico rechaza un conteo que nunca ajustó nada (Pendiente/Descartado)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    const resultado = await cancelarConteoFisico(conteo.id);
    expect(resultado.ok).toBe(false);
  });
});
