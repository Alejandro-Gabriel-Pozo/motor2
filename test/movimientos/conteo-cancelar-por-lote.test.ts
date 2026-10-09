import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico, cancelarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * Cancelar un conteo de UN lote con un conteo posterior de OTRO lote (M-2 afinada por el dueño): son independientes, así que no frena. Frena, como siempre, lo posterior del MISMO lote y todo
 * conteo «Todos los lotes» (sin lote), que reconcilió el total, y un conteo total que se quiere cancelar con cualquier conteo posterior del par.
 */
describe("M-2 por lote: cancelar un conteo de un lote solo lo frena lo posterior de ese lote o del total", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  const dia = (n: number) => new Date(Date.now() + n * 24 * 3_600_000);
  const loteA = dia(30);
  const loteB = dia(60);

  const saldo = () => calcularSaldoTotal(mpId, seccionId, prisma);
  const conteos = () => prisma.conteoFisico.findMany({ where: { productoId: mpId }, orderBy: { creadoEn: "asc" } });
  async function contar(conteoReal: number, loteVencimiento?: Date) {
    const r = await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal, ...(loteVencimiento ? { loteVencimiento } : {}), fechaConteo: new Date(), accion: "AJUSTAR" });
    expect(r.ok, r.mensaje).toBe(true);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10, loteVencimiento: loteA }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 6, loteVencimiento: loteB }] });
  });

  it("EL CASO: contar el lote A (−2) y después el lote B (−1): cancelar el conteo de A se permite y no toca a B", async () => {
    await contar(8, loteA); // ajusta −2: saldo 14
    await contar(5, loteB); // ajusta −1: saldo 13
    const [deA, deB] = await conteos();
    expect(await saldo()).toBe(13);

    const r = await cancelarConteoFisico(deA.id);

    expect(r.ok, r.mensaje).toBe(true); // antes se rechazaba (CONTEO_POSTERIOR) por mirar solo producto y sección
    expect(await saldo()).toBe(15); // se devolvieron los 2 de A; los de B siguen
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: deB.id } })).estado).toBe("RESUELTO");
  });

  it("un conteo posterior del MISMO lote sí frena la cancelación", async () => {
    await contar(8, loteA);
    await contar(8, loteA);
    const [primero] = await conteos();
    const r = await cancelarConteoFisico(primero.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
    expect(await saldo()).toBe(14);
  });

  it("un conteo posterior «Todos los lotes» (sin lote) también frena: reconcilió el total, que incluye al lote A", async () => {
    await contar(8, loteA); // saldo 14
    await contar(14); // sin lote = total: coincide, sin movimiento
    const [deA] = await conteos();
    const r = await cancelarConteoFisico(deA.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
  });

  it("cancelar un conteo «Todos los lotes» se frena con CUALQUIER conteo posterior de un lote", async () => {
    await contar(15); // total 16 → 15: ajusta −1 sin lote
    await contar(10, loteA);
    const [total] = await conteos();
    const r = await cancelarConteoFisico(total.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("No se puede cancelar este conteo");
  });
});
