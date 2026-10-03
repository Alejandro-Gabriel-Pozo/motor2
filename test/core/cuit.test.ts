import { describe, expect, it } from "vitest";
import { esCuitValido, formatearCuit, normalizarCuit, validarCuit } from "../../src/core/fiscal/cuit";

// CUIT públicos y verificables: ARCA, YPF, MercadoLibre, Banco Nación.
const REALES = ["33693450239", "30546689979", "30703088534", "30500010912"];

describe("normalizarCuit", () => {
  it("saca espacios, puntos y guiones y deja los 11 dígitos", () => {
    expect(normalizarCuit("30-70308853-4")).toBe("30703088534");
    expect(normalizarCuit(" 30 70308853 4 ")).toBe("30703088534");
    expect(normalizarCuit("30.70308853.4")).toBe("30703088534");
    expect(normalizarCuit("30703088534")).toBe("30703088534");
  });

  it("no borra letras en silencio ni acepta otra cantidad de dígitos", () => {
    expect(normalizarCuit("30-7030885A-4")).toBeNull();
    expect(normalizarCuit("3070308853")).toBeNull();
    expect(normalizarCuit("307030885345")).toBeNull();
    expect(normalizarCuit("")).toBeNull();
    expect(normalizarCuit(null)).toBeNull();
  });
});

describe("esCuitValido", () => {
  it.each(REALES)("%s es válido", (c) => expect(esCuitValido(c)).toBe(true));

  it("resto 0 → verificador 0", () => {
    expect(esCuitValido("20100000130")).toBe(true);
    expect(esCuitValido("20100000131")).toBe(false);
  });

  it("resto 1 es inválido para cualquier verificador", () => {
    for (let x = 0; x <= 9; x++) expect(esCuitValido(`2010000005${x}`)).toBe(false);
  });

  it("verificador equivocado", () => {
    expect(esCuitValido("20123456789")).toBe(false);
    expect(esCuitValido("20123456786")).toBe(true);
    expect(esCuitValido("30123456789")).toBe(false);
    expect(esCuitValido("30123456781")).toBe(true);
  });

  it("acepta los siete prefijos y rechaza los demás", () => {
    // El verificador se recalcula para cada prefijo; 34 y 24 deben estar entre los aceptados.
    const conPrefijo = (p: string) => {
      const base = `${p}12345678`;
      for (let v = 0; v <= 9; v++) if (esCuitValido(`${base}${v}`)) return true;
      return false;
    };
    for (const p of ["20", "23", "24", "27", "30", "33", "34"]) expect(conPrefijo(p), p).toBe(true);
    for (const p of ["21", "22", "25", "00", "99"]) expect(conPrefijo(p), p).toBe(false);
    expect(esCuitValido("00000000000")).toBe(false);
  });

  it("exige exactamente 11 dígitos", () => {
    expect(esCuitValido("3070308853")).toBe(false);
    expect(esCuitValido("307030885344")).toBe(false);
    expect(esCuitValido("3070308853a")).toBe(false);
  });
});

describe("validarCuit", () => {
  it("vacío → null", () => {
    expect(validarCuit("")).toEqual({ ok: true, valor: null });
    expect(validarCuit("   ")).toEqual({ ok: true, valor: null });
    expect(validarCuit(undefined)).toEqual({ ok: true, valor: null });
  });

  it("válido con separadores → los 11 dígitos", () => {
    expect(validarCuit("30-70308853-4")).toEqual({ ok: true, valor: "30703088534" });
    expect(validarCuit(" 33 69345023 9 ")).toEqual({ ok: true, valor: "33693450239" });
  });

  it("verificador mal → código «verificador»", () => {
    const r = validarCuit("20-12345678-9");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("verificador");
      expect(r.mensaje).toContain("El CUIT");
    }
  });

  it("formato: letras, 10 u 12 dígitos, prefijo inexistente", () => {
    for (const malo of ["abc", "3070308853", "307030885345", "21-12345678-0", "00000000000"]) {
      const r = validarCuit(malo);
      expect(r.ok, malo).toBe(false);
      if (!r.ok) expect(r.codigo, malo).toBe("formato");
    }
  });

  it("más de 20 caracteres → código «largo»", () => {
    const r = validarCuit("3".repeat(21));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("largo");
  });

  it("usa la etiqueta que se le pase", () => {
    const r = validarCuit("x", "El CUIT del proveedor");
    expect(!r.ok && r.mensaje).toContain("El CUIT del proveedor");
  });
});

describe("formatearCuit", () => {
  it("11 dígitos → XX-XXXXXXXX-X", () => expect(formatearCuit("30703088534")).toBe("30-70308853-4"));

  it("cualquier otro dato se devuelve tal cual (datos viejos)", () => {
    expect(formatearCuit("30-12345678-9")).toBe("30-12345678-9");
    expect(formatearCuit("abc")).toBe("abc");
    expect(formatearCuit(null)).toBe("");
    expect(formatearCuit(undefined)).toBe("");
  });
});
