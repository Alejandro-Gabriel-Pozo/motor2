import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/lib/db-tipos";
import { generarReporteRotacionMesas } from "../../src/server/consultas/reportes/rotacion-mesas";
import { MAXIMO_DE_CUENTAS_EN_ROTACION } from "../../src/core/reportes/rotacion-mesas";

/**
 * S-28 (GT-15): el reporte de rotación de mesas trae una fila por cada cuenta abierta en el rango; sin tope, una sucursal con años de cuentas (o un rango enorme, antes de
 * el tope de 366 días) le hacía a la base y al servidor cargar todas. Ahora la consulta pide como mucho `MAXIMO_DE_CUENTAS_EN_ROTACION` y, si había más, el reporte lo dice
 * (`truncado`) en lugar de entregar números parciales como si fueran los de todo el rango. Cliente falso: lo que se mira es el pedido a la base y lo que se hace con la respuesta.
 */
const cerrada = (i: number) => ({ abiertaEn: new Date(Date.UTC(2026, 0, 1, 12, i % 60)), cerradaEn: new Date(Date.UTC(2026, 0, 1, 13, i % 60)), comensales: 2, _count: { items: 1 } });
const dbConCuentas = (cuantas: number) => {
  const findMany = vi.fn(async (args: { take?: number }) => Array.from({ length: Math.min(cuantas, args.take ?? Infinity) }, (_, i) => cerrada(i)));
  return { db: { cuenta: { findMany } } as unknown as Db, findMany };
};
const desde = new Date("2026-01-01T00:00:00Z");
const hasta = new Date("2026-12-31T00:00:00Z");

describe("generarReporteRotacionMesas: tope de cuentas (S-28, GT-15)", () => {
  it("EL ATAQUE: pide a la base como mucho el tope más una (la que delata que había más), nunca todas", async () => {
    const { db, findMany } = dbConCuentas(10);
    await generarReporteRotacionMesas("s1", desde, hasta, "America/Argentina/Buenos_Aires", db);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].take).toBe(MAXIMO_DE_CUENTAS_EN_ROTACION + 1);
  });

  it("con más cuentas que el tope: calcula con las primeras y lo dice (`truncado`), sin entregar el parcial como si fuera el total", async () => {
    const { db } = dbConCuentas(MAXIMO_DE_CUENTAS_EN_ROTACION + 1);
    const rep = await generarReporteRotacionMesas("s1", desde, hasta, "America/Argentina/Buenos_Aires", db);
    expect(rep.truncado).toBe(true);
    expect(rep.atendidas).toBe(MAXIMO_DE_CUENTAS_EN_ROTACION);
  }, 60_000);

  it("con exactamente el tope: no hay nada que decir (el reporte sale completo y sin la marca)", async () => {
    const { db } = dbConCuentas(MAXIMO_DE_CUENTAS_EN_ROTACION);
    const rep = await generarReporteRotacionMesas("s1", desde, hasta, "America/Argentina/Buenos_Aires", db);
    expect("truncado" in rep).toBe(false);
    expect(rep.atendidas).toBe(MAXIMO_DE_CUENTAS_EN_ROTACION);
  }, 60_000);

  it("con pocas cuentas el reporte es el de siempre, sin la marca", async () => {
    const { db } = dbConCuentas(3);
    const rep = await generarReporteRotacionMesas("s1", desde, hasta, "America/Argentina/Buenos_Aires", db);
    expect("truncado" in rep).toBe(false);
    expect(rep.atendidas).toBe(3);
  });
});
