import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cada carpeta de `src/core/` está clasificada en EXACTAMENTE UNA de las dos listas de `.dependency-cruiser-dominios.cjs`: dominio de
 * negocio (protegido por `sin-internals-de-otro-dominio`) o infraestructura transversal (con motivo). Falla cerrado: una carpeta nueva sin
 * clasificar no queda sin protección en silencio, obliga a decidir; y una entrada de la lista sin carpeta es un resto que hay que borrar.
 */
const { DOMINIOS_DE_NEGOCIO, INFRA_TRANSVERSAL } = createRequire(__filename)("../../.dependency-cruiser-dominios.cjs") as {
  DOMINIOS_DE_NEGOCIO: string[];
  INFRA_TRANSVERSAL: Record<string, string>;
};

const CARPETAS = readdirSync(join(__dirname, "../../src/core"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe("las carpetas de src/core/ están clasificadas", () => {
  it("cada carpeta figura en una (y solo una) lista", () => {
    const infra = Object.keys(INFRA_TRANSVERSAL);
    const sinClasificar = CARPETAS.filter((c) => !DOMINIOS_DE_NEGOCIO.includes(c) && !infra.includes(c));
    const enAmbas = DOMINIOS_DE_NEGOCIO.filter((d) => infra.includes(d));
    expect(sinClasificar, "carpeta nueva de src/core sin clasificar: sumala a DOMINIOS_DE_NEGOCIO (con su fachada) o a INFRA_TRANSVERSAL (con motivo) en .dependency-cruiser-dominios.cjs").toEqual([]);
    expect(enAmbas, "una carpeta no puede ser dominio de negocio e infraestructura a la vez").toEqual([]);
  });

  it("ninguna lista nombra una carpeta que ya no existe y cada infraestructura tiene su motivo", () => {
    const fantasma = [...DOMINIOS_DE_NEGOCIO, ...Object.keys(INFRA_TRANSVERSAL)].filter((c) => !CARPETAS.includes(c));
    expect(fantasma).toEqual([]);
    const sinMotivo = Object.entries(INFRA_TRANSVERSAL).filter(([, motivo]) => motivo.trim().length < 20).map(([c]) => c);
    expect(sinMotivo).toEqual([]);
  });
});
