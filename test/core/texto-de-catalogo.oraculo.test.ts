import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FICHAS_DE_TEXTO, claveDeNombre, nombreDeEleccionDesdeTexto, nombreDeProductoDesdeTexto, nombreODenominacionDesdeTexto, textoDeFichaDesdeTexto } from "@/core/datos/fichas-de-texto";
import { textoDeUnaLineaDesdeTexto } from "@/core/datos/texto-de-catalogo";
import {
  ACEPTADOS_POR_NORMALIZACION,
  DECLARACION_DE_FICHAS,
  E_EN_DOS_PIEZAS,
  FICHAS,
  FILAS,
  FUNCIONES_POR_FICHA,
  LETRAS,
  LETRA_DE_LOS_LARGOS,
  MOTIVOS,
  PERMITIDOS_BASE,
  PERMITIDOS_DE_CATALOGO,
  SIGNOS_SOLO_DE_CATALOGO,
  type Esperado,
  type Ficha,
} from "./oraculo-texto-de-catalogo";

/**
 * Recorre el oráculo de la regla de texto de catálogo (`oraculo-texto-de-catalogo.ts`, escrito aparte del código) contra la regla, en TODAS las combinaciones
 * ficha × fila, más: los largos límite de cada ficha, un barrido de los 65.536 caracteres del plano básico contra el conjunto permitido escrito a mano, y
 * propiedades (idempotencia, nada fuera de lo permitido, nunca lanza) con fast-check.
 */
const MOTIVO_DE: Readonly<Record<string, string>> = { "!CAR": "CARACTER_PROHIBIDO", "!LARGO": "DEMASIADO_LARGO", "!VACIO": "VACIO", "!LETRA": "SIN_LETRAS" };

function comoResultadoEsperado(texto: string, esperado: Esperado): { ok: true; valor: string } | { ok: false; error: string } {
  if (esperado.startsWith("!")) return { ok: false, error: MOTIVO_DE[esperado] ?? `motivo no declarado ${esperado}` };
  return { ok: true, valor: esperado === "=" ? texto : esperado };
}

const FUNCION_DE: Readonly<Record<Ficha, (t: unknown) => ReturnType<typeof nombreDeProductoDesdeTexto>>> = {
  PRODUCTO: nombreDeProductoDesdeTexto,
  ELECCION: nombreDeEleccionDesdeTexto,
  RAZON_SOCIAL: nombreODenominacionDesdeTexto,
};

describe("oráculo · cada fila × cada ficha", () => {
  for (const ficha of FICHAS) {
    for (const f of FILAS) {
      it(`${ficha} · ${JSON.stringify(f.texto.length > 40 ? `${f.texto.slice(0, 20)}… (${f.texto.length})` : f.texto)} → ${f.esperado[ficha]}`, () => {
        const esperado = comoResultadoEsperado(f.texto, f.esperado[ficha]);
        expect(textoDeFichaDesdeTexto(ficha, f.texto)).toEqual(esperado);
        expect(FUNCION_DE[ficha](f.texto)).toEqual(esperado);
      });
    }
  }

  it("las filas usan todos los motivos declarados (ningún motivo queda sin ejemplo) y solo esos", () => {
    const usados = new Set(FILAS.flatMap((f) => FICHAS.map((x) => f.esperado[x])).filter((e) => e.startsWith("!")).map((e) => MOTIVO_DE[e]));
    // El largo se ejercita en el bloque de largos de abajo (no hay fila de 81 letras escrita a mano).
    usados.add("DEMASIADO_LARGO");
    expect([...usados].sort()).toEqual([...MOTIVOS].sort());
  });
});

describe("oráculo · la tabla de fichas dice lo declarado", () => {
  it.each(FICHAS)("%s: largo, letra y signos de catálogo", (ficha) => {
    expect(FICHAS_DE_TEXTO[ficha]).toEqual(DECLARACION_DE_FICHAS[ficha]);
  });
  it("cada función con nombre usa la ficha que el oráculo le asigna (el resultado de un caso que distingue fichas)", () => {
    // «12» solo lo acepta la ficha que no exige letra; «¿Hola?» solo las que suman signos de catálogo.
    expect(nombreDeProductoDesdeTexto("12").ok).toBe(false);
    expect(nombreDeEleccionDesdeTexto("12").ok).toBe(true);
    expect(nombreODenominacionDesdeTexto("¿Hola?").ok).toBe(false);
    expect(Object.keys(FUNCIONES_POR_FICHA).sort()).toHaveLength(FICHAS.length);
  });
});

