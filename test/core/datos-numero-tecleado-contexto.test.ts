import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CONTEXTO_CANTIDAD_SIN_UNIDAD,
  CONTEXTO_IMPORTE,
  MARCA_DE_NO_CANONICO,
  contextoDeCantidad,
  interpretarNumeroTecleado,
  leerNumeroCanonico,
  marcarNoCanonico,
  sinMarcaDeNoCanonico,
  textoCanonico,
  type ContextoNumerico,
} from "@/core/datos/numero-tecleado";

/**
 * Micro-paso 2c (decisiones-cerradas-2026-10-19, «REGLA NUMÉRICA FINAL — NOTACIÓN ARGENTINA»): el parser de lo que la persona ESCRIBE, con el contexto del campo. Tabla de casos borde y propiedades.
 *
 * Los contextos de la tabla: un importe (2 decimales), una unidad entera (0), una de 2 decimales, los kilos (3) y una cantidad sin unidad conocida (4).
 */
const IMPORTE = CONTEXTO_IMPORTE;
const ENTERA = contextoDeCantidad(0);
const DOS = contextoDeCantidad(2);
const KG = contextoDeCantidad(3);
const SIN_UNIDAD = CONTEXTO_CANTIDAD_SIN_UNIDAD;

type Esperado = number | null | "formato" | "ambiguo" | "decimales";

function resultado(texto: string, contexto: ContextoNumerico): Esperado {
  const r = interpretarNumeroTecleado(texto, contexto);
  return r.ok ? r.valor : r.codigo === "formato" || r.codigo === "ambiguo" || r.codigo === "decimales" ? r.codigo : "formato";
}

const NOMBRES = new Map<ContextoNumerico, string>([
  [IMPORTE, "importe"],
  [ENTERA, "entera"],
  [DOS, "2 dec"],
  [KG, "kg (3 dec)"],
  [SIN_UNIDAD, "sin unidad (4 dec)"],
]);

