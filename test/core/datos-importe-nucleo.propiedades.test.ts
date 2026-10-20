import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CENTAVOS_MAXIMOS, IMPORTE_MAXIMO, esImporteAlCentavo, esImporteDeColumna, esPorcentajeDeDiferencia } from "@/core/datos/importe";
import { guardComandoAgregarItems } from "@/core/features/cuentas/cuenta-pedido.guard";
import { validarPrecioCarta } from "@/core/carta/validaciones";
import { redondearMoneda } from "@/core/moneda";
import { esNumeroFinito } from "@/core/numero";
import { texto } from "@/core/texto";
import { IMPORTE_MINIMO } from "@/core/opciones/tipos";

/**
 * EQUIVALENCIA del núcleo de importe (ola «precio y carta», Fase 2, C1). Sin base.
 *
 * Los siete validadores locales de importe/porcentaje tienen reglas DISTINTAS (negativos, mínimo 0,01, sin tope, decimales, mensajes) y NO se unifican: solo comparten el
 * NÚCLEO de `core/datos/importe.ts` (finito, tope, a lo sumo 2 decimales; o 4 en un porcentaje) y cada uno conserva su regla propia. Acá cada validador VIEJO, copiado
 * TAL CUAL estaba antes de la Fase 2 (oráculo congelado: no se toca), se compara con «núcleo + su regla propia» en miles de valores, con los bordes que rompen a la coma
 * flotante (1,005; 999.999.999.999,99; -0; NaN; ±Infinity; 128,045; 0,1 + 0,2). Si un validador nuevo acepta o rechaza distinto un solo valor, esto se pone rojo.
 */

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Oráculos congelados: el código de cada validador como estaba en `a25439b` (antes de pasar al núcleo). NO se actualizan: son la definición de «sin cambiar qué se acepta».
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** `src/core/opciones/validar-configuracion.ts` (`conDecimales`, `esMontoValido`, `esPorcentajeValido`). */
function conDecimalesViejo(n: number, decimales: number): boolean {
  const factor = 10 ** decimales;
  return Math.round(Math.abs(n) * factor) / factor === Math.abs(n);
}
function esMontoValidoViejo(m: number): boolean {
  return Number.isFinite(m) && Math.abs(m) < 1e12 && conDecimalesViejo(m, 2);
}
function esPorcentajeValidoViejo(p: number): boolean {
  return Number.isFinite(p) && p > -100 && p <= 999.9999 && conDecimalesViejo(p, 4);
}

/** `src/core/opciones/componer-precio-de-linea.ts` (`esImporte`, `esPorcentaje`: otra implementación de los decimales). */
function esImporteViejo(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) < 1e12 && redondearMoneda(n) === n;
}
function esPorcentajeViejo(p: number): boolean {
  return Number.isFinite(p) && p > -100 && p <= 999.9999 && Number(p.toFixed(4)) === p;
}

/** `src/core/opciones/combinaciones.ts` (`esPrecioValido`: lo borra la Fase 3; acá solo se fija que el núcleo le sirve). */
function esPrecioValidoViejo(n: number): boolean {
  return Number.isFinite(n) && n >= IMPORTE_MINIMO && n < 1e12 && Number(n.toFixed(2)) === n;
}

/** `src/core/features/cuentas/cuenta-pedido.guard.ts` (`esImporteVisto`, con el `tieneALoSumoDecimales` de `core/datos/numero-tecleado.ts` copiado adentro). */
function esImporteVistoViejo(v: unknown): v is number {
  if (!(typeof v === "number" && Number.isFinite(v) && v >= 0)) return false;
  const abs = Math.abs(v);
  return Math.round(abs * 100) / 100 === abs;
}