describe("oráculo · largos límite por ficha (contados por carácter, después de normalizar)", () => {
  for (const ficha of FICHAS) {
    const { maximo } = DECLARACION_DE_FICHAS[ficha];
    it(`${ficha}: ${maximo} entra, ${maximo + 1} no`, () => {
      expect(textoDeFichaDesdeTexto(ficha, LETRA_DE_LOS_LARGOS.repeat(maximo))).toEqual({ ok: true, valor: LETRA_DE_LOS_LARGOS.repeat(maximo) });
      expect(textoDeFichaDesdeTexto(ficha, LETRA_DE_LOS_LARGOS.repeat(maximo + 1))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
      expect(textoDeFichaDesdeTexto(ficha, LETRA_DE_LOS_LARGOS.repeat(maximo - 1))).toEqual({ ok: true, valor: LETRA_DE_LOS_LARGOS.repeat(maximo - 1) });
    });
    it(`${ficha}: el largo se cuenta DESPUÉS de normalizar (la «é» de dos piezas cuenta uno) y los espacios repetidos cuentan uno`, () => {
      expect(textoDeFichaDesdeTexto(ficha, E_EN_DOS_PIEZAS.repeat(maximo))).toEqual({ ok: true, valor: "é".repeat(maximo) });
      expect(textoDeFichaDesdeTexto(ficha, `${"A".repeat(maximo - 1)}${" ".repeat(10)}`)).toEqual({ ok: true, valor: "A".repeat(maximo - 1) });
      expect(textoDeFichaDesdeTexto(ficha, `${"A".repeat(maximo - 2)}${"\u00a0".repeat(5)}A`)).toEqual({ ok: true, valor: `${"A".repeat(maximo - 2)} A` });
    });
    it(`${ficha}: el carácter prohibido se informa antes que el largo, y el largo antes que la falta de letras`, () => {
      expect(textoDeFichaDesdeTexto(ficha, `${"A".repeat(maximo + 1)}<`)).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
      expect(textoDeFichaDesdeTexto(ficha, "1".repeat(maximo + 1))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
    });
  }
});

describe("oráculo · lo que no es texto no pasa y no lanza", () => {
  it.each([undefined, null, 42, true, {}, ["Café"], Symbol("x")])("%j → VACIO", (valor) => {
    for (const ficha of FICHAS) expect(textoDeFichaDesdeTexto(ficha, valor)).toEqual({ ok: false, error: "VACIO" });
  });
});

describe("oráculo · barrido de los 65.536 caracteres del plano básico", () => {
  const aceptadosPorNormalizacion = new Map(ACEPTADOS_POR_NORMALIZACION.map((a) => [a.caracter, a.queda]));
  for (const [nombre, permitidos, conSignosDeCatalogo] of [
    ["lista base", PERMITIDOS_BASE, false],
    ["lista de catálogo", PERMITIDOS_DE_CATALOGO, true],
  ] as const) {
    it(`${nombre}: un carácter entre dos dígitos se acepta si y solo si está en el conjunto escrito a mano (o es de los aceptados por normalización)`, () => {
      const distintos: string[] = [];
      for (let c = 0; c <= 0xffff; c++) {
        const caracter = String.fromCharCode(c);
        const r = textoDeUnaLineaDesdeTexto(`1${caracter}1`, { maximo: 10, exigirUnaLetra: false, conSignosDeCatalogo });
        const queda = aceptadosPorNormalizacion.get(caracter);
        const esperado = queda !== undefined ? { ok: true, valor: `1${queda}1` } : permitidos.includes(caracter) ? { ok: true, valor: `1${caracter}1` } : { ok: false, error: "CARACTER_PROHIBIDO" };
        // `+` y `-` solo molestan al principio: acá van en el medio.
        if (JSON.stringify(r) !== JSON.stringify(esperado)) distintos.push(`U+${c.toString(16).padStart(4, "0")} ${JSON.stringify(r)}`);
      }
      expect(distintos).toEqual([]);
    });
  }

  it("los signos de catálogo no están en la lista base y la lista base está contenida en la de catálogo", () => {
    for (const s of SIGNOS_SOLO_DE_CATALOGO) expect(PERMITIDOS_BASE.includes(s)).toBe(false);
    for (const c of PERMITIDOS_BASE) expect(PERMITIDOS_DE_CATALOGO.includes(c)).toBe(true);
  });

  it("un carácter de otro plano (emoji, ideogramas antiguos) se rechaza", () => {
    for (const c of ["😀", "𝒜", "𠀀", "🇦🇷"]) expect(textoDeUnaLineaDesdeTexto(`1${c}1`, { maximo: 10, exigirUnaLetra: false, conSignosDeCatalogo: true })).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });

  it("`+` y `-` en el medio o al final pasan; al principio no (también después de recortar)", () => {
    for (const t of ["a+b", "a-b", "a+", "a-", "1+1"]) expect(textoDeUnaLineaDesdeTexto(t, { maximo: 10, exigirUnaLetra: false }).ok).toBe(true);
    for (const t of ["+a", "-a", "  +a", "\n-a", "+", "-"]) expect(textoDeUnaLineaDesdeTexto(t, { maximo: 10, exigirUnaLetra: false })).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });
});

describe("oráculo · claveDeNombre (la que compara dos nombres)", () => {
  it("«Café», «CAFÉ» y «Café» de dos piezas tienen la misma clave; «Cafe» no", () => {
    const clave = claveDeNombre("Café");
    expect(claveDeNombre("CAFÉ")).toBe(clave);
    expect(claveDeNombre("Café")).toBe(clave);
    expect(claveDeNombre("Cafe")).not.toBe(clave);
  });
});

describe("propiedades · lo que acepta la regla, sea cual sea la entrada", () => {
  const reglas = [
    { maximo: 30, exigirUnaLetra: true, conSignosDeCatalogo: true },
    { maximo: 30, exigirUnaLetra: false, conSignosDeCatalogo: false },
  ] as const;
  const cualquiera = fc.oneof(fc.string({ maxLength: 60 }), fc.string({ unit: "grapheme", maxLength: 40 }), fc.stringMatching(/^[A-Za-zÀ-ÿ0-9 .,&'/()+:;"#¿?!%$_<>=@\n\t-]{0,50}$/));

  it("nunca lanza; si acepta, el valor está recortado, en NFC, sin espacios repetidos, con solo lo permitido, dentro del largo, sin `+`/`-` al principio y es estable", () => {
    for (const r of reglas) {
      const permitidos = r.conSignosDeCatalogo ? PERMITIDOS_DE_CATALOGO : PERMITIDOS_BASE;
      fc.assert(
        fc.property(cualquiera, (texto) => {
          const res = textoDeUnaLineaDesdeTexto(texto, r);
          if (!res.ok) return MOTIVOS.includes(res.error);
          const v = res.valor;
          return (
            v === v.trim() &&
            v === v.normalize("NFC") &&
            !v.includes("  ") &&
            [...v].every((c) => permitidos.includes(c)) &&
            [...v].length >= 1 &&
            [...v].length <= r.maximo &&
            !/^[+-]/.test(v) &&
            (!r.exigirUnaLetra || [...v].some((c) => LETRAS.includes(c))) &&
            JSON.stringify(textoDeUnaLineaDesdeTexto(v, r)) === JSON.stringify(res)
          );
        }),
        { numRuns: 1500 },
      );
    }
  });

  it("un texto armado solo con lo permitido, que no empieza con `+`/`-`, entra tal cual si no tiene espacios en los extremos ni repetidos y cabe", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...[...PERMITIDOS_DE_CATALOGO].filter((c) => c !== " ")), { minLength: 1, maxLength: 30 }), (letras) => {
        const texto = letras.join("");
        if (/^[+-]/.test(texto)) return true;
        const res = textoDeUnaLineaDesdeTexto(texto, { maximo: 30, exigirUnaLetra: false, conSignosDeCatalogo: true });
        return res.ok && res.valor === texto.normalize("NFC");
      }),
      { numRuns: 1500 },
    );
  });
});
