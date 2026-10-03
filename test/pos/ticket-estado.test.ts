import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerTicketsRecientes } from "../../src/core/pos/ticket";

/**
 * Estado derivado del ticket (docs/plan-numeracion-ticket-2026-09-25.md, paso 6): `cerrarCuenta` registra una Operacion VENTA por
 * línea, así que `anularVenta` puede anular UNA línea de la mesa (el flan) y dejar otra vigente (la milanesa). El ticket se arma solo con
 * las líneas vigentes y dice si el último ejemplar impreso sigue valiendo («vigente»), si hubo anulaciones después de imprimirlo
 * («desactualizada»: hace falta el ejemplar de corrección) o si la venta se anuló entera («anulada»).
 */
describe("obtenerTicketsRecientes — estado derivado (vigente / desactualizada / anulada)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Mesa que comió 2 milanesas y 1 flan, cerrada con venta: dos Operaciones VENTA, una por línea. */
  async function cerrarMilanesaYFlan() {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const operacionDe = async (productoId: string) => (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId } })).operacionId!;
    return { cuenta, ventaMilanesa: await operacionDe(s.milanesa.id), ventaFlan: await operacionDe(s.flan.id) };
  }
  const laTicket = async () => (await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma))[0];

  it("recién cerrada: vigente, con todas sus líneas y sin corrección", async () => {
    const { cuenta } = await cerrarMilanesaYFlan();
    expect(await laTicket()).toMatchObject({ cuentaId: cuenta.id, estado: "vigente", corrigeA: null, ventaAnulada: false, numero: { numero: 1, ejemplar: 1 }, total: 21000 });
  });

  it("anulación PARCIAL después de imprimir (una línea con anularVenta): desactualizada, y las líneas y el total son solo lo vigente", async () => {
    const { ventaFlan } = await cerrarMilanesaYFlan();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);

    const ticket = await laTicket();
    expect(ticket).toMatchObject({ estado: "desactualizada", ventaAnulada: true, numero: { numero: 1, ejemplar: 1 }, corrigeA: null, total: 18000 });
    expect(ticket.lineas).toEqual([{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }]);
  });

  it("anulación TOTAL (todas las operaciones): anulada, sin líneas vigentes", async () => {
    const { ventaMilanesa, ventaFlan } = await cerrarMilanesaYFlan();
    for (const id of [ventaMilanesa, ventaFlan]) expect((await anularVenta(id)).ok).toBe(true);
    expect(await laTicket()).toMatchObject({ estado: "anulada", ventaAnulada: true, lineas: [], total: 0 });
  });

  it("con el ejemplar B emitido después de la anulación: vigente otra vez, con su número y la referencia al A; una anulación posterior la vuelve a desactualizar", async () => {
    const { cuenta, ventaMilanesa, ventaFlan } = await cerrarMilanesaYFlan();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);
    const a = await prisma.ejemplarTicket.findUniqueOrThrow({ where: { cuentaId_ejemplar: { cuentaId: cuenta.id, ejemplar: 1 } } });
    await prisma.ejemplarTicket.create({
      data: { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: a.numero, ejemplar: 2, corrigeAId: a.id, motivo: "No quiso el flan", emitidoPorId: s.admin.id, emitidoEn: new Date() },
    });

    expect(await laTicket()).toMatchObject({ estado: "vigente", ventaAnulada: true, numero: { numero: 1, ejemplar: 2 }, corrigeA: { numero: 1, ejemplar: 1 }, total: 18000 });

    expect((await anularVenta(ventaMilanesa)).ok).toBe(true);
    expect(await laTicket()).toMatchObject({ estado: "anulada", total: 0 });
  });

  it("una cuenta cerrada antes de la numeración (sin ejemplar): vigente sin anulaciones; con una anulación parcial, desactualizada (sin número que corregir)", async () => {
    const [ventaMila, ventaFlan] = await Promise.all(
      [1, 2].map(() => prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id, detalleLibre: "Mesa 4" } }))
    );
    await prisma.cuenta.create({
      data: {
        mesaId: s.mesa.id,
        abiertaPorId: s.admin.id,
        cerradaEn: new Date(Date.now() - 60_000),
        cerradaPorId: s.admin.id,
        items: {
          create: [
            { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, operacionId: ventaMila.id },
            { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: ventaFlan.id },
          ],
        },
      },
    });
    expect(await laTicket()).toMatchObject({ estado: "vigente", numero: null, corrigeA: null, total: 12000 });

    await prisma.operacion.update({ where: { id: ventaFlan.id }, data: { anuladaEn: new Date() } });
    expect(await laTicket()).toMatchObject({ estado: "desactualizada", numero: null, total: 9000 });
  });

  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, D4, paso 9): anular UN componente de una promo cerrada anula
   *  a su hermano también — el ticket pasa directo a "anulada" (nunca queda "desactualizada" a medias con solo la mitad
   *  de la promo vigente). */
  it("promo con dos componentes: anular UNO anula el otro también (D4) — el ticket pasa directo a «anulada», nunca a medias", async () => {
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús ticket-estado" } });
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

    const itemMila = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId: s.milanesa.id } });
    expect((await anularVenta(itemMila.operacionId!)).ok).toBe(true);

    const itemFlan = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId: s.flan.id } });
    const operacionFlan = await prisma.operacion.findUniqueOrThrow({ where: { id: itemFlan.operacionId! } });
    expect(operacionFlan.anuladaEn).not.toBeNull(); // el hermano se anuló también, sin que nadie lo pidiera a mano

    const ticket = (await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma))[0];
    expect(ticket).toMatchObject({ estado: "anulada", ventaAnulada: true, lineas: [], total: 0 });
  });
});
