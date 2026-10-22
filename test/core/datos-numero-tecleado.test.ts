import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { interpretarNumero, numeroDelCampo, textoCanonico, tieneALoSumoDecimales } from "@/core/datos/numero-tecleado";

// Sin base de datos: el parser es puro. Tabla de compatibilidad con el `normalizar` que tenía CampoNumero
// (docs/plan-validacion-de-datos-2026-09-25.md): lo que ya andaba da el mismo número; lo que se guardaba mal pasa a ser error.
function valor(texto: string) {
  const r = interpretarNumero(texto);
  if (!r.ok) throw new Error(`esperaba ok para ${JSON.stringify(texto)}: ${r.mensaje}`);
  return r.valor;
}

describe("interpretarNumero — lo que ya andaba da el mismo número", () => {
  it.each([
    ["0", 0],
    ["5", 5],
    ["10", 10],
    ["1000", 1000],
    ["-5", -5],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["0,07", 0.07],
    ["10,01", 10.01],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["12.345.678,9", 12345678.9],
    ["1.234", 1.234], // ambigüedad a propósito: un solo separador es el decimal
    ["1,234", 1.234],
    ["12,345", 12.345],
    ["  42  ", 42],
    [",5", 0.5], // tecleo a medias
    ["5,", 5],
    ["-,5", -0.5],
    ["007", 7],
  ])("%j → %d", (texto, esperado) => {
    expect(valor(texto)).toBe(esperado);
  });

  it("vacío o solo espacios → null (campo sin cargar)", () => {
    expect(valor("")).toBeNull();
    expect(valor("   ")).toBeNull();
  });

  it("'-0' se interpreta como 0 (nunca -0)", () => {
    expect(Object.is(valor("-0"), 0)).toBe(true);
  });
});

describe("interpretarNumero — se arregla lo que antes daba NaN / 0", () => {
  it.each([
    ["1.000.000", 1_000_000],
    ["1,000,000", 1_000_000],
    ["1.000.000,50", 1_000_000.5],
    ["1,000,000.50", 1_000_000.5],
  ])("%j → %d", (texto, esperado) => {
    expect(valor(texto)).toBe(esperado);
  });
});

describe("interpretarNumero — pasan a ser error de formato (antes se guardaban mal o en 0)", () => {
  it.each([
    "...,.,.,...",
    "1,2,3",
    "1.2.3",
    "1.23,4",
    "1,23.4",
    ".234,5",
    "1.234,5,6",
    "abc",
    "Infinity",
    "-Infinity",
    "NaN",
    "1e3",
    "5-3",
    "--5",
    "-",
    ".",
    ",",
    "$ 100",
    "$100",
    "1 000",
    "10%",
    "+5",
    "0x10",
    "9".repeat(400),
  ])("%j", (texto) => {
    const r = interpretarNumero(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("formato");
      expect(r.mensaje).toBe("No es un número válido.");
    }
  });
});

describe("interpretarNumero — agrupación de miles mal formada: error de formato (antes 0.021.500 se leía 21500)", () => {
  // Lo que deja tipear «1.500» o «1,5» DETRÁS de un «0.02» que el campo no reemplazó (src/components/campo-numero.tsx): un número con
  // miles no empieza con 0, y cada grupo de miles tiene exactamente 3 cifras.
  it.each([
    "0.021.500", // antes 21500
    "0,021,500", // antes 21500
    "0.021,5", // antes 21,5
    "0,021.5", // antes 21,5
    "-0.021.500",
    "0.000.000", // antes 0
    "00.123.456",
    "012.345.678",
    "01.234,5",
    "1.5000.02",
    "12.34.5",
    "1.00.000",
    "1.0000.000",
    "1.000.00",
    "1.000,5.0",
  ])("%j", (texto) => {
    const r = interpretarNumero(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("formato");
      expect(r.mensaje).toBe("No es un número válido.");
    }
  });

  it("propiedad: un grupo inicial que empieza con 0, seguido de miles (o de miles y decimal), nunca se acepta", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^0\d{0,2}$/),
        fc.array(fc.stringMatching(/^\d{3}$/), { minLength: 1, maxLength: 4 }),
        fc.option(fc.stringMatching(/^\d{1,4}$/), { nil: undefined }),
        fc.constantFrom([".", ","] as const, [",", "."] as const),
        fc.boolean(),
        (inicial, grupos, decimal, [miles, sepDecimal], negativo) => {
          // Un solo separador sin decimal ("0.021") es un DECIMAL (regla de siempre), no una agrupación: queda afuera.
          fc.pre(grupos.length >= 2 || decimal !== undefined);
          const texto = `${negativo ? "-" : ""}${[inicial, ...grupos].join(miles)}${decimal !== undefined ? `${sepDecimal}${decimal}` : ""}`;
          expect(interpretarNumero(texto).ok, texto).toBe(false);
        }
      )
    );
  });
});

