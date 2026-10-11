import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { leerFiltroTickets } from "../../src/core/reportes/tickets-emitidos";
import { ZONA_ARGENTINA, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";
import { generarReporteVentasPorCategoria, obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * Período y Tickets cortan el día igual (P1, O.251). Una venta del POS guarda el MISMO instante en `Operacion.fecha` y en `EjemplarTicket.emitidoEn` (`cerrarCuenta`): si los dos reportes
 * cortan el día con la misma zona, la venta cae en el mismo día en los dos. Con el corte anterior de Período (UTC) una venta de las 22:30 argentinas (01:30Z del día siguiente) caía en
 * el día D+1 en Período y en el día D en Tickets.
 *
 * Contra Postgres real y con la acción real `cerrarCuenta` (que escribe la venta, el movimiento y el ejemplar con el reloj real); después el test fija el instante de la venta en uno
 * PASADO y fijo (los cuatro bordes del plan: fin de mes, comienzo de mes, fin de año y 29 de febrero de un año bisiesto, todos pasados desde hace más de un día).
 */
const CASOS = [
  { nombre: "22:30 del 30/09/2026 (fin de mes)", instante: "2026-10-01T01:30:00.000Z", dia: "2026-09-30" },
  { nombre: "00:30 del 01/10/2026 (comienzo de mes)", instante: "2026-10-01T03:30:00.000Z", dia: "2026-10-01" },
  { nombre: "22:30 del 31/12/2025 (cambio de año)", instante: "2026-01-01T01:30:00.000Z", dia: "2025-12-31" },
  { nombre: "22:30 del 29/02/2024 (bisiesto)", instante: "2024-03-01T01:30:00.000Z", dia: "2024-02-29" },
];

describe("Período, Ventas por categoría y Tickets: la misma venta en el mismo día", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Cierra una cuenta de $3.000 con la acción real y fija en `instante` la fecha de la venta, el cierre de la cuenta y la emisión del ticket (un solo instante, como `cerrarCuenta`). */
  async function ventaDelPosEn(instante: string) {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const fecha = new Date(instante);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    await prisma.operacion.update({ where: { id: item.operacionId! }, data: { fecha } });
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: fecha } });
    await prisma.ejemplarTicket.updateMany({ where: { cuentaId: cuenta.id }, data: { emitidoEn: fecha } });
  }

  const periodoDelDia = async (dia: string) => (await obtenerReportePorPeriodo(s.sucursalId, new Date(dia), new Date(dia), undefined, prisma, AHORA_DE_LA_CORRIDA)).ventas.totalFacturado;
  const categoriasDelDia = async (dia: string) => (await generarReporteVentasPorCategoria(s.sucursalId, new Date(dia), new Date(dia), prisma)).totalFacturado;
  const ticketsDelDia = async (dia: string) => {
    const { filtro } = leerFiltroTickets({ desde: dia, hasta: dia }, ZONA_ARGENTINA, AHORA_DE_LA_CORRIDA);
    return (await listarTicketsEmitidos(s.sucursalId, filtro, prisma)).items.length;
  };

  it.each(CASOS)("$nombre: el día D contiene la venta y el día D+1 no, en Período, en Ventas por categoría y en Tickets", async ({ instante, dia }) => {
    await ventaDelPosEn(instante);
    const siguiente = sumarDias(dia, 1);

    expect(await periodoDelDia(dia)).toBe(3000);
    expect(await categoriasDelDia(dia)).toBe(3000);
    expect(await ticketsDelDia(dia)).toBe(1);

    expect(await periodoDelDia(siguiente)).toBe(0);
    expect(await categoriasDelDia(siguiente)).toBe(0);
    expect(await ticketsDelDia(siguiente)).toBe(0);
  });

  it("un rango de varios días que abarca el día de la venta también la contiene (una sola vez)", async () => {
    await ventaDelPosEn("2026-10-01T01:30:00.000Z"); // 22:30 del 30/09 en Argentina
    const rep = await obtenerReportePorPeriodo(s.sucursalId, new Date("2026-09-28"), new Date("2026-10-02"), undefined, prisma, AHORA_DE_LA_CORRIDA);
    expect(rep.ventas.totalFacturado).toBe(3000);
  });

  it("otra zona: el corte sigue a la zona que se pasa, no a una fija (00:30 del 01/10 en Argentina son las 23:30 del 30/09 en Nueva York, UTC−4)", async () => {
    await ventaDelPosEn("2026-10-01T03:30:00.000Z");
    const periodo = (dia: string, zona: string) => obtenerReportePorPeriodo(s.sucursalId, new Date(dia), new Date(dia), undefined, prisma, AHORA_DE_LA_CORRIDA, zona).then((r) => r.ventas.totalFacturado);
    expect(await periodo("2026-10-01", ZONA_ARGENTINA)).toBe(3000);
    expect(await periodo("2026-09-30", ZONA_ARGENTINA)).toBe(0);
    expect(await periodo("2026-10-01", "America/New_York")).toBe(0);
    expect(await periodo("2026-09-30", "America/New_York")).toBe(3000);
  });
});
