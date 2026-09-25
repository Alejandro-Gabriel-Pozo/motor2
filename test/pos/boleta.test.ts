import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { anularItemEnviado, cerrarCuenta, liberarMesa } from "../../src/server/actions/pos/cuenta";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { BOLETAS_RECIENTES_POR_MESA, obtenerBoletasRecientes } from "../../src/core/pos/boleta";

/**
 * Boleta de cierre (src/core/pos/boleta.ts, docs/plan-imprimir-comanda-y-boleta-2026-09-25.md B5/B8): derivada de la cuenta cerrada con
 * las acciones reales, contra Postgres. Sus líneas y su total son exactamente la venta que registró `cerrarCuenta`.
 */
describe("obtenerBoletasRecientes", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

  /** Una cuenta enviada a cocina y cerrada con venta en la mesa 4. */
  async function cerrarUna(cantidad: number) {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id, s.seccion.id)).ok).toBe(true);
    return cuenta;
  }

  it("con anulación parcial y el mismo producto a dos precios: las líneas son las Operaciones VENTA registradas y el total el del cierre", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2 },
    ]);
    const [mila, flan] = cuenta.items;
    expect((await anularItemEnviado(mila.id, 1, "Una menos", 3)).ok).toBe(true);
    expect((await anularItemEnviado(flan.id, 1, "No quiso postre", 1)).ok).toBe(true);

    const cierre = await cerrarCuenta(cuenta.id, s.seccion.id);
    expect(cierre.ok).toBe(true);

    const [boleta, ...otras] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
    expect(otras).toEqual([]);
    expect(boleta).toMatchObject({ cuentaId: cuenta.id, mesero: "admin", total: 27500, ventaAnulada: false });
    expect(boleta.lineas).toEqual([
      { producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 },
      { producto: "Milanesa", cantidad: 1, precioUnitario: 9500, subtotal: 9500 },
    ]);
    // El flan anulado entero no se vendió: no aparece.
    expect(boleta.lineas.some((l) => l.producto === "Flan")).toBe(false);

    const vendidas = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA", operacion: { detalleLibre: "Mesa 4" } } });
    expect(vendidas.map((m) => [-Number(m.cantidad), Number(m.precioPorUnidadStock), Number(m.precioTotal)]).sort()).toEqual(
      boleta.lineas.map((l) => [l.cantidad, l.precioUnitario, l.subtotal]).sort()
    );
    expect(cierre.mensaje).toContain(MONEDA.format(boleta.total));
    const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
    expect(boleta.cerradaEn).toEqual(cerrada.cerradaEn);
  });

  it("una cuenta liberada sin ítems y una cerrada sin venta (todo anulado) no tienen boleta", async () => {
    const vacia = await sembrarCuenta(s.mesa.id, s.admin.id);
    expect((await liberarMesa(vacia.id)).ok).toBe(true);
    const anulada = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await anularItemEnviado(anulada.items[0].id, 1, "Se fue", 1)).ok).toBe(true);
    expect(await cerrarCuenta(anulada.id, s.seccion.id)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar." });

    expect(await obtenerBoletasRecientes(s.sucursalId, s.mesa.id)).toEqual([]);
  });

  it(`como mucho ${BOLETAS_RECIENTES_POR_MESA}, de la más nueva a la más vieja`, async () => {
    const cuentas = [];
    for (const cantidad of [1, 2, 3, 4]) cuentas.push(await cerrarUna(cantidad));

    const boletas = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
    expect(boletas.map((b) => b.cuentaId)).toEqual([cuentas[3].id, cuentas[2].id, cuentas[1].id]);
    expect(boletas.map((b) => b.total)).toEqual([12000, 9000, 6000]);
    expect(boletas.every((b, i) => i === 0 || b.cerradaEn <= boletas[i - 1].cerradaEn)).toBe(true);
  });

  it("aislada por sucursal: la misma mesa pedida desde otra sucursal no da nada", async () => {
    await cerrarUna(1);
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    expect(await obtenerBoletasRecientes(otra.id, s.mesa.id)).toEqual([]);
    expect(await obtenerBoletasRecientes(s.sucursalId, s.mesa.id)).toHaveLength(1);
  });

  it("después de anular la venta (anularVenta), la boleta queda marcada como de venta anulada", async () => {
    const cuenta = await cerrarUna(2);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect((await anularVenta(item.operacionId!)).ok).toBe(true);

    const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
    expect(boleta).toMatchObject({ cuentaId: cuenta.id, ventaAnulada: true });
  });
});