describe("interpretarNumero — los casos válidos de siempre no cambian con el endurecimiento", () => {
  it.each([
    ["3", 3],
    ["0,30", 0.3],
    ["0,300", 0.3],
    ["0.300", 0.3],
    ["3.000", 3], // un solo punto es decimal (documentado y fijado)
    ["1.500", 1.5],
    ["12.345", 12.345],
    ["1.000.000", 1_000_000],
    ["1.234,5", 1234.5],
    [",5", 0.5],
    ["0,021", 0.021], // un solo separador: decimal, aunque empiece con 0
    ["0.02", 0.02],
    ["007", 7], // sin miles, los ceros a la izquierda siguen valiendo
    ["00,5", 0.5],
    ["999.999.999", 999_999_999],
    ["100.000,25", 100_000.25],
  ])("%j → %d", (texto, esperado) => {
    expect(valor(texto)).toBe(esperado);
  });

  /** Separador de miles cada 3 cifras desde la derecha (sin depender del Intl del entorno). */
  function agrupar(entero: number, sep: string): string {
    return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  it("propiedad: un número bien agrupado con decimal (es-AR «1.234,56» o en «1,234.56») se lee igual que sus cifras", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999_999_999 }),
        fc.stringMatching(/^\d{1,4}$/),
        fc.constantFrom([".", ","] as const, [",", "."] as const),
        (entero, decimal, [miles, sepDecimal]) => {
          expect(valor(`${agrupar(entero, miles)}${sepDecimal}${decimal}`)).toBe(Number(`${entero}.${decimal}`));
        }
      )
    );
  });

  it("propiedad: un entero de un millón o más, agrupado de a 3 (dos separadores o más), se lee igual", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000_000, max: 99_999_999_999 }), fc.constantFrom(".", ","), (entero, miles) => {
        expect(valor(agrupar(entero, miles))).toBe(entero);
      })
    );
  });

  it("propiedad: lo que muestra el campo al salir (es-AR) se vuelve a leer como el mismo número", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), fc.integer({ min: 0, max: 99 }), (entero, centavos) => {
        const n = Number(`${entero}.${String(centavos).padStart(2, "0")}`);
        const mostrado = n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
        // Con un solo separador de miles y sin decimales («3.000») es un decimal a propósito: esa ambigüedad no es de este cambio.
        fc.pre(!/^\d{1,3}\.\d{3}$/.test(mostrado));
        expect(valor(mostrado)).toBe(n);
      })
    );
  });
});

describe("textoCanonico — dígitos, un solo punto decimal, sin notación exponencial", () => {
  it.each([
    [0, "0"],
    [5, "5"],
    [-5, "-5"],
    [1234.56, "1234.56"],
    [0.07, "0.07"],
    [1e21, "1000000000000000000000"],
    [1e-7, "0.0000001"],
    [-1.5e-7, "-0.00000015"],
    [1.5e22, "15000000000000000000000"],
  ])("%d → %j", (n, esperado) => {
    expect(textoCanonico(n)).toBe(esperado);
  });

  it("-0 → '0'", () => {
    expect(textoCanonico(-0)).toBe("0");
  });

  it.each([0, 1, -1, 0.07, 10.01, 1234.56, 1_000_000, 12345678.9, 1.2345, 0.0000001, 1e21, 999_999_999_999.99])(
    "ida y vuelta: interpretar el texto canónico de %d da el mismo número",
    (n) => {
      expect(valor(textoCanonico(n))).toBe(n);
    }
  );
});

describe("numeroDelCampo — lo que un formulario manda a la Server Action (lee el canal de valor, no lo tecleado)", () => {
  it("vacío → undefined", () => {
    expect(numeroDelCampo("")).toBeUndefined();
  });
  it("canónico → el número (el punto es SIEMPRE el decimal: «1.205» es 1,205)", () => {
    expect(numeroDelCampo("1234.56")).toBe(1234.56);
    expect(numeroDelCampo("1.205")).toBe(1.205);
    expect(numeroDelCampo("-3")).toBe(-3);
  });
  it("inválido, o escrito en notación tecleada, → NaN, nunca 0 ni un número adivinado", () => {
    for (const t of ["abc", "...,.,.,...", "1.000.000", "21,5", "  ", "1.205\u200B"]) expect(numeroDelCampo(t), JSON.stringify(t)).toBeNaN();
  });
});

describe("tieneALoSumoDecimales — sin falsos rechazos por ruido de punto flotante", () => {
  it.each([
    [0.07, 2],
    [10.01, 2],
    [19.17, 2],
    [23.33, 2],
    [1.2345, 4],
    [3, 0],
    [1.25, 2],
    [-10.01, 2],
    [999_999_999_999.99, 2],
  ])("%d tiene a lo sumo %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(true);
  });

  it.each([
    [1.005, 2],
    [12.345, 2],
    [2.5, 0],
    [1.255, 2],
    [1.23456, 4],
  ])("%d tiene más de %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(false);
  });
});