/** texto → [importe, entera, 2 decimales, kg, sin unidad] */
const TABLA: readonly (readonly [string, readonly [Esperado, Esperado, Esperado, Esperado, Esperado]])[] = [
  // «21.000»: miles donde el decimal no puede tener 3 cifras; ambiguo donde sí (no se adivina).
  ["21.000", [21000, 21000, 21000, "ambiguo", "ambiguo"]],
  ["1.205", [1205, 1205, 1205, "ambiguo", "ambiguo"]],
  ["2.000", [2000, 2000, 2000, "ambiguo", "ambiguo"]],
  ["999.999", [999999, 999999, 999999, "ambiguo", "ambiguo"]],
  // La coma es SIEMPRE decimal: «21,000» no es veintiún mil.
  ["21,000", ["decimales", "decimales", "decimales", 21, 21]],
  ["1,205", ["decimales", "decimales", "decimales", 1.205, 1.205]],
  ["21,00", [21, "decimales", 21, 21, 21]],
  ["21,5", [21.5, "decimales", 21.5, 21.5, 21.5]],
  ["0,5", [0.5, "decimales", 0.5, 0.5, 0.5]],
  ["0,125", ["decimales", "decimales", "decimales", 0.125, 0.125]],
  // Con los dos separadores: el punto es miles y la coma, decimal.
  ["1.234,56", [1234.56, "decimales", 1234.56, 1234.56, 1234.56]],
  ["12.345,6", [12345.6, "decimales", 12345.6, 12345.6, 12345.6]],
  ["21.000,00", [21000, "decimales", 21000, 21000, 21000]],
  // La notación anglosajona ya no se adivina: la coma va antes del punto, el punto después de la coma no es miles ni decimal.
  ["1,234.56", ["formato", "formato", "formato", "formato", "formato"]],
  ["1,000,000", ["formato", "formato", "formato", "formato", "formato"]],
  ["1,2,3", ["formato", "formato", "formato", "formato", "formato"]],
  // Un solo punto con 1 o 2 cifras: decimal (el teclado numérico); con 4 o más, también, si caben.
  ["1.5", [1.5, "decimales", 1.5, 1.5, 1.5]],
  ["21.5", [21.5, "decimales", 21.5, 21.5, 21.5]],
  ["0.25", [0.25, "decimales", 0.25, 0.25, 0.25]],
  [".5", [0.5, "decimales", 0.5, 0.5, 0.5]],
  ["1.2345", ["decimales", "decimales", "decimales", "decimales", 1.2345]],
  ["12345.678", ["decimales", "decimales", "decimales", 12345.678, 12345.678]],
  // El entero en cero o con cero a la izquierda: un solo punto es decimal.
  ["0.125", ["decimales", "decimales", "decimales", 0.125, 0.125]],
  ["0.300", ["decimales", "decimales", "decimales", 0.3, 0.3]],
  ["0.021", ["decimales", "decimales", "decimales", 0.021, 0.021]],
  // Varios puntos: miles bien agrupados.
  ["1.000.000", [1000000, 1000000, 1000000, 1000000, 1000000]],
  ["12.345.678", [12345678, 12345678, 12345678, 12345678, 12345678]],
  ["1.000.000,5", [1000000.5, "decimales", 1000000.5, 1000000.5, 1000000.5]],
  ["0.021.500", ["formato", "formato", "formato", "formato", "formato"]],
  ["1.2.3", ["formato", "formato", "formato", "formato", "formato"]],
  ["12.34.5", ["formato", "formato", "formato", "formato", "formato"]],
  ["1.000,5.0", ["formato", "formato", "formato", "formato", "formato"]],
  ["1.23,4", ["formato", "formato", "formato", "formato", "formato"]],
  // Tecleo a medias.
  ["5,", [5, 5, 5, 5, 5]],
  ["21.", [21, 21, 21, 21, 21]],
  [",5", [0.5, "decimales", 0.5, 0.5, 0.5]],
  // Vacío: campo sin cargar (no es 0).
  ["", [null, null, null, null, null]],
  ["   ", [null, null, null, null, null]],
  // Enteros, ceros a la izquierda, espacios de los costados.
  ["0", [0, 0, 0, 0, 0]],
  ["42", [42, 42, 42, 42, 42]],
  ["007", [7, 7, 7, 7, 7]],
  ["00,5", [0.5, "decimales", 0.5, 0.5, 0.5]],
  ["  42  ", [42, 42, 42, 42, 42]],
  // Negativos: el signo solo al principio y una vez.
  ["-5", [-5, -5, -5, -5, -5]],
  ["-21.000", [-21000, -21000, -21000, "ambiguo", "ambiguo"]],
  ["-,5", [-0.5, "decimales", -0.5, -0.5, -0.5]],
  ["-0", [0, 0, 0, 0, 0]],
  ["--5", ["formato", "formato", "formato", "formato", "formato"]],
  ["5-3", ["formato", "formato", "formato", "formato", "formato"]],
  ["-", ["formato", "formato", "formato", "formato", "formato"]],
  // Espacios internos, símbolos, notación científica y texto: error de formato, nunca un número a medias.
  ["1 000", ["formato", "formato", "formato", "formato", "formato"]],
  ["$ 100", ["formato", "formato", "formato", "formato", "formato"]],
  ["$100", ["formato", "formato", "formato", "formato", "formato"]],
  ["10%", ["formato", "formato", "formato", "formato", "formato"]],
  ["+5", ["formato", "formato", "formato", "formato", "formato"]],
  ["1e3", ["formato", "formato", "formato", "formato", "formato"]],
  ["1E3", ["formato", "formato", "formato", "formato", "formato"]],
  ["1e-3", ["formato", "formato", "formato", "formato", "formato"]],
  ["0x10", ["formato", "formato", "formato", "formato", "formato"]],
  ["abc", ["formato", "formato", "formato", "formato", "formato"]],
  ["NaN", ["formato", "formato", "formato", "formato", "formato"]],
  ["Infinity", ["formato", "formato", "formato", "formato", "formato"]],
  [".", ["formato", "formato", "formato", "formato", "formato"]],
  [",", ["formato", "formato", "formato", "formato", "formato"]],
  ["...,.,.,...", ["formato", "formato", "formato", "formato", "formato"]],
  ["9".repeat(400), ["formato", "formato", "formato", "formato", "formato"]],
];

