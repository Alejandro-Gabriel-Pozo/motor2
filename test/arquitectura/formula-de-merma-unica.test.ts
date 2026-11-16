import { describe, expect, it } from "vitest";
import { medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";
import { contarFormulaDeMermaAMano } from "./formula-de-merma-unica-apoyo";

/**
 * Cerco «fórmula de merma única» (M0 de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`, DT-M10; decisión del dueño del 2026-11-15: «Sí, copiar a Pedernal en esas cinco», incluye la merma
 * sobre el bruto): el factor `1 + merma/100` vivía escrito nueve veces en cinco archivos. Ahora lo calcula UNA función (`factorDeMerma` / `factorDeMermaExacto`, `src/core/catalogo/merma.ts`, por la fachada
 * `@/core/catalogo/public`) y este cerco falla si la expresión vuelve a aparecer escrita a mano fuera de ese archivo, así la fórmula no puede volver a divergir entre venta, producción, costos y reportes.
 * Meta: 0, alcanzada el mismo día de nacer (M0). Mira el AST de `src/` y `plataforma/src/` (no `scripts/`, que arma datos de demostración): un comentario o un string no cuentan; los archivos de prueba tampoco.
 * Cómo se arregla una violación: llamar a `factorDeMerma(merma)` (number) o `factorDeMermaExacto(merma)` (decimal) y multiplicar como antes, SIN reordenar las multiplicaciones (cambia los últimos bits).
 * LÍMITES del detector, uno con ejemplo cada uno: `formula-de-merma-unica-apoyo.ts`. Las violaciones inyectadas, una por forma: `formula-de-merma-unica-evasiones.test.ts`.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const EXTENSIONES = [".ts", ".tsx", ".mts", ".cts"];
const ES_DE_PRUEBA = /\.(?:test|spec)\.[a-z]+$|(?:^|\/)tests?\//;

function contar(fuente: string, ruta: string): Record<string, number> {
  return { "formula-de-merma-a-mano": contarFormulaDeMermaAMano(fuente, ruta) };
}

const CERCO_FORMULA_DE_MERMA_UNICA: Cerco = {
  regla: "formula-de-merma-unica",
  meta: "0 (el factor 1 + merma/100 se calcula en un solo lugar: src/core/catalogo/merma.ts). Alcanzada en M0",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: EXTENSIONES, incluir: (ruta) => !ES_DE_PRUEBA.test(ruta), contar }),
  excepciones: [
    {
      ruta: "src/core/catalogo/merma.ts",
      motivo: "Es el módulo único: acá se ESCRIBE la fórmula (una vez) para que nadie más la escriba.",
    },
  ],
};

describe("cerco «fórmula de merma única»: el detector mira código real", () => {
  it("cuenta la fórmula escrita a mano y no la de un archivo de prueba", () => {
    expect(contar("export const f = (m: number) => 1 + m_merma / 100;", "x.ts")).toEqual({ "formula-de-merma-a-mano": 1 });
    expect(contar("export const f = (m: number) => factorDeMerma(m);", "x.ts")).toEqual({ "formula-de-merma-a-mano": 0 });
    expect(ES_DE_PRUEBA.test("src/core/a.test.ts")).toBe(true);
    expect(ES_DE_PRUEBA.test("src/core/a.ts")).toBe(false);
  });
});

probarCerco(CERCO_FORMULA_DE_MERMA_UNICA, "Usá `factorDeMerma` / `factorDeMermaExacto` de `@/core/catalogo/public` en vez de escribir `1 + merma / 100`.");