type ResultadoCarta = { ok: true; valor: number } | { ok: false; mensaje: string };
/** `src/core/carta/validaciones.ts` (`validarPrecioCarta`, completo: parseo con `Number()`, orden de los chequeos y mensajes). */
function validarPrecioCartaViejo(valor: unknown): ResultadoCarta {
  if (valor === null || valor === undefined || texto(valor) === "") return { ok: false, mensaje: "Falta el precio." };
  const n = Number(valor);
  if (Number.isNaN(n)) return { ok: false, mensaje: "El precio no tiene un formato válido: usá el punto como separador decimal (por ejemplo, 12.5)." };
  if (!(n >= 0)) return { ok: false, mensaje: "El precio no puede ser negativo." };
  if (!esNumeroFinito(n) || n >= 1e12) return { ok: false, mensaje: "El precio no es un número válido." };
  const abs = Math.abs(n);
  if (!(Math.round(abs * 100) / 100 === abs)) return { ok: false, mensaje: "El precio admite como máximo 2 decimales (por ejemplo, 10.55)." };
  return { ok: true, valor: n };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Los valores: bordes fijos + centavos, milésimos y diezmilésimos alrededor de cada tope + dobles cualquiera (incluye NaN, ±Infinity y -0).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

const BORDES = [
  0, -0, 0.01, -0.01, 0.001, 0.005, 1.005, 10.005, 128.045, -128.045, 0.1 + 0.2, 0.07, 10.01, 1234.56,
  999_999_999_999.99, -999_999_999_999.99, 999_999_999_999.995, 999_999_999_999.999, 1e12, -1e12, 1e12 - 0.01, 1e12 + 0.01, 1e12 - 1, 1e13, 1e14, 1e15, 1e21, -1e21,
  -99.9999, -100, -100.0001, -99.99995, 999.9999, 999.99995, 1000, 0.0001, 0.00001, 5.00001, 1.23456,
  Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MIN_VALUE, -Number.MIN_VALUE, Number.EPSILON, Number.MAX_VALUE, -Number.MAX_VALUE,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 2 ** 53 + 2, 1e-7, 5e-324,
];

/** `entero / divisor`, con `entero` cerca de un tope (los enteros de fast-check llegan a 2^31; el centavo del tope es 10^14). */
function fraccionesCercaDe(tope: number, divisor: number, ancho: number): fc.Arbitrary<number> {
  const centro = BigInt(Math.round(tope * divisor));
  return fc.bigInt({ min: -BigInt(ancho), max: BigInt(ancho) }).chain((d) => fc.constantFrom(Number(centro + d) / divisor, -Number(centro + d) / divisor));
}

const NUMEROS: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(...BORDES),
  fc.double(),
  fc.double({ min: -2e12, max: 2e12 }),
  fc.double({ min: -1000, max: 1000 }),
  fc.integer({ min: -2_000_000, max: 2_000_000 }).map((c) => c / 100),
  fc.integer({ min: -2_000_000, max: 2_000_000 }).map((c) => c / 1000),
  fc.integer({ min: -20_000_000, max: 20_000_000 }).map((c) => c / 10_000),
  fc.integer({ min: -20_000_000, max: 20_000_000 }).map((c) => c / 100_000),
  fc.bigInt({ min: -BigInt(2e14), max: BigInt(2e14) }).map((c) => Number(c) / 100),
  fc.bigInt({ min: -BigInt(2e15), max: BigInt(2e15) }).map((c) => Number(c) / 1000),
  fraccionesCercaDe(IMPORTE_MAXIMO, 100, 1000),
  fraccionesCercaDe(IMPORTE_MAXIMO, 1000, 10_000),
  fraccionesCercaDe(1000, 10_000, 1000),
  fraccionesCercaDe(100, 10_000, 1000),
  fraccionesCercaDe(1000, 100_000, 10_000),
  fraccionesCercaDe(100, 100_000, 10_000),
);

const CORRIDAS = { numRuns: 20_000 };

