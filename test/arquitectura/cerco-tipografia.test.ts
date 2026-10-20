import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, probarCerco, sinComentarios, type Cerco } from "./cercos/trinquete";

/**
 * Cerco «tipografía» (ola «precio y carta», Fase 1; auditoría §19.4: «el error del café más grande fue de escala tipográfica, no de
 * color»). Cuenta los tamaños de letra escritos a mano, fuera de los comentarios:
 *  - `fontSize-literal`: `fontSize:` con un número o un string con una medida (`fontSize: 12`, `fontSize: "1.0625rem"`,
 *    `fontSize: "clamp(1rem, 2vw, 1.5rem)"`). `fontSize: v.carta_fuente_item_nombre` (el tema) o `fontSize: "var(--x)"` no cuentan.
 *  - `clase-arbitraria`: `text-[13px]`, `text-[0.9rem]`, `text-[length:12px]` (una medida literal en px, rem, em o pt). `text-[var(--ink)]`
 *    es un color-token y `text-[length:var(--x)]` un token de medida: no cuentan.
 *  - `font-size-literal`: `font-size:` (CSS, o CSS dentro de un string) con una medida literal, también como respaldo de un `var()`.
 *  - `constante-de-tamano`: una constante cuyo valor es SOLO una medida (`const PISO_ACLARACION = "0.875rem"`) y que el archivo usa como
 *    tamaño de letra (`fontSize: PISO_ACLARACION`) o que por su nombre lo es (`PISO_*`, `*FUENTE*`, `*FONT*`). Así los pisos de
 *    `carta-publica/seccion.tsx` no se esconden detrás de un nombre.
 * Las clases de la escala de Tailwind (`text-sm`, `text-lg`) no cuentan: son una escala, no un tamaño a mano.
 *
 * Dos líneas de base: `tipografia` (todo `src/` y `plataforma/src/`) y `carta-publica-tipografia` (solo `src/components/carta-publica/`,
 * meta 0 en la Fase 5: un solo piso para todo ítem y ningún bloque escribe su propio tamaño; el tema del cliente sigue mandando con
 * `carta_fuente_*`). El tema de la carta (`core/carta/tema.ts`, `estilo.ts`, `css-valores.ts`) guarda sus defaults como `defaultCarta:`
 * y los valida como cadenas: los detectores no los marcan, así que no hace falta exceptuarlos (una excepción sin violaciones sobra).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const MEDIDA = String.raw`\d*\.?\d+(?:px|rem|em|pt)\b`;
const RE_FONTSIZE_LITERAL = new RegExp(String.raw`(?<![\w-])fontSize\s*:\s*(?:-?\d|["'\`](?:(?!var\()[^"'\`$\n])*?${MEDIDA})`, "g");
const RE_CLASE_ARBITRARIA = new RegExp(String.raw`(?<![\w-])text-\[(?:length:)?[^\]\s]*?${MEDIDA}[^\]\s]*\]`, "g");
const RE_FONT_SIZE_CSS = new RegExp(String.raw`(?<![\w-])font-size\s*:\s*[^;{}"'\`\n]*?${MEDIDA}`, "g");
const RE_CONSTANTE = new RegExp(String.raw`\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*["'\`]${MEDIDA}["'\`]`, "g");

function contarTipografia(fuente: string): Record<string, number> {
  let constantes = 0;
  for (const m of fuente.matchAll(RE_CONSTANTE)) {
    const nombre = m[1];
    const usadaComoFuente = new RegExp(String.raw`(?<![\w-])fontSize\s*:\s*${nombre.replace(/\$/g, "\\$")}\b`).test(fuente);
    if (usadaComoFuente || /piso|fuente|font/i.test(nombre)) constantes++;
  }
  return {
    "fontSize-literal": contarCoincidencias(fuente, RE_FONTSIZE_LITERAL),
    "clase-arbitraria": contarCoincidencias(fuente, RE_CLASE_ARBITRARIA),
    "font-size-literal": contarCoincidencias(fuente, RE_FONT_SIZE_CSS),
    "constante-de-tamano": constantes,
  };
}

const CERCO_TIPOGRAFIA: Cerco = {
  regla: "tipografia",
  meta: "bajar hacia 0 a medida que la escala tipográfica pase a tokens (auditoría §19.4); la carta pública tiene su propia línea de base",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx", ".css"], contar: contarTipografia }),
};

const CERCO_CARTA_PUBLICA: Cerco = {
  regla: "carta-publica-tipografia",
  meta: "0 en la Fase 5 (DEC-35: un solo piso de letra para todo plato; ningún bloque de la carta escribe su propio tamaño)",
  medir: medirPorArchivo({ raices: ["src/components/carta-publica"], extensiones: [".ts", ".tsx", ".css"], contar: contarTipografia }),
};

describe("cerco «tipografía»: el detector", () => {
  const contar = (fuente: string, ruta = "x.tsx") => contarTipografia(sinComentarios(fuente, ruta));
  const nada = { "fontSize-literal": 0, "clase-arbitraria": 0, "font-size-literal": 0, "constante-de-tamano": 0 };

  it("fontSize con un número o una medida literal cuenta; con el tema, un var() o una variable sin medida, no", () => {
    expect(contar('<p style={{ fontSize: "1.0625rem" }} /><XAxis tick={{ fontSize: 12 }} /><p style={{ fontSize: "clamp(1rem, 2vw, 1.5rem)" }} />')).toEqual({ ...nada, "fontSize-literal": 3 });
    expect(contar("<p style={{ fontSize: v.carta_fuente_item_nombre }} /><p style={{ fontSize: \"var(--x)\" }} /><p style={{ fontSize: tamano }} />")).toEqual(nada);
  });

  it("text-[medida] cuenta; text-[var(--ink)], text-[length:var(--x)] y text-sm no", () => {
    expect(contar('<p className="text-[13px] md:text-[0.9rem] text-[length:12px] text-[var(--ink)] text-[length:var(--fs)] text-sm">x</p>')).toEqual({ ...nada, "clase-arbitraria": 3 });
  });

  it("font-size con medida literal cuenta (también de respaldo de un var), en CSS o en un string; con var() solo, no", () => {
    expect(contar(".a { font-size: 13.5px; } .b { font-size: var(--x, clamp(0.7rem, 1.8vw, 0.75rem)); } .c { font-size: var(--x); } /* font-size: 9px */", "x.css")).toEqual({
      ...nada,
      "font-size-literal": 2,
    });
    expect(contar('const css = "h1 { font-size: 2rem }";', "x.ts")).toEqual({ ...nada, "font-size-literal": 1 });
  });

  it("una constante de medida cuenta si se usa como tamaño de letra o si su nombre lo dice; una medida de otra cosa, no", () => {
    expect(contar('const PISO_ACLARACION = "0.875rem";\nconst GRANDE = "2rem";\nconst ANCHO = "12rem";\n<p style={{ fontSize: GRANDE, width: ANCHO }} />')).toEqual({ ...nada, "constante-de-tamano": 2 });
  });
});

probarCerco(CERCO_TIPOGRAFIA);
probarCerco(CERCO_CARTA_PUBLICA);
