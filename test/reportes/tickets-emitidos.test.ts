import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta, emitirTicketCorregido } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { leerFiltroTickets, TAMANO_PAGINA_TICKETS } from "../../src/core/reportes/tickets-emitidos";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";
import { ZONA_ARGENTINA, finDelDia, inicioDelDia } from "../../src/core/tiempo/zona-horaria";

/**
 * Reporte de tickets emitidos (Task #17): una fila por `EjemplarTicket`, más recientes primero. Contra Postgres real, con las
 * acciones reales del POS (`cerrarCuenta`/`emitirTicketCorregido`/`anularVenta`) — no una simulación de lo que esas acciones
 * escriben.
 */
describe("listarTicketsEmitidos", () => {
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

  /** 3 líneas (como emitir-ticket-corregido-action.test.ts, cerrarTresLineas): 2 milanesas a distinto precio y 1 flan — para poder
   *  anular SOLO una línea y dejar la corrección válida (anular TODO rechaza `emitirTicketCorregido`: no queda nada que corregir). */
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

    const { items, nextCursor } = await listarTicketsEmitidos(s.sucursalId, undefined, prisma);
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
    expect((await emitirTicketCorregido(cuenta.id, "No quiso el flan")).ok).toBe(true);

    const { items } = await listarTicketsEmitidos(s.sucursalId, undefined, prisma);
    expect(items.map((b) => b.numero)).toEqual([
      { numero: 1, ejemplar: 2 },
      { numero: 1, ejemplar: 1 },
    ]);
  });

  it("marcas de corrección y reemplazo: la B es «corrección de» la A, y la A queda «reemplazada por» la B; solo la B (la última) trae `estado`", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    expect((await emitirTicketCorregido(cuenta.id, "No quiso el flan")).ok).toBe(true);

    const [b, a] = (await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items;
    // La B ya refleja la anulación del flan (sin nada posterior): vigente. Total = 2×9000 + 9500 = 27500 (ver ticket.test.ts).
    expect(b).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, importe: 27500, esUltimoEjemplar: true, correccionDe: { numero: 1, ejemplar: 1 }, reemplazadaPor: null, estado: "vigente" });
    expect(a).toMatchObject({ numero: { numero: 1, ejemplar: 1 }, esUltimoEjemplar: false, correccionDe: null, reemplazadaPor: { numero: 1, ejemplar: 2 }, estado: null });
  });

  it("con la venta anulada ENTERA, el último ejemplar (el único, la A) queda «Venta anulada»", async () => {
    const cuenta = await cerrarUna(2);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect((await anularVenta(item.operacionId!)).ok).toBe(true);

    const [a] = (await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items;
    expect(a).toMatchObject({ numero: { numero: 1, ejemplar: 1 }, esUltimoEjemplar: true, estado: "anulada" });
  });

  it("una anulación DESPUÉS de la última corrección deja esa última «desactualizada» (sin necesidad de una C todavía)", async () => {
    const { cuenta, ventaFlan, ventaMila2 } = await cerrarTresLineas();

    // Se anula el flan y se emite la B: ya refleja esa anulación (vigente).
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    expect((await emitirTicketCorregido(cuenta.id, "No quiso el flan")).ok).toBe(true);
    const [vigenteTodavia] = (await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items;
    expect(vigenteTodavia).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, estado: "vigente" });

    // Se anula la segunda milanesa DESPUÉS de emitir la B, sin emitir una C todavía: la B queda desactualizada (no "anulada": la
    // primera milanesa sigue vendida).
    expect((await anularVenta(ventaMila2)).ok).toBe(true);
    const [desactualizada] = (await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items;
    expect(desactualizada).toMatchObject({ numero: { numero: 1, ejemplar: 2 }, esUltimoEjemplar: true, estado: "desactualizada" });
  });

  it("filtra por mesa (mesaId) — la misma sucursal, otra mesa, no aparece", async () => {
    const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 9 } });
    await cerrarUna(1, s.mesa.id);
    await cerrarUna(2, otraMesa.id);

    const { items } = await listarTicketsEmitidos(s.sucursalId, { mesaId: s.mesa.id }, prisma);
    expect(items).toHaveLength(1);
    expect(items[0].mesaNumero).toBe(4);
  });

  it("aislada por sucursal: un ticket de otra sucursal no aparece, ni al revés", async () => {
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
    await prisma.ejemplarTicket.create({ data: { sucursalId: otra.id, cuentaId: cuentaOtra.id, numero: 1, emitidoPorId: s.admin.id } });

    expect((await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items).toHaveLength(1);
    expect((await listarTicketsEmitidos(otra.id, undefined, prisma)).items).toHaveLength(1);
    expect((await listarTicketsEmitidos(otra.id, undefined, prisma)).items[0].cuentaId).toBe(cuentaOtra.id);
  });

  it("una cuenta sin ejemplar (cerrada sin venta: todo anulado antes de cerrar) no aparece", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await anularItemEnviado(cuenta.items[0].id, 1, "Se fue", 1)).ok).toBe(true);
    expect(await cerrarCuenta(cuenta.id)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar." });

    expect((await listarTicketsEmitidos(s.sucursalId, undefined, prisma)).items).toEqual([]);
    expect(await prisma.ejemplarTicket.count()).toBe(0);
  });

  it("el rango de fecha filtra en hora de ARGENTINA: un ticket emitido a las 00:30 UTC (21:30 ART de la noche anterior) entra en el día de AYER, no en el de hoy en UTC", async () => {
    const cuenta = await cerrarUna(1);
    const emitidaEn = new Date("2026-09-26T00:30:00.000Z"); // 21:30 ART del 25/09
    await prisma.ejemplarTicket.updateMany({ where: { cuentaId: cuenta.id }, data: { emitidoEn: emitidaEn } });

    const rango25 = { desde: inicioDelDia("2026-09-25", ZONA_ARGENTINA), hasta: finDelDia("2026-09-25", ZONA_ARGENTINA) };
    const rango26 = { desde: inicioDelDia("2026-09-26", ZONA_ARGENTINA), hasta: finDelDia("2026-09-26", ZONA_ARGENTINA) };
    expect((await listarTicketsEmitidos(s.sucursalId, rango25, prisma)).items).toHaveLength(1);
    expect((await listarTicketsEmitidos(s.sucursalId, rango26, prisma)).items).toHaveLength(0);

    // Y a través de leerFiltroTickets (lo que hace la página): sp.desde=sp.hasta="2026-09-25" da el mismo resultado.
    const leido = leerFiltroTickets({ desde: "2026-09-25", hasta: "2026-09-25" }, ZONA_ARGENTINA, new Date());
    expect((await listarTicketsEmitidos(s.sucursalId, leido.filtro, prisma)).items).toHaveLength(1);
  });

  it(`pagina por cursor sin repetir ni saltear tickets: ${TAMANO_PAGINA_TICKETS + 1} tickets → ${TAMANO_PAGINA_TICKETS} + 1`, async () => {
    const total = TAMANO_PAGINA_TICKETS + 1;
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
      await prisma.ejemplarTicket.create({ data: { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: i, emitidoPorId: s.admin.id } });
    }

    const p1 = await listarTicketsEmitidos(s.sucursalId, undefined, prisma);
    expect(p1.items).toHaveLength(TAMANO_PAGINA_TICKETS);
    expect(p1.nextCursor).not.toBeNull();
    // más recientes primero: la primera página trae los números más altos.
    expect(p1.items[0].numero.numero).toBe(total);

    const p2 = await listarTicketsEmitidos(s.sucursalId, { cursor: p1.nextCursor! }, prisma);
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();

    const todas = [...p1.items, ...p2.items].map((b) => b.ejemplarId);
    expect(new Set(todas).size).toBe(total);
  });

  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 10): la clave de `lineasConOperacion` suma promoCuentaId —
   *  la cabecera de la promo no tiene una única Operacion (queda null), cada componente sigue con la suya. */
  it("una promo de dos componentes: la cabecera agrupa el total, cada componente trae SU propia operacionId", async () => {
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús tickets-emitidos" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 10000 } });
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);
    const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 10000, titulo: "Menú del día", creadoPorId: s.admin.id } });
    await prisma.cuentaItem.createMany({
      data: [
        { cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 7500, numeroEnvio: 1, promoCuentaId: promoCuenta.id, creadoPorId: s.admin.id },
        { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 1, precioUnitario: 2500, numeroEnvio: 1, promoCuentaId: promoCuenta.id, creadoPorId: s.admin.id },
      ],
    });
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const { items } = await listarTicketsEmitidos(s.sucursalId, undefined, prisma);
    const [fila] = items;
    expect(fila.importe).toBe(10000);
    expect(fila.detalle.lineas).toHaveLength(3); // cabecera + 2 componentes
    const [cabecera, compMila, compFlan] = fila.detalle.lineas;
    expect(cabecera).toMatchObject({ producto: "Menú del día", subtotal: 10000, operacionId: null });
    expect(compMila).toMatchObject({ producto: "Milanesa", subtotal: 7500, indentado: true });
    expect(compFlan).toMatchObject({ producto: "Flan", subtotal: 2500, indentado: true });
    expect(compMila.operacionId).not.toBeNull();
    expect(compFlan.operacionId).not.toBeNull();
    expect(compMila.operacionId).not.toBe(compFlan.operacionId);
  });
});
