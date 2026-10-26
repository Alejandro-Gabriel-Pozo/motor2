import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, sinComentarios, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «primitivas de dominio» (ola «precio y carta», Fase 1; auditoría §3.6 y §19.4): la validación de un importe o de un porcentaje
 * vive en UN lugar, `src/core/datos/importe.ts` (`validarImporte`, `IMPORTE_MAXIMO`). Cuenta, fuera de ese archivo y de los comentarios:
 *  - `tope-1e12`: el tope de las columnas `Decimal(14,2)` escrito a mano (`1e12`, `1_000_000_000_000`, `1000000000000`) en vez de
 *    `IMPORTE_MAXIMO`;
 *  - `tope-en-centavos`: el mismo tope en centavos (`BigInt("99999999999999")`, `99999999999999n`);
 *  - `validador:<nombre>`: cada DEFINICIÓN local de uno de los siete validadores de importe/porcentaje que repiten la regla
 *    (`esImporte`, `esMontoValido`, `esPrecioValido`, `esImporteVisto`, `esPorcentaje`, `esPorcentajeValido`, `validarPrecioCarta`).
 *    Tienen reglas DISTINTAS (unos admiten negativos, otros exigen ≥ 0,01 o no tienen tope): este cerco solo los cuenta y congela;
 *    unificarlos es trabajo de la Fase 2, con cuidado de no cambiar qué se acepta.
 * La lista de nombres es cerrada a propósito: un patrón genérico (`validar*Precio*`) atrapa validadores legítimos que delegan en
 * `validarImporte` (`validarPrecio` del guard del precio local) o que no son de dinero (`validarPorcentaje` de un CSS de la carta).
 * Meta: bajar en la Fase 2.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const VALIDADORES = ["esImporte", "esMontoValido", "esPrecioValido", "esImporteVisto", "esPorcentaje", "esPorcentajeValido", "validarPrecioCarta"];
const RE_TOPE = /(?<![\w.])(?:1e12|1_000_000_000_000|1000000000000)(?![\w.])/g;
const RE_TOPE_EN_CENTAVOS = /\bBigInt\(\s*["'`]?9{14}["'`]?\s*\)|(?<![\w.])9{14}n\b/g;
const RE_DEFINICION = new RegExp(String.raw`(?:\bfunction\s*\*?\s*|\b(?:const|let|var)\s+)(${VALIDADORES.join("|")})\b`, "g");

function contarPrimitivas(fuente: string): Record<string, number> {
  const cuenta: Record<string, number> = { "tope-1e12": contarCoincidencias(fuente, RE_TOPE), "tope-en-centavos": contarCoincidencias(fuente, RE_TOPE_EN_CENTAVOS) };
  for (const m of fuente.matchAll(RE_DEFINICION)) cuenta[`validador:${m[1]}`] = (cuenta[`validador:${m[1]}`] ?? 0) + 1;
  return cuenta;
}

const CERCO_PRIMITIVAS: Cerco = {
  regla: "primitivas-de-dominio",
  meta: "bajar en la Fase 2: importe y porcentaje se validan solo con core/datos/importe.ts (sin cambiar qué se acepta)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx"], contar: contarPrimitivas }),
  excepciones: [{ ruta: "src/core/datos/importe.ts", motivo: "Es la fuente única: define `IMPORTE_MAXIMO = 1e12` y `validarImporte`, que el resto debería usar." }],
};

describe("cerco «primitivas de dominio»: el detector", () => {
  const contar = (fuente: string) => contarPrimitivas(sinComentarios(fuente, "x.ts"));

  it("cuenta el tope escrito a mano (en sus tres formas y en centavos) y no en un comentario ni dentro de otro número", () => {
    expect(contar("if (n >= 1e12) x();\nconst A = 1_000_000_000_000;\nconst B = 1000000000000;\nconst C = BigInt(\"99999999999999\");\nconst D = 99999999999999n;\n// 1e12\nconst E = 11e12 + 1e123;")).toEqual({
      "tope-1e12": 3,
      "tope-en-centavos": 2,
    });
  });

  it("cuenta cada definición local de los validadores (function, const, let) y no una llamada ni un nombre más largo", () => {
    const fuente = [
      "function esImporte(n: number) { return n >= 0; }",
      "export const esPorcentaje = (p: number) => p <= 100;",
      "export function validarPrecioCarta(v: unknown) { return v; }",
      "const ok = esImporte(3) && esPorcentajeValidoDeVerdad(4);",
      "import { esMontoValido } from './otro';",
    ].join("\n");
    expect(contar(fuente)).toEqual({ "tope-1e12": 0, "tope-en-centavos": 0, "validador:esImporte": 1, "validador:esPorcentaje": 1, "validador:validarPrecioCarta": 1 });
  });
});

probarCerco(CERCO_PRIMITIVAS);
