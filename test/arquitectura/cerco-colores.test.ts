import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, sinComentarios, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cercos de color (ola «precio y carta», Fase 1; DEC-03: una sola fuente visual, los tokens del salón en `src/app/globals.css`).
 * Meta: bajar hasta 0 en la Fase 6, a medida que cada pantalla pasa a los tokens. Dos líneas de base, en `src/` y `plataforma/src/`,
 * fuera de los comentarios:
 *
 * 1. `colores` — colores escritos a mano, en tres tipos que no se pisan:
 *    - `clase-arbitraria`: una clase de Tailwind con un valor arbitrario que contiene un color (`bg-[#F1EFEA]`,
 *      `shadow-[0_6px_24px_rgba(0,0,0,0.35)]`, `border-[var(--brand,#1f2937)]`, `[color:#fff]`); una clase cuenta UNA vez aunque tenga
 *      varios colores. `bg-[var(--brand)]` NO cuenta: es un token.
 *    - `hex`: un literal `#rgb`, `#rgba`, `#rrggbb` o `#rrggbbaa` fuera de esas clases (en un `style`, un CSS, un `stroke` de un gráfico…).
 *      Un ancla (`href="#seccion"`, `#id`) no cuenta: no tiene la forma de un color o va seguida de más letras.
 *    - `funcion-de-color`: `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(`, `color-mix(` fuera de esas clases.
 * 2. `colores-de-escala` — clases de la escala de color de Tailwind (`text-neutral-500`, `bg-amber-50`, `border-red-300`,
 *    `hover:bg-neutral-100`, `ring-sky-500/40`…) que deberían ser tokens, tipo `escala`; y, aparte, `blanco-negro` (`bg-white`,
 *    `text-black`…), que tampoco son tokens. Una variante `dark:` NO se cuenta acá (la cuenta el cerco «modo oscuro»): solo la clase base.
 *
 * Excepciones (por ruta exacta, con motivo): las fuentes de la paleta (`globals.css` de la app y de la consola) y el tema de la carta del
 * cliente, que valida y resuelve colores que elige el cliente (no colores de la interfaz). Los componentes de la carta pública que
 * derivan colores del tema con `color-mix(…var(--carta-…)…)` NO se exceptúan: quedan congelados en la línea de base.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */

const HEX = String.raw`#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])`;
const FUNCION = String.raw`(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(`;
const RE_HEX = new RegExp(String.raw`(?<![\w&#/])${HEX}`, "g");
const RE_FUNCION = new RegExp(FUNCION, "g");
/** Dentro de una clase arbitraria los espacios van como `_` (`0_6px_24px_rgba(…)`): la función se busca sin mirar qué tiene delante. */
const RE_TIENE_COLOR = new RegExp(String.raw`${HEX}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(`);
/** Un «token» de clase: lo que queda entre espacios, comillas, acentos graves y llaves. */
const RE_TOKEN = /[^\s"'`{}]+/g;
/** Una utilidad con valor arbitrario (`bg-[…]`, `hover:shadow-[…]`) o una propiedad arbitraria (`[color:…]`), con su contenido. */
const RE_ARBITRARIA = /(?:^|:)!?-?[a-z][\w-]*-\[([^\]]+)\]|(?:^|:)\[([\w-]+:[^\]]+)\]/g;

function contarColores(fuente: string): Record<string, number> {
  let arbitrarias = 0;
  let resto = fuente;
  for (const m of fuente.matchAll(RE_TOKEN)) {
    // Todos los segmentos arbitrarios del token: en `has-[:checked]:bg-[#F1EFEA]` el color está en el segundo.
    if ([...m[0].matchAll(RE_ARBITRARIA)].some((a) => RE_TIENE_COLOR.test(a[1] ?? a[2]))) {
      arbitrarias++;
      resto = resto.slice(0, m.index) + " ".repeat(m[0].length) + resto.slice(m.index + m[0].length);
    }
  }
  return { "clase-arbitraria": arbitrarias, hex: contarCoincidencias(resto, RE_HEX), "funcion-de-color": contarCoincidencias(resto, RE_FUNCION) };
}

const PALETA = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILIDAD = "bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|accent|caret|decoration|placeholder|from|via|to|shadow|inset-shadow|inset-ring";
const RE_ESCALA = new RegExp(String.raw`(?:^|:)!?(?:${UTILIDAD})-(?:${PALETA})-(?:50|[1-9]00|950)(?:\/[\w.%[\]]+)?!?[;,]?$`);
const RE_BLANCO_NEGRO = new RegExp(String.raw`(?:^|:)!?(?:${UTILIDAD})-(?:white|black)(?:\/[\w.%[\]]+)?!?[;,]?$`);

function contarColoresDeEscala(fuente: string): Record<string, number> {
  const cuenta = { escala: 0, "blanco-negro": 0 };
  for (const [token] of fuente.matchAll(RE_TOKEN)) {
    const escala = RE_ESCALA.exec(token);
    const blancoNegro = escala ? null : RE_BLANCO_NEGRO.exec(token);
    const m = escala ?? blancoNegro;
    if (!m) continue;
    // `dark:bg-neutral-900`, `dark:hover:bg-x`, `md:dark:bg-x`: la variante oscura la cuenta el cerco «modo oscuro».
    if (/(?:^|:)dark:/.test(token.slice(0, m.index + 1))) continue;
    if (escala) cuenta.escala++;
    else cuenta["blanco-negro"]++;
  }
  return cuenta;
}

