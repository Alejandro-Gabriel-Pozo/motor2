import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { ZONA_ARGENTINA as AR } from "../../src/core/tiempo/zona-horaria";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { calcularRotacionMesas, grupoDeTamano, type FilaCuentaRotacion } from "../../src/core/reportes/rotacion-mesas";
import { generarReporteRotacionMesas } from "../../src/server/consultas/reportes/rotacion-mesas";

/**
 * Rotación de mesas (docs/plan-comensales-y-limite-mesas-2026-09-26.md): núcleo puro (`calcularRotacionMesas`, con filas
 * sintéticas) + la consulta real (`generarReporteRotacionMesas`).
 */

describe("grupoDeTamano", () => {
  it("1..6 son su propio grupo; 7 o más caen en «7+»", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) expect(grupoDeTamano(n)).toBe(String(n));
    expect(grupoDeTamano(7)).toBe("7+");
    expect(grupoDeTamano(20)).toBe("7+");
  });
});

describe("calcularRotacionMesas", () => {
  const fila = (f: Partial<FilaCuentaRotacion>): FilaCuentaRotacion => ({
    abiertaEn: new Date("2026-01-15T12:00:00Z"), // 09:00 AR
    cerradaEn: new Date("2026-01-15T13:00:00Z"), // 1 hora después
    comensales: 2,
    cantidadItems: 1,
    ...f,
  });

  it("una cerrada sin ítems (liberarMesa) no entra en ninguna métrica, solo en su propio conteo", () => {
    const rep = calcularRotacionMesas([fila({ cantidadItems: 0 })], AR);
    expect(rep).toMatchObject({ atendidas: 0, liberadasSinConsumo: 1, abiertasSinCerrar: 0, comensalesPromedio: null, duracionPromedioMin: null });
    expect(rep.porFranjaHoraria).toEqual([]);
    expect(rep.porTamanoGrupo).toEqual([]);
  });

  it("una todavía abierta (cerradaEn null) no entra en atendidas ni en liberadas, solo en abiertasSinCerrar", () => {
    const rep = calcularRotacionMesas([fila({ cerradaEn: null })], AR);
    expect(rep).toMatchObject({ atendidas: 0, liberadasSinConsumo: 0, abiertasSinCerrar: 1 });
  });

  it("una atendida CON comensales entra en comensalesPromedio, duración y ambos desgloses", () => {
    const rep = calcularRotacionMesas([fila({ comensales: 4 })], AR);
    expect(rep.atendidas).toBe(1);
    expect(rep.cuentasConComensales).toBe(1);
    expect(rep.cuentasSinComensales).toBe(0);
    expect(rep.comensalesPromedio).toBe(4);
    expect(rep.duracionPromedioMin).toBe(60);
    expect(rep.porFranjaHoraria).toEqual([{ hora: 9, cantidad: 1, comensalesPromedio: 4, duracionPromedioMin: 60 }]);
    expect(rep.porTamanoGrupo).toEqual([{ grupo: "4", cantidad: 1, duracionPromedioMin: 60 }]);
  });

  it("una atendida con comensales NULL entra en el conteo general y en la franja horaria, pero no en el promedio de comensales ni en el desglose por grupo", () => {
    const rep = calcularRotacionMesas([fila({ comensales: null })], AR);
    expect(rep.atendidas).toBe(1);
    expect(rep.cuentasConComensales).toBe(0);
    expect(rep.cuentasSinComensales).toBe(1);
    expect(rep.comensalesPromedio).toBeNull();
    expect(rep.duracionPromedioMin).toBe(60); // la duración no depende de los comensales
    expect(rep.porFranjaHoraria).toEqual([{ hora: 9, cantidad: 1, comensalesPromedio: null, duracionPromedioMin: 60 }]);
    expect(rep.porTamanoGrupo).toEqual([]);
  });

  it("promedia comensales y duración de varias cuentas, y agrupa 7+ junto con otro grupo grande", () => {
    const rep = calcularRotacionMesas([
      fila({ comensales: 2, abiertaEn: new Date("2026-01-15T12:00:00Z"), cerradaEn: new Date("2026-01-15T12:30:00Z") }), // 30 min
      fila({ comensales: 4, abiertaEn: new Date("2026-01-15T12:00:00Z"), cerradaEn: new Date("2026-01-15T13:30:00Z") }), // 90 min
      fila({ comensales: 8, abiertaEn: new Date("2026-01-15T12:00:00Z"), cerradaEn: new Date("2026-01-15T14:00:00Z") }), // 120 min
      fila({ comensales: 10, abiertaEn: new Date("2026-01-15T12:00:00Z"), cerradaEn: new Date("2026-01-15T14:00:00Z") }), // 120 min
    ], AR);
    expect(rep.atendidas).toBe(4);
    expect(rep.comensalesPromedio).toBe(6); // (2+4+8+10)/4
    expect(rep.duracionPromedioMin).toBe(90); // (30+90+120+120)/4
    expect(rep.porTamanoGrupo).toEqual([
      { grupo: "2", cantidad: 1, duracionPromedioMin: 30 },
      { grupo: "4", cantidad: 1, duracionPromedioMin: 90 },
      { grupo: "7+", cantidad: 2, duracionPromedioMin: 120 },
    ]);
  });

  it("la franja horaria agrupa por HORA LOCAL de Argentina, no la hora UTC cruda", () => {
    const rep = calcularRotacionMesas([
      fila({ abiertaEn: new Date("2026-01-15T02:00:00Z"), cerradaEn: new Date("2026-01-15T02:30:00Z") }), // 23:00 AR del 14
      fila({ abiertaEn: new Date("2026-01-15T02:10:00Z"), cerradaEn: new Date("2026-01-15T02:40:00Z") }), // también 23:00 AR
      fila({ abiertaEn: new Date("2026-01-15T15:00:00Z"), cerradaEn: new Date("2026-01-15T15:30:00Z") }), // 12:00 AR
    ], AR);
    expect(rep.porFranjaHoraria.map((f) => [f.hora, f.cantidad])).toEqual([
      [12, 1],
      [23, 2],
    ]);
  });

  it("sin ninguna cuenta, todo en cero/null", () => {
    expect(calcularRotacionMesas([], AR)).toMatchObject({ atendidas: 0, liberadasSinConsumo: 0, abiertasSinCerrar: 0, comensalesPromedio: null, duracionPromedioMin: null, porFranjaHoraria: [], porTamanoGrupo: [] });
  });
});