describe("núcleo de importe: las constantes", () => {
  it("el tope en centavos es exactamente 99999999999999 (el de ajuste-de-precios)", () => {
    expect(CENTAVOS_MAXIMOS).toBe(BigInt("99999999999999"));
    expect(IMPORTE_MAXIMO).toBe(1e12);
  });

  it("los bordes fijos, uno por uno", () => {
    expect([1.005, 999_999_999_999.99, 1e12, -999_999_999_999.99, -0, Number.NaN, Number.POSITIVE_INFINITY, 0.1 + 0.2, 128.04].map(esImporteDeColumna)).toEqual([
      false, true, false, true, true, false, false, false, true,
    ]);
    expect([1e12, 1e15, 1.005, -5.25, Number.NEGATIVE_INFINITY].map(esImporteAlCentavo)).toEqual([true, true, false, true, false]);
    expect([-100, -99.9999, 999.9999, 1000, 1.00001, Number.NaN].map(esPorcentajeDeDiferencia)).toEqual([false, true, true, false, false, false]);
  });
});

describe("equivalencia: cada validador viejo = núcleo + su regla propia (fast-check)", () => {
  it("esMontoValido (validar-configuracion; admite negativos, tope, 2 decimales) = esImporteDeColumna", () => {
    fc.assert(fc.property(NUMEROS, (n) => esImporteDeColumna(n) === esMontoValidoViejo(n)), CORRIDAS);
  });

  it("esImporte (componer-precio-de-linea; decimales con redondearMoneda) = esImporteDeColumna", () => {
    fc.assert(fc.property(NUMEROS, (n) => esImporteDeColumna(n) === esImporteViejo(n)), CORRIDAS);
  });

  it("esPorcentajeValido (validar-configuracion) = esPorcentajeDeDiferencia", () => {
    fc.assert(fc.property(NUMEROS, (p) => esPorcentajeDeDiferencia(p) === esPorcentajeValidoViejo(p)), CORRIDAS);
  });

  it("esPorcentaje (componer-precio-de-linea; decimales con toFixed) = esPorcentajeDeDiferencia", () => {
    fc.assert(fc.property(NUMEROS, (p) => esPorcentajeDeDiferencia(p) === esPorcentajeViejo(p)), CORRIDAS);
  });

  it("esPrecioValido (combinaciones; regla propia: 0,01 o más) = esImporteDeColumna + mínimo", () => {
    fc.assert(fc.property(NUMEROS, (n) => (esImporteDeColumna(n) && n >= IMPORTE_MINIMO) === esPrecioValidoViejo(n)), CORRIDAS);
  });

  it("esImporteVisto (regla propia: un number, 0 o más, SIN tope) = esImporteAlCentavo + su regla", () => {
    const VALORES = fc.oneof(NUMEROS, fc.constantFrom<unknown>("10", "", null, true, {}, [], BigInt(10)));
    fc.assert(fc.property(VALORES, (v) => (typeof v === "number" && v >= 0 && esImporteAlCentavo(v)) === esImporteVistoViejo(v)), CORRIDAS);
  });
});

describe("equivalencia en el código que se usa: el guard del pedido y validarPrecioCarta", () => {
  const VALORES_DE_ENTRADA: fc.Arbitrary<unknown> = fc.oneof(
    NUMEROS,
    NUMEROS.map(String),
    fc.string(),
    fc.constantFrom<unknown>("12,5", "12.5", "1e12", "999999999999.99", "1000000000000", "-0", "0x10", "Infinity", " 7 ", "", "  ", null, true, false, {}, [], [5]),
  );

  it("guardComandoAgregarItems: el precio que vio el mozo (ítem y promo) se acepta si y solo si el esImporteVisto viejo lo aceptaba", () => {
    fc.assert(
      fc.property(VALORES_DE_ENTRADA, (v) => {
        fc.pre(v !== undefined);
        const item = guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, precioDeListaEsperado: v }], promos: [] });
        const promo = guardComandoAgregarItems({ cuentaId: "c", items: [], promos: [{ promoId: "x", elecciones: [], precioEsperado: v }] });
        return item.ok === esImporteVistoViejo(v) && promo.ok === esImporteVistoViejo(v);
      }),
      { numRuns: 5_000 },
    );
  });

  it("validarPrecioCarta da el MISMO resultado y el MISMO mensaje que antes", () => {
    fc.assert(
      fc.property(VALORES_DE_ENTRADA, (v) => {
        expect(validarPrecioCarta(v)).toEqual(validarPrecioCartaViejo(v));
      }),
      CORRIDAS,
    );
  });
});