describe("interpretarNumeroTecleado: tabla de casos por contexto", () => {
  const contextos = [IMPORTE, ENTERA, DOS, KG, SIN_UNIDAD] as const;
  for (const [texto, esperados] of TABLA) {
    it(`${JSON.stringify(texto)}`, () => {
      const obtenidos = contextos.map((c) => resultado(texto, c));
      expect(Object.fromEntries(contextos.map((c, i) => [NOMBRES.get(c), obtenidos[i]]))).toEqual(Object.fromEntries(contextos.map((c, i) => [NOMBRES.get(c), esperados[i]])));
    });
  }
});

describe("interpretarNumeroTecleado: los mensajes dicen qué escribir", () => {
  it("ambiguo: las dos lecturas, con las cifras tal cual", () => {
    expect(interpretarNumeroTecleado("1.205", KG)).toEqual({ ok: false, codigo: "ambiguo", mensaje: "¿1,205 o 1205? Escribí 1205 o 1,205." });
    expect(interpretarNumeroTecleado("2.000", KG)).toEqual({ ok: false, codigo: "ambiguo", mensaje: "¿2,000 o 2000? Escribí 2000 o 2,000." });
  });

  it("decimales en un importe: el máximo y, con tres cifras tras la coma, cómo escribir veintiún mil", () => {
    expect(interpretarNumeroTecleado("21,000", IMPORTE)).toEqual({ ok: false, codigo: "decimales", mensaje: "Admite como máximo 2 decimales. Para 21000 escribí 21000 o 21.000,00." });
    expect(interpretarNumeroTecleado("1,5555", IMPORTE)).toEqual({ ok: false, codigo: "decimales", mensaje: "Admite como máximo 2 decimales." });
  });

  it("decimales en una unidad entera: tiene que ser entero", () => {
    expect(interpretarNumeroTecleado("1,5", ENTERA)).toEqual({ ok: false, codigo: "decimales", mensaje: "Tiene que ser un número entero." });
    expect(interpretarNumeroTecleado("1.5", ENTERA)).toEqual({ ok: false, codigo: "decimales", mensaje: "Tiene que ser un número entero." });
  });

  it("formato: el mensaje de siempre", () => {
    expect(interpretarNumeroTecleado("abc", IMPORTE)).toEqual({ ok: false, codigo: "formato", mensaje: "No es un número válido." });
  });
});

