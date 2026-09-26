import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta, emitirBoletaCorregida, anularItemEnviado } from "../../src/server/actions/pos/cuenta";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { listarBoletasEmitidas, leerFiltroBoletas, TAMANO_PAGINA_BOLETAS } from "../../src/core/reportes/boletas-emitidas";
import { inicioDelDiaArgentina, finDelDiaArgentina } from "../../src/core/reportes/rango-dia-argentina";

/**
 * Reporte de boletas emitidas (Task #17): una fila por `EjemplarBoleta`, más recientes primero. Contra Postgres real, con las
 * acciones reales del POS (`cerrarCuenta`/`emitirBoletaCorregida`/`anularVenta`) — no una simulación de lo que esas acciones
 * escriben.
 */
describe("listarBoletasEmitidas", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Una cuenta cerrada CON venta en la mesa dada (o la mesa 4 del fixture por default). */
  async function cerrarUna(cantidad: number, mesaId = s.mesa.id) {
    const cuenta = await sembrarCuenta(mesaId, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    return cuenta;
  }

  /** 3 líneas (como emitir-boleta-corregida-action.test.ts, cerrarTresLineas): 2 milanesas a distinto precio y 1 flan — para poder
   *  anular SOLO una línea y dejar la corrección válida (anular TODO rechaza `emitirBoletaCorregida`: no queda nada que corregir). */
  async function cerrarTresLineas() {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const ventaDe = async (productoId: string, precioUnitario: number) => (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId, precioUnitario } })).operacionId!;
    return { cuenta, ventaFlan: await ventaDe(s.flan.id, 3000), ventaMila2: await ventaDe(s.milanesa.id, 9500) };
  }

  it("una cuenta cerrada trae su ejemplar A: número, importe, mesa, quien emitió, y el detalle con la línea y su operacionId", async () => {
    const cuenta = await cerrarUna(2);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });

    const { items, nextCursor } = await listarBoletasEmitidas(s.sucursalId);
    expect(nextCursor).toBeNull();
    expect(items).toHaveLength(1);
    const [b] = items;
    expect(b).toMatchObject({
      cuentaId: cuenta.id,
      numero: { numero: 1, ejemplar: 1 },
      emitidoPor: "admin",
      mesaNumero: 4,
      importe: 6000,
      esUltimoEjemplar: true,
      correccionDe: null,
      reemplazadaPor: null,
      estado: "vigente",
    });
    expect(b.detalle.mesero).toBe("admin");
    expect(b.detalle.lineas).toEqual([{ producto: "Flan", cantidad: 2, precioUnitario: 3000, subtotal: 6000, operacionId: item.operacionId }]);
  });

  it("orden: numero desc, y a igual número el ejemplar más nuevo (la corrección B) va ANTES que su A", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    expect((await emitirBoletaCorregida(cuenta.id, "No quiso el flan")).ok).toBe(true);

    const { items } = await listarBoletasEmitidas(s.sucursalId);
    expect(items.map((b) => b.numero)).toEqual([
      { numero: 1, ejemplar: 2 },
      { numero: 1, ejemplar: 1 },
    ]);
  });

  it("marcas de corrección y reemplazo: la B es «corrección de» la A, y la A queda «reemplazada por» la B; solo la B (la última) trae `estado`", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    expect((await emitirBoletaCorregida(cuenta.id, "No quiso el flan")).ok).toBe(true);

    const [b, a] = (await listarBoletasEmitidas(s.sucursalId)).items;
    // La B ya refleja la anulación del flan (sin nada posterior): vigente. Total = 2×9000 + 9500 = 27500 (ver boleta.test.ts).
    expect(b).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, importe: 27500, esUltimoEjemplar: true, correccionDe: { numero: 1, ejemplar: 1 }, reemplazadaPor: null, estado: "vigente" });
    expect(a).toMatchObject({ numero: { numero: 1, ejemplar: 1 }, esUltimoEjemplar: false, correccionDe: null, reemplazadaPor: { numero: 1, ejemplar: 2 }, estado: null });
  });

  it("con la venta anulada ENTERA, el último ejemplar (el único, la A) queda «Venta anulada»", async () => {
    const cuenta = await cerrarUna(2);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect((await anularVenta(item.operacionId!)).ok).toBe(true);

    const [a] = (await listarBoletasEmitidas(s.sucursalId)).items;
    expect(a).toMatchObject({ numero: { numero: 1, ejemplar: 1 }, esUltimoEjemplar: true, estado: "anulada" });
  });

  it("una anulación DESPUÉS de la última corrección deja esa última «desactualizada» (sin necesidad de una C todavía)", async () => {
    const { cuenta, ventaFlan, ventaMila2 } = await cerrarTresLineas();

    // Se anula el flan y se emite la B: ya refleja esa anulación (vigente).
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    expect((await emitirBoletaCorregida(cuenta.id, "No quiso el flan")).ok).toBe(true);
    const [vigenteTodavia] = (await listarBoletasEmitidas(s.sucursalId)).items;
    expect(vigenteTodavia).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, estado: "vigente" });

    // Se anula la segunda milanesa DESPUÉS de emitir la B, sin emitir una C todavía: la B queda desactualizada (no "anulada": la
    // primera milanesa sigue vendida).
    expect((await anularVenta(ventaMila2)).ok).toBe(true);
    const [desactualizada] = (await listarBoletasEmitidas(s.sucursalId)).items;
    expect(desactualizada).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, esUltimoEjemplar: true, estado: "desactualizada" });
  });

  it("filtra por mesa (mesaId) — la misma sucursal, otra mesa, no aparece", async () => {
    const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 9 } });
    await cerrarUna(1, s.mesa.id);
    await cerrarUna(2, otraMesa.id);

    const { items } = await listarBoletasEmitidas(s.sucursalId, { mesaId: s.mesa.id });
    expect(items).toHaveLength(1);
    expect(items[0].mesaNumero).toBe(4);
  });

  it("aislada por sucursal: una boleta de otra sucursal no aparece, ni al revés", async () => {
    await cerrarUna(1);
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const mesaOtra = await prisma.mesa.create({ data: { sucursalId: otra.id, numero: 1 } });
    const ventaOtra = await prisma.operacion.create({ data: { sucursalId: otra.id, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    const cuentaOtra = await prisma.cuenta.create({
      data: {
        mesaId: mesaOtra.id,
        abiertaPorId: s.admin.id,
        cerradaEn: new Date(),
        cerradaPorId: s.admin.id,
        items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: ventaOtra.id }] },
      },
    });
    await prisma.ejemplarBoleta.create({ data: { sucursalId: otra.id, cuentaId: cuentaOtra.id, numero: 1, emitidoPorId: s.admin.id } });

    expect((await listarBoletasEmitidas(s.sucursalId)).items).toHaveLength(1);
    expect((await listarBoletasEmitidas(otra.id)).items).toHaveLength(1);
    expect((await listarBoletasEmitidas(otra.id)).items[0].cuentaId).toBe(cuentaOtra.id);
  });

  it("una cuenta sin ejemplar (cerrada sin venta: todo anulado antes de cerrar) no aparece", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await anularItemEnviado(cuenta.items[0].id, 1, "Se fue", 1)).ok).toBe(true);
    expect(await cerrarCuenta(cuenta.id)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar." });

    expect((await listarBoletasEmitidas(s.sucursalId)).items).toEqual([]);
    expect(await prisma.ejemplarBoleta.count()).toBe(0);
  });

  it("el rango de fecha filtra en hora de ARGENTINA: una boleta emitida a las 00:30 UTC (21:30 ART de la noche anterior) entra en el día de AYER, no en el de hoy en UTC", async () => {
    const cuenta = await cerrarUna(1);
    const emitidaEn = new Date("2026-09-26T00:30:00.000Z"); // 21:30 ART del 25/09
    await prisma.ejemplarBoleta.updateMany({ where: { cuentaId: cuenta.id }, data: { emitidoEn: emitidaEn } });

    const rango25 = { desde: inicioDelDiaArgentina("2026-09-25"), hasta: finDelDiaArgentina("2026-09-25") };
    const rango26 = { desde: inicioDelDiaArgentina("2026-09-26"), hasta: finDelDiaArgentina("2026-09-26") };
    expect((await listarBoletasEmitidas(s.sucursalId, rango25)).items).toHaveLength(1);
    expect((await listarBoletasEmitidas(s.sucursalId, rango26)).items).toHaveLength(0);

    // Y a través de leerFiltroBoletas (lo que hace la página): sp.desde=sp.hasta="2026-09-25" da el mismo resultado.
    const leido = leerFiltroBoletas({ desde: "2026-09-25", hasta: "2026-09-25" });
    expect((await listarBoletasEmitidas(s.sucursalId, leido.filtro)).items).toHaveLength(1);
  });

  it(`pagina por cursor sin repetir ni saltear boletas: ${TAMANO_PAGINA_BOLETAS + 1} boletas → ${TAMANO_PAGINA_BOLETAS} + 1`, async () => {
    const total = TAMANO_PAGINA_BOLETAS + 1;
    const venta = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    for (let i = 1; i <= total; i++) {
      const cuenta = await prisma.cuenta.create({
        data: {
          mesaId: s.mesa.id,
          abiertaPorId: s.admin.id,
          cerradaEn: new Date(),
          cerradaPorId: s.admin.id,
          items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: venta.id }] },
        },
      });
      await prisma.ejemplarBoleta.create({ data: { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: i, emitidoPorId: s.admin.id } });
    }

    const p1 = await listarBoletasEmitidas(s.sucursalId);
    expect(p1.items).toHaveLength(TAMANO_PAGINA_BOLETAS);
    expect(p1.nextCursor).not.toBeNull();
    // más recientes primero: la primera página trae los números más altos.
    expect(p1.items[0].numero.numero).toBe(total);

    const p2 = await listarBoletasEmitidas(s.sucursalId, { cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();

    const todas = [...p1.items, ...p2.items].map((b) => b.ejemplarId);
    expect(new Set(todas).size).toBe(total);
  });
});
