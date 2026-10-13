import { describe, expect, it } from "vitest";
import { ALICUOTAS_IVA, CONDICIONES_IVA, type AlicuotaIva, type CondicionIva } from "../../src/core/fiscal/iva";

/**
 * M0-IVA: la lista de códigos de alícuota del producto. La paridad con el CHECK de la base está en `test/catalogo/migracion-m0-iva-alicuotas-de-producto.test.ts`; acá, lo que
 * se puede afirmar sin base: sin duplicados, sin la alícuota efectiva de venta (`NO_CORRESPONDE`, que no es una propiedad del producto) y con la forma de código semántico.
 */
describe("ALICUOTAS_IVA", () => {
  it("no repite ningún código", () => {
    expect(new Set(ALICUOTAS_IVA).size).toBe(ALICUOTAS_IVA.length);
  });

  it("NO_CORRESPONDE no es una alícuota del producto: es la efectiva de una venta cuando el emisor no es Responsable Inscripto", () => {
    expect(ALICUOTAS_IVA as readonly string[]).not.toContain("NO_CORRESPONDE");
  });

  it("son identificadores semánticos en mayúsculas, sin coma ni punto decimal", () => {
    for (const codigo of ALICUOTAS_IVA) expect(codigo, codigo).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("incluye las tasas generales de la Argentina y distingue 0 %, exento y no gravado", () => {
    expect(ALICUOTAS_IVA).toEqual(expect.arrayContaining(["IVA_0", "IVA_2_5", "IVA_5", "IVA_10_5", "IVA_21", "IVA_27", "EXENTO", "NO_GRAVADO"]));
    expect(ALICUOTAS_IVA).toHaveLength(8);
  });
});

describe("tipos derivados de las listas", () => {
  it("AlicuotaIva y CondicionIva son exactamente los elementos de sus listas (un código fuera de ellas no compila)", () => {
    const alicuota: AlicuotaIva = "IVA_10_5";
    const condicion: CondicionIva = "MONOTRIBUTO";
    expect(ALICUOTAS_IVA).toContain(alicuota);
    expect(CONDICIONES_IVA).toContain(condicion);
    // @ts-expect-error NO_CORRESPONDE no es una alícuota del producto (es la efectiva de una venta cuando el emisor no es Responsable Inscripto)
    const noEsDelProducto: AlicuotaIva = "NO_CORRESPONDE";
    expect(ALICUOTAS_IVA as readonly string[]).not.toContain(noEsDelProducto);
  });
});

describe("CONDICIONES_IVA", () => {
  it("son las tres de una compañía en Odoo, sin repetidos y como identificadores semánticos", () => {
    expect([...CONDICIONES_IVA]).toEqual(["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"]);
    expect(new Set(CONDICIONES_IVA).size).toBe(CONDICIONES_IVA.length);
  });
});
