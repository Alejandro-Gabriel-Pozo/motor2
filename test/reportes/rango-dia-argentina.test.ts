import { describe, expect, it } from "vitest";
import { fechaArgentina, finDelDiaArgentina, hoyEnArgentina, inicioDelDiaArgentina } from "../../src/core/reportes/rango-dia-argentina";

/**
 * Corte de "día" en hora de ARGENTINA (UTC-3 fijo) para el reporte de boletas emitidas (Task #17) — a propósito distinto del resto
 * de los reportes, que cortan en UTC (ver el docstring del módulo). Casos de borde: 00:00, 02:59 y 03:00 UTC, que son justo donde
 * un corte mal hecho (en UTC en vez de en ART) partiría en dos la noche de servicio.
 */
describe("fechaArgentina / inicioDelDiaArgentina / finDelDiaArgentina", () => {
  it("00:00 UTC de un día es todavía la NOCHE ANTERIOR en Argentina (21:00 ART del día previo)", () => {
    expect(fechaArgentina(new Date("2026-09-26T00:00:00.000Z"))).toBe("2026-09-25");
  });

  it("02:59:59.999 UTC sigue siendo el día anterior en Argentina (23:59:59.999 ART)", () => {
    expect(fechaArgentina(new Date("2026-09-26T02:59:59.999Z"))).toBe("2026-09-25");
  });

  it("03:00:00.000 UTC ya es el día siguiente en Argentina (00:00:00.000 ART) — el límite exacto", () => {
    expect(fechaArgentina(new Date("2026-09-26T03:00:00.000Z"))).toBe("2026-09-26");
  });

  it("inicioDelDiaArgentina/finDelDiaArgentina de un día son 03:00:00.000 UTC de ese día y 02:59:59.999 UTC del siguiente", () => {
    expect(inicioDelDiaArgentina("2026-09-26").toISOString()).toBe("2026-09-26T03:00:00.000Z");
    expect(finDelDiaArgentina("2026-09-26").toISOString()).toBe("2026-09-27T02:59:59.999Z");
  });

  it("una boleta emitida a las 21:30 ART (justo antes de la medianoche UTC) y otra a las 00:15 ART del día siguiente (después de la medianoche UTC) son del MISMO día de servicio en Argentina", () => {
    // 21:30 ART del 26/09 = 00:30 UTC del 27/09; 00:15 ART del 27/09 = 03:15 UTC del 27/09. Un corte en UTC (00:00) las separaría.
    const finDelServicio = new Date("2026-09-27T00:30:00.000Z");
    const yaDeMadrugada = new Date("2026-09-27T03:15:00.000Z");
    expect(fechaArgentina(finDelServicio)).toBe("2026-09-26");
    expect(fechaArgentina(yaDeMadrugada)).toBe("2026-09-27");
    // Pero las dos caen dentro del rango [inicio, fin] de "26/09" y "27/09" respectivamente, cada una en SU noche de servicio.
    const rango26 = { desde: inicioDelDiaArgentina("2026-09-26"), hasta: finDelDiaArgentina("2026-09-26") };
    expect(finDelServicio >= rango26.desde && finDelServicio <= rango26.hasta).toBe(true);
    const rango27 = { desde: inicioDelDiaArgentina("2026-09-27"), hasta: finDelDiaArgentina("2026-09-27") };
    expect(yaDeMadrugada >= rango27.desde && yaDeMadrugada <= rango27.hasta).toBe(true);
  });

  it("hoyEnArgentina delega en fechaArgentina, con el reloj real por default", () => {
    expect(hoyEnArgentina(new Date("2026-09-26T01:00:00.000Z"))).toBe("2026-09-25");
    expect(hoyEnArgentina(new Date("2026-09-26T04:00:00.000Z"))).toBe("2026-09-26");
  });
});
