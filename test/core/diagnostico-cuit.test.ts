import { describe, expect, it } from "vitest";
import { diagnosticarCuits, type FilaConCuit } from "../../src/core/fiscal/diagnostico-cuit";

const fila = (referencia: string, cuit: string | null, grupo = "g1"): FilaConCuit => ({ referencia, grupo, cuit });

describe("diagnosticarCuits", () => {
  it("clasifica cada fila en una sola categoría", () => {
    const d = diagnosticarCuits([
      fila("a", null),
      fila("b", "   "),
      fila("c", "30703088534"),
      fila("d", "30-70308853-4"),
      fila("e", "abc"),
      fila("f", "21123456780"),
      fila("g", "20123456789"),
    ]);
    expect(d).toMatchObject({ total: 7, vacios: 2, canonicos: 1, validosConSeparadores: 1, noNormalizan: 1, prefijoInvalido: 1, verificadorInvalido: 1 });
    expect(d.vacios + d.canonicos + d.validosConSeparadores + d.noNormalizan + d.prefijoInvalido + d.verificadorInvalido).toBe(d.total);
  });

  it("detecta duplicados al normalizar, solo dentro del mismo ámbito", () => {
    const d = diagnosticarCuits([
      fila("a", "30703088534", "e1"),
      fila("b", "30-70308853-4", "e1"),
      fila("c", "30703088534", "e2"),
      fila("d", "33693450239", "e1"),
    ]);
    expect(d.gruposDuplicados).toBe(1);
    expect(d.filasEnDuplicados).toBe(2);
    expect(d.detalle.filter((x) => x.motivo === "duplicado").map((x) => x.referencia).sort()).toEqual(["a", "b"]);
  });

  it("cuenta como duplicados también los que normalizan a 11 dígitos aunque el verificador esté mal (el índice los frenaría igual)", () => {
    const d = diagnosticarCuits([fila("a", "20-12345678-9"), fila("b", "20123456789")]);
    expect(d.gruposDuplicados).toBe(1);
    expect(d.verificadorInvalido).toBe(2);
  });

  it("el detalle nunca contiene el CUIT", () => {
    const d = diagnosticarCuits([fila("emp/PRV_000001", "20-12345678-9"), fila("emp/PRV_000002", "xx")]);
    expect(JSON.stringify(d)).not.toMatch(/\d{8}/);
  });

  it("sin filas", () => {
    expect(diagnosticarCuits([])).toMatchObject({ total: 0, gruposDuplicados: 0, detalle: [] });
  });
});
