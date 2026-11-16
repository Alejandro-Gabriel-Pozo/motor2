import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CODIGOS_DE_UNIDAD,
  DIMENSIONES_DE_UNIDAD,
  MAXIMO_DE_UNIDADES_MINIMAS,
  MOTIVOS_DE_CONVERSION,
  UNIDADES_DE_MEDIDA,
  convertirCantidadExacta,
  esCodigoDeUnidad,
} from "@/core/catalogo/unidades-de-medida";
import { CANTIDADES_DE_PRUEBA, CONOCIDAS, DIMENSIONES_ESPERADAS, RECHAZOS_CONOCIDOS, UNIDADES_ESPERADAS, esperadoDeConvertir } from "./unidades-de-medida-oraculo";

/** Docs: docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md (U0). Núcleo puro sin base: el recorrido es exhaustivo. */
describe("catálogo de las 14 unidades", () => {
  it("coincide con el oráculo: mismos códigos, dimensión, símbolo y factor", () => {
    expect([...CODIGOS_DE_UNIDAD]).toEqual(UNIDADES_ESPERADAS.map((u) => u.codigo));
    for (const e of UNIDADES_ESPERADAS) {
      const real = UNIDADES_DE_MEDIDA[e.codigo as keyof typeof UNIDADES_DE_MEDIDA];
      expect({ dimension: real.dimension, simbolo: real.simbolo, factor: real.factor }, e.codigo).toEqual({ dimension: e.dimension, simbolo: e.simbolo, factor: BigInt(e.factor) });
    }
  });

  it("las dimensiones son las seis y cada una tiene una sola base (factor 1); los símbolos no se repiten", () => {
    expect([...DIMENSIONES_DE_UNIDAD]).toEqual([...DIMENSIONES_ESPERADAS]);
    for (const d of DIMENSIONES_DE_UNIDAD) {
      expect(CODIGOS_DE_UNIDAD.filter((c) => UNIDADES_DE_MEDIDA[c].dimension === d && UNIDADES_DE_MEDIDA[c].factor === BigInt(1)), d).toHaveLength(1);
    }
    const simbolos = CODIGOS_DE_UNIDAD.map((c) => UNIDADES_DE_MEDIDA[c].simbolo);
    expect(new Set(simbolos).size).toBe(simbolos.length);
  });

  it("esCodigoDeUnidad: solo los 14 códigos exactos", () => {
    for (const c of CODIGOS_DE_UNIDAD) expect(esCodigoDeUnidad(c)).toBe(true);
    for (const x of ["kilogramo", "KG", "", "toString", "__proto__", "constructor", "hasOwnProperty", 1, null, undefined, {}, ["GRAMO"]]) expect(esCodigoDeUnidad(x)).toBe(false);
  });
});