describe("interpretarNumeroTecleado: propiedades", () => {
  const contextoArb = fc.integer({ min: 0, max: 6 }).map(contextoDeCantidad);
  const agrupar = (entero: number) => String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  it("un entero bien agrupado con puntos (como lo muestra es-AR) se lee igual en cualquier contexto, salvo el de un solo grupo de 3 con decimales posibles (ambiguo)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), contextoArb, (n, contexto) => {
        const texto = agrupar(n);
        const r = interpretarNumeroTecleado(texto, contexto);
        const unSoloGrupoDeTres = /^[1-9]\d{0,2}\.\d{3}$/.test(texto);
        if (unSoloGrupoDeTres && contexto.decimales >= 3) expect(r.ok ? "ok" : r.codigo, texto).toBe("ambiguo");
        else expect(r.ok && r.valor, texto).toBe(n);
      })
    );
  });

  it("nunca se adivina: un solo punto con 3 cifras detrás y un entero de 1 a 3 dígitos da miles (menos de 3 decimales) o ambiguo (3 o más), jamás un decimal en silencio", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 0, max: 999 }), contextoArb, (a, b, contexto) => {
        const grupo = String(b).padStart(3, "0");
        const r = interpretarNumeroTecleado(`${a}.${grupo}`, contexto);
        if (contexto.decimales >= 3) {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.codigo).toBe("ambiguo");
        } else {
          expect(r.ok && r.valor).toBe(a * 1000 + b);
        }
      })
    );
  });

  it("la coma es decimal: hasta los decimales del contexto se lee exacto; con más, error de decimales (contados sobre lo tecleado, aunque sean ceros)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), fc.stringMatching(/^\d{1,6}$/), contextoArb, (entero, decimal, contexto) => {
        const r = interpretarNumeroTecleado(`${entero},${decimal}`, contexto);
        if (decimal.length <= contexto.decimales) expect(r.ok && r.valor, `${entero},${decimal}`).toBe(Number(`${entero}.${decimal}`));
        else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.codigo).toBe("decimales");
        }
      })
    );
  });

  it("lo que escribe el campo canónico con coma («1234,56») se vuelve a leer como el mismo número en un contexto que lo admite", () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999, max: 9_999_999 }), fc.integer({ min: 0, max: 9999 }), (entero, decimales) => {
        const n = Number(`${entero}.${String(decimales).padStart(4, "0")}`);
        const conComa = textoCanonico(n).replace(".", ",");
        expect(interpretarNumeroTecleado(conComa, SIN_UNIDAD), conComa).toEqual({ ok: true, valor: n === 0 ? 0 : n });
      })
    );
  });

  it("nunca tira, y si da un número es finito; cualquier cosa con una letra, un símbolo o un espacio de en medio es error de formato", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), contextoArb, (texto, contexto) => {
        const r = interpretarNumeroTecleado(texto, contexto);
        if (r.ok) expect(r.valor === null || Number.isFinite(r.valor)).toBe(true);
        else expect(["formato", "ambiguo", "decimales"]).toContain(r.codigo);
        if (/[^\d.,\s-]/.test(texto) || /\S\s+\S/.test(texto.trim())) {
          expect(r.ok, JSON.stringify(texto)).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });
});

describe("el canal de valor: leerNumeroCanonico y la marca de lo inválido", () => {
  it.each([
    ["", null],
    ["0", 0],
    ["5", 5],
    ["-5", -5],
    ["1.205", 1.205], // acá el punto es SIEMPRE el decimal
    ["21000", 21000],
    ["0.0001", 0.0001],
    ["-0", 0],
  ])("%j → %j", (texto, esperado) => {
    expect(leerNumeroCanonico(texto)).toEqual({ ok: true, valor: esperado });
  });

  it.each(["1,5", "21.000,00", "1.000.000", ".5", "5.", "1e3", " 5", "5 ", "abc", "-", "--5", "1.2.3", "+5", "1_0"])("%j no es canónico", (texto) => {
    const r = leerNumeroCanonico(texto);
    expect(r.ok).toBe(false);
  });

  it("un texto tecleado inválido que PARECE canónico («1.205» en kilos) se marca, y la marca lo vuelve ilegible", () => {
    expect(marcarNoCanonico("1.205")).toBe(`1.205${MARCA_DE_NO_CANONICO}`);
    expect(leerNumeroCanonico(marcarNoCanonico("1.205")).ok).toBe(false);
    expect(Number(marcarNoCanonico("1.205")), "ni siquiera Number() lo lee").toBeNaN();
    // Lo que no parece canónico ya es ilegible: no se toca.
    expect(marcarNoCanonico("21,000")).toBe("21,000");
    expect(sinMarcaDeNoCanonico(marcarNoCanonico("1.205"))).toBe("1.205");
    expect(sinMarcaDeNoCanonico("3,5")).toBe("3,5");
  });

  it("propiedad: ningún texto marcado se puede leer como canónico (salvo el vacío, que es «sin cargar»)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (texto) => {
        fc.pre(texto !== "");
        expect(leerNumeroCanonico(marcarNoCanonico(texto)).ok, JSON.stringify(texto)).toBe(false);
      })
    );
  });

  it("propiedad: textoCanonico(n) siempre se lee como canónico y da el mismo número", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }), (n) => {
        const r = leerNumeroCanonico(textoCanonico(n));
        expect(r.ok && r.valor).toBe(n === 0 ? 0 : n);
      })
    );
  });
});