const RAICES = ["src", "plataforma/src"];
const EXTENSIONES = [".ts", ".tsx", ".css"];

const CERCO_COLORES: Cerco = {
  regla: "colores",
  meta: "0 en la Fase 6 (DEC-03: los colores salen de los tokens de globals.css)",
  medir: medirPorArchivo({ raices: RAICES, extensiones: EXTENSIONES, contar: contarColores }),
  excepciones: [
    { ruta: "src/app/globals.css", motivo: "Es la fuente de la paleta: define los tokens (`--paper`, `--ink`, `--brand`, `--mesa-*`, …) que el resto usa." },
    { ruta: "plataforma/src/app/globals.css", motivo: "Es la fuente de la paleta de la consola de plataforma (otra app Next): define sus tokens (`--fondo`, `--texto`, `--acento`, …)." },
    {
      ruta: "src/core/carta/color-css.ts",
      motivo: "Tema de la carta del cliente: copia literal del saneador de colores de la carta (`sanitizeCssColor`, `resolveHeroInk`); sus `oklch(…)` son la tinta clara/oscura que resuelve el contraste sobre el color que eligió el cliente.",
    },
    {
      ruta: "src/core/carta/tema.ts",
      motivo: "Tema de la carta del cliente: catálogo de claves y validación de los colores que carga el cliente; el literal es el ejemplo del mensaje de error («ej. #8b4513, rgb(…)»), no un color de la interfaz.",
    },
  ],
};

const CERCO_COLORES_DE_ESCALA: Cerco = {
  regla: "colores-de-escala",
  meta: "0 en la Fase 6 (DEC-03: las clases de color de Tailwind pasan a los tokens del salón)",
  medir: medirPorArchivo({ raices: RAICES, extensiones: EXTENSIONES, contar: contarColoresDeEscala }),
};

describe("cerco «colores»: el detector", () => {
  const contar = (fuente: string, ruta = "x.tsx") => contarColores(sinComentarios(fuente, ruta));

  it("una clase arbitraria con color cuenta una vez y no se vuelve a contar como hex o función", () => {
    expect(contar('<p className="has-[:checked]:bg-[#F1EFEA] aria-[current=date]:border-[var(--brand,#1f2937)]">x</p>')).toEqual({ "clase-arbitraria": 2, hex: 0, "funcion-de-color": 0 });
    expect(contar('<p className="bg-[#F1EFEA] hover:bg-[#FCEFC7] shadow-[0_6px_24px_rgba(0,0,0,0.35)] border-[var(--brand,#1f2937)] [color:#fff]">x</p>')).toEqual({
      "clase-arbitraria": 5,
      hex: 0,
      "funcion-de-color": 0,
    });
  });

  it("un token arbitrario (bg-[var(--brand)]) o una medida (text-[13px]) no cuentan", () => {
    expect(contar('<p className="bg-[var(--brand)] text-[13px] min-h-[48px] has-[:checked]:border-[var(--brand)]">x</p>')).toEqual({ "clase-arbitraria": 0, hex: 0, "funcion-de-color": 0 });
  });

  it("hex y funciones sueltos (style, CSS, gráficos) cuentan; las anclas, las entidades y los comentarios no", () => {
    expect(contar('<Line stroke="#3b82f6" /><p style={{ color: "#fff", background: "color-mix(in oklch, var(--x) 90%, transparent)" }} />')).toEqual({
      "clase-arbitraria": 0,
      hex: 2,
      "funcion-de-color": 1,
    });
    expect(contar('<a href="#seccion-2">x</a><a href="#productos">y</a><p>&#123;</p>{/* #ffffff */}')).toEqual({ "clase-arbitraria": 0, hex: 0, "funcion-de-color": 0 });
    expect(contar("a { color: #000; background: rgb(0 0 0 / 50%); } /* #fff */", "x.css")).toEqual({ "clase-arbitraria": 0, hex: 1, "funcion-de-color": 1 });
  });
});

describe("cerco «colores de escala»: el detector", () => {
  const contar = (fuente: string, ruta = "x.tsx") => contarColoresDeEscala(sinComentarios(fuente, ruta));

  it("cuenta la clase base (con o sin variantes no oscuras y con opacidad), no su variante dark:", () => {
    expect(contar('<p className="text-neutral-500 dark:text-neutral-400 hover:bg-amber-50 ring-sky-500/40 md:dark:bg-neutral-900 dark:hover:bg-red-950">x</p>')).toEqual({
      escala: 3,
      "blanco-negro": 0,
    });
    expect(contar('<p className="bg-white text-black dark:bg-black border-white/10">x</p>')).toEqual({ escala: 0, "blanco-negro": 3 });
  });

  it("no cuenta un token (bg-[var(--paper)]), un tamaño (text-sm) ni un comentario", () => {
    expect(contar('// antes: text-neutral-500\n<p className="bg-[var(--paper)] text-sm text-neutral-x">x</p>')).toEqual({ escala: 0, "blanco-negro": 0 });
  });

  it("cuenta también en CSS (@apply)", () => {
    expect(contar(".a { @apply bg-neutral-100 text-neutral-900; }", "x.css")).toEqual({ escala: 2, "blanco-negro": 0 });
  });
});

probarCerco(CERCO_COLORES);
probarCerco(CERCO_COLORES_DE_ESCALA);
