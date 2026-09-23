import { describe, expect, it } from "vitest";
import {
  MOTIVOS_MERMA_SEMILLA,
  DESTINOS_CONSUMO_SEMILLA,
  EQUIVALENCIA_MOTIVO_MERMA_LEGACY,
  EQUIVALENCIA_DESTINO_CONSUMO_LEGACY,
} from "../../src/core/movimientos/motivos-semilla";
import { RE_TEXTO_CATALOGO, validarLargoTexto } from "../../src/core/texto";
import { MOTIVOS_MERMA, DESTINOS_CONSUMO } from "../../src/core/movimientos/ui-config";

/**
 * Plan "motivos de Consumo/Merma como catálogo administrable" (2026-09-23), P2 — la semilla no la importa nadie todavía
 * (nace antes que la migración que la va a consumir), así que este archivo solo fija sus propios invariantes: los
 * `nombre` coinciden 1:1 con los labels de HOY (cero cambio visible al migrar) y todo pasa las mismas validaciones que
 * va a exigir el alta del catálogo en P6 (`RE_TEXTO_CATALOGO` para `nombre`, largo máximo para `descripcion`).
 */
describe("motivos-semilla", () => {
  it("MOTIVOS_MERMA_SEMILLA tiene los mismos 6 nombres, en el mismo orden, que MOTIVOS_MERMA (ui-config.ts) hoy", () => {
    expect(MOTIVOS_MERMA_SEMILLA.map((m) => m.nombre)).toEqual(MOTIVOS_MERMA.map((m) => m.label));
  });

  it("DESTINOS_CONSUMO_SEMILLA tiene los mismos 5 nombres, en el mismo orden, que DESTINOS_CONSUMO (ui-config.ts) hoy", () => {
    expect(DESTINOS_CONSUMO_SEMILLA.map((m) => m.nombre)).toEqual(DESTINOS_CONSUMO.map((m) => m.label));
  });

  it("EQUIVALENCIA_MOTIVO_MERMA_LEGACY cubre exactamente los 6 valores del enum viejo, y cada valor coincide con un nombre de la semilla", () => {
    expect(Object.keys(EQUIVALENCIA_MOTIVO_MERMA_LEGACY).sort()).toEqual(
      ["VENCIDO", "ROTO_O_CAIDO", "MAL_PREPARADO_O_QUEMADO", "DEVOLUCION_CLIENTE_NO_REVENDIBLE", "ROBO_O_FALTANTE", "OTRO"].sort()
    );
    const nombres = new Set(MOTIVOS_MERMA_SEMILLA.map((m) => m.nombre));
    for (const nombre of Object.values(EQUIVALENCIA_MOTIVO_MERMA_LEGACY)) expect(nombres.has(nombre)).toBe(true);
  });

  it("EQUIVALENCIA_DESTINO_CONSUMO_LEGACY cubre exactamente los 5 valores del enum viejo, y cada valor coincide con un nombre de la semilla", () => {
    expect(Object.keys(EQUIVALENCIA_DESTINO_CONSUMO_LEGACY).sort()).toEqual(
      ["PERSONAL", "DEGUSTACION_CORTESIA", "EVENTO", "ELABORACION_INTERNA", "OTRO"].sort()
    );
    const nombres = new Set(DESTINOS_CONSUMO_SEMILLA.map((m) => m.nombre));
    for (const nombre of Object.values(EQUIVALENCIA_DESTINO_CONSUMO_LEGACY)) expect(nombres.has(nombre)).toBe(true);
  });

  it("todo `nombre` pasa RE_TEXTO_CATALOGO (el mismo charset que va a exigir el alta en P6)", () => {
    for (const m of [...MOTIVOS_MERMA_SEMILLA, ...DESTINOS_CONSUMO_SEMILLA]) {
      expect(RE_TEXTO_CATALOGO.test(m.nombre), `"${m.nombre}" no pasa RE_TEXTO_CATALOGO`).toBe(true);
    }
  });

  it("toda `descripcion` pasa validarLargoTexto (máximo 300 — no usa RE_TEXTO_CATALOGO, su charset prohíbe «» y :)", () => {
    for (const m of [...MOTIVOS_MERMA_SEMILLA, ...DESTINOS_CONSUMO_SEMILLA]) {
      if (m.descripcion === undefined) continue;
      expect(validarLargoTexto(m.descripcion, "La descripción", 300), `"${m.descripcion}"`).toBeNull();
    }
  });

  it("la nota de negocio de BUGFIX A-3 sobrevive en la descripción de \"Devolución de cliente (no revendible)\"", () => {
    const fila = MOTIVOS_MERMA_SEMILLA.find((m) => m.nombre === "Devolución de cliente (no revendible)")!;
    expect(fila.descripcion).toContain("NO revendible");
    expect(fila.descripcion).toContain("Devolución de cliente (revendible)");
  });
});
