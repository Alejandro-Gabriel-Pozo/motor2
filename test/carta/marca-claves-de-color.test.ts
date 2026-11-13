import { describe, expect, it } from "vitest";
import { CLAVES_PORTAL_V1 } from "@/core/carta/portal";
import { CLAVES_TEMA_V1 } from "@/core/carta/tema";
import { CLAVES_DE_COLOR_DEL_PORTAL, CLAVES_DE_COLOR_DEL_TEMA } from "./oraculo-marca";

/**
 * Guardián de dimensiones de la marca (regla de combinaciones, 2026-10-28): falla si aparece en el catálogo una clave de COLOR nueva sin declarar en `oraculo-marca.ts` qué es en el modelo de marca
 * («marca» o «se retira de la lectura»), o si la tabla declara una que el catálogo ya no tiene. Es el momento de decidir, adrede, si la clave nueva afecta la marca.
 */
const TIPOS_DE_COLOR = new Set(["color", "colorHex", "colorHeroInk"]);

const clavesDeColor = (catalogo: readonly { clave: string; tipo: string }[]) => catalogo.filter((d) => TIPOS_DE_COLOR.has(d.tipo)).map((d) => d.clave).sort();

describe("claves de color del catálogo de la carta: todas declaradas en el oráculo de la marca", () => {
  it("tema por sucursal: las claves de color del catálogo son exactamente las declaradas", () => {
    expect(clavesDeColor(CLAVES_TEMA_V1), "una clave de color nueva (o quitada) del tema: declarala en test/carta/oraculo-marca.ts").toEqual(Object.keys(CLAVES_DE_COLOR_DEL_TEMA).sort());
  });

  it("portal por empresa: las claves de color del catálogo son exactamente las declaradas", () => {
    expect(clavesDeColor(CLAVES_PORTAL_V1), "una clave de color nueva (o quitada) del portal: declarala en test/carta/oraculo-marca.ts").toEqual(Object.keys(CLAVES_DE_COLOR_DEL_PORTAL).sort());
  });

  it("hoy: 23 claves de color en el tema (una es la marca) y 13 en el portal (una es la marca)", () => {
    expect(Object.keys(CLAVES_DE_COLOR_DEL_TEMA)).toHaveLength(23);
    expect(Object.values(CLAVES_DE_COLOR_DEL_TEMA).filter((d) => d === "marca")).toHaveLength(1);
    expect(Object.keys(CLAVES_DE_COLOR_DEL_PORTAL)).toHaveLength(13);
    expect(Object.values(CLAVES_DE_COLOR_DEL_PORTAL).filter((d) => d === "marca")).toHaveLength(1);
  });
});