describe("convertirCantidadExacta contra el oráculo (recorrido exhaustivo)", () => {
  it("las 14 × 14 parejas con 11 cantidades dan lo que dice el oráculo (aritmética decimal aparte)", () => {
    let recorridas = 0;
    let exactas = 0;
    for (const de of UNIDADES_ESPERADAS) {
      for (const a of UNIDADES_ESPERADAS) {
        for (const cantidad of CANTIDADES_DE_PRUEBA) {
          recorridas++;
          const esperado = esperadoDeConvertir(cantidad, de, a);
          const real = convertirCantidadExacta(cantidad, de.codigo, a.codigo);
          expect(real, `${cantidad} ${de.codigo} → ${a.codigo}`).toEqual(esperado.ok ? { ok: true, cantidad: esperado.cantidad } : { ok: false, motivo: esperado.motivo });
          if (esperado.ok) exactas++;
        }
      }
    }
    expect(recorridas).toBe(14 * 14 * CANTIDADES_DE_PRUEBA.length);
    expect(exactas).toBeGreaterThan(0);
  });

  it("valores conocidos escritos a mano (kg↔g, l↔ml, t, m3, m, cm, m2, h, min)", () => {
    for (const [cantidad, de, a, esperado] of CONOCIDAS) {
      expect(convertirCantidadExacta(cantidad, de, a), `${cantidad} ${de} → ${a}`).toEqual({ ok: true, cantidad: esperado });
    }
  });

  it("rechazos conocidos: motivo cerrado y en el orden unidad, cantidad, dimensión, exactitud, rango", () => {
    for (const [cantidad, de, a, motivo] of RECHAZOS_CONOCIDOS) {
      expect(convertirCantidadExacta(cantidad, de, a), `${JSON.stringify(cantidad.slice(0, 12))} ${de} → ${a}`).toEqual({ ok: false, motivo });
    }
    // Prioridad: la unidad desconocida gana a la cantidad inválida; la cantidad inválida a la dimensión; la dimensión a la exactitud.
    expect(convertirCantidadExacta("x", "CAJA", "GRAMO")).toEqual({ ok: false, motivo: "UNIDAD_DESCONOCIDA" });
    expect(convertirCantidadExacta("x", "KILOGRAMO", "LITRO")).toEqual({ ok: false, motivo: "CANTIDAD_INVALIDA" });
    expect(convertirCantidadExacta("1", "GRAMO", "LITRO")).toEqual({ ok: false, motivo: "DIMENSION_DISTINTA" });
    // La exactitud se controla antes que el rango (como Pedernal).
    expect(convertirCantidadExacta("9999999999.9999", "GRAMO", "TONELADA")).toEqual({ ok: false, motivo: "CONVERSION_NO_EXACTA" });
  });

  it("todos los motivos que el código puede dar están en la lista cerrada y cada uno se alcanza", () => {
    const vistos = new Set(RECHAZOS_CONOCIDOS.map((r) => r[3]));
    expect([...vistos].sort()).toEqual([...MOTIVOS_DE_CONVERSION].sort());
  });

  it("el tope es el de la columna Decimal(14,4) y el máximo exacto entra", () => {
    expect(MAXIMO_DE_UNIDADES_MINIMAS).toBe(BigInt(99_999_999_999_999));
    expect(convertirCantidadExacta("9999999999.9999", "GRAMO", "GRAMO")).toEqual({ ok: true, cantidad: "9999999999.9999" });
    expect(convertirCantidadExacta("999999999.9999", "KILOGRAMO", "GRAMO")).toEqual({ ok: false, motivo: "FUERA_DE_RANGO" });
  });
});

describe("convertirCantidadExacta (propiedades)", () => {
  const codigo = fc.constantFrom(...CODIGOS_DE_UNIDAD);
  const cantidad = fc.oneof(
    fc.bigInt({ min: BigInt(0), max: MAXIMO_DE_UNIDADES_MINIMAS }),
    fc.bigInt({ min: BigInt(0), max: BigInt(10_000_000) }),
    fc.constantFrom(BigInt(0), BigInt(1), MAXIMO_DE_UNIDADES_MINIMAS),
  ).map((u) => {
    const s = u.toString().padStart(5, "0");
    return `${s.slice(0, -4)}.${s.slice(-4)}`;
  });

  it("idempotencia: repetir la misma conversión da exactamente lo mismo", () => {
    fc.assert(fc.property(cantidad, codigo, codigo, (q, de, a) => {
      expect(convertirCantidadExacta(q, de, a)).toEqual(convertirCantidadExacta(q, de, a));
    }));
  });

  it("ida y vuelta sin pérdida cuando la ida es exacta", () => {
    fc.assert(
      fc.property(cantidad, codigo, codigo, (q, de, a) => {
        const ida = convertirCantidadExacta(q, de, a);
        fc.pre(ida.ok);
        if (!ida.ok) return;
        expect(convertirCantidadExacta(ida.cantidad, a, de)).toEqual({ ok: true, cantidad: q });
      }),
    );
  });

  it("la misma unidad es identidad", () => {
    fc.assert(fc.property(cantidad, codigo, (q, c) => {
      expect(convertirCantidadExacta(q, c, c)).toEqual({ ok: true, cantidad: q });
    }));
  });

  it("si da un valor, es exacto: valor × factor(a) = cantidad × factor(de), sin redondeo", () => {
    fc.assert(
      fc.property(cantidad, codigo, codigo, (q, de, a) => {
        const r = convertirCantidadExacta(q, de, a);
        if (!r.ok) return;
        const aMinimas = (t: string) => BigInt(t.replace(".", ""));
        expect(aMinimas(r.cantidad) * UNIDADES_DE_MEDIDA[a].factor).toBe(aMinimas(q) * UNIDADES_DE_MEDIDA[de].factor);
      }),
    );
  });

  it("entre dimensiones distintas siempre DIMENSION_DISTINTA", () => {
    fc.assert(
      fc.property(cantidad, codigo, codigo, (q, de, a) => {
        fc.pre(UNIDADES_DE_MEDIDA[de].dimension !== UNIDADES_DE_MEDIDA[a].dimension);
        expect(convertirCantidadExacta(q, de, a)).toEqual({ ok: false, motivo: "DIMENSION_DISTINTA" });
      }),
    );
  });
});