describe("generarReporteRotacionMesas (consulta real)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  it("solo cuenta cuentas de ESTA sucursal, abiertas dentro del rango, y clasifica atendida/liberada/abierta", async () => {
    const desde = new Date("2026-01-01T00:00:00Z");
    const hasta = new Date("2026-01-31T23:59:59Z");

    // Atendida: cerrada con un ítem, comensales 3.
    const atendida = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    await prisma.cuenta.update({ where: { id: atendida.id }, data: { abiertaEn: new Date("2026-01-10T12:00:00Z"), cerradaEn: new Date("2026-01-10T13:00:00Z"), comensales: 3 } });

    // Liberada sin consumo: cerrada sin ítems.
    const mesaLiberada = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 500 } });
    await prisma.cuenta.create({ data: { mesaId: mesaLiberada.id, abiertaPorId: s.admin.id, abiertaEn: new Date("2026-01-11T12:00:00Z"), cerradaEn: new Date("2026-01-11T12:05:00Z") } });

    // Todavía abierta.
    const mesaAbierta = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 501 } });
    await prisma.cuenta.create({ data: { mesaId: mesaAbierta.id, abiertaPorId: s.admin.id, abiertaEn: new Date("2026-01-12T12:00:00Z") } });

    // Fuera del rango (no debe contarse).
    const mesaFuera = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 502 } });
    await prisma.cuenta.create({
      data: { mesaId: mesaFuera.id, abiertaPorId: s.admin.id, abiertaEn: new Date("2025-12-01T12:00:00Z"), cerradaEn: new Date("2025-12-01T13:00:00Z"), comensales: 5, items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }] } },
    });

    // Otra sucursal (no debe contarse).
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const mesaOtra = await prisma.mesa.create({ data: { sucursalId: otraSucursal.id, numero: 1 } });
    await prisma.cuenta.create({
      data: { mesaId: mesaOtra.id, abiertaPorId: s.admin.id, abiertaEn: new Date("2026-01-10T12:00:00Z"), cerradaEn: new Date("2026-01-10T13:00:00Z"), comensales: 5, items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 }] } },
    });

    const rep = await generarReporteRotacionMesas(s.sucursalId, desde, hasta, AR, prisma);
    expect(rep.atendidas).toBe(1);
    expect(rep.liberadasSinConsumo).toBe(1);
    expect(rep.abiertasSinCerrar).toBe(1);
    expect(rep.comensalesPromedio).toBe(3);
  });
});
