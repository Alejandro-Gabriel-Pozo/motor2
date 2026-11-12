import { describe, expect, it } from "vitest";
import { type Cerco, medirPorArchivo } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «tope de líneas por archivo» (pedido del orquestador al dueño, 2026-11-12, PR 2 de «Todo nace cerrado»; diseño `docs/diseno-fallo-cerrado-2026-11-11.md`): un archivo de `src/` no pasa de 400 líneas.
 * Un archivo grande mezcla responsabilidades, se revisa mal y esconde cambios: el tope obliga a partirlo antes de que crezca. Cuenta, por archivo `.ts`/`.tsx` de `src/` que pasa de 400 líneas (las líneas del
 * archivo, como `wc -l`, comentarios incluidos), cuántas líneas se pasa («lineas-sobre-400» = líneas − 400). Contar el exceso (y no solo «está o no está») impide que un archivo ya grande siga creciendo:
 * crecer sube la cuenta y el trinquete falla; partirlo la baja. Los archivos que ya pasaban el tope al instalar el cerco son deuda con vencimiento (`cercos/vencimientos.ts`, máximo 60 días); un archivo
 * nuevo que lo pase no entra. Alcance: solo `src/` (no `plataforma/src/`, `scripts/` ni `test/`).
 * Meta: 0 (cada archivo se parte por responsabilidad en un trabajo aparte; este cerco no parte ninguno).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const TOPE_DE_LINEAS = 400;

/** Las líneas de un texto como las cuenta `wc -l` (saltos de línea; sin contar un último renglón vacío). */
function lineasDe(texto: string): number {
  if (texto === "") return 0;
  const partes = texto.split("\n");
  return texto.endsWith("\n") ? partes.length - 1 : partes.length;
}

function contar(fuente: string): Record<string, number> {
  return { "lineas-sobre-400": Math.max(0, lineasDe(fuente) - TOPE_DE_LINEAS) };
}

const CERCO_TOPE_DE_LINEAS: Cerco = {
  regla: "tope-de-lineas",
  meta: "0 (ningún archivo de src/ pasa de 400 líneas: cada uno se parte por responsabilidad en un trabajo aparte)",
  medir: medirPorArchivo({ raices: ["src"], extensiones: [".ts", ".tsx"], contar }),
};

describe("cerco «tope de líneas»: el detector", () => {
  const archivo = (n: number, final = "\n") => Array.from({ length: n }, (_, i) => `const a${i} = ${i};`).join("\n") + final;

  it("cuenta cuántas líneas se pasa del tope", () => {
    expect(contar(archivo(401))).toEqual({ "lineas-sobre-400": 1 });
    expect(contar(archivo(450))).toEqual({ "lineas-sobre-400": 50 });
    expect(contar(archivo(401, ""))).toEqual({ "lineas-sobre-400": 1 });
  });

  it("no cuenta un archivo de exactamente 400 líneas ni uno más chico, vacío o sin salto final", () => {
    expect(contar(archivo(400))).toEqual({ "lineas-sobre-400": 0 });
    expect(contar(archivo(400, ""))).toEqual({ "lineas-sobre-400": 0 });
    expect(contar(archivo(10))).toEqual({ "lineas-sobre-400": 0 });
    expect(contar("")).toEqual({ "lineas-sobre-400": 0 });
  });

  it("cuenta lo mismo que wc -l (el último salto de línea no suma una línea)", () => {
    expect(lineasDe("a\nb\n")).toBe(2);
    expect(lineasDe("a\nb")).toBe(2);
    expect(lineasDe("\n")).toBe(1);
  });
});

probarCerco(CERCO_TOPE_DE_LINEAS);
