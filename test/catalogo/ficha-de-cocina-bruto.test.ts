import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FICHA_IMPRIME_BRUTO, armarFichaDeCocina } from "../../src/core/catalogo/ficha-de-cocina";
import type { EntradaDeFichaDeCocina, RecetaParaFicha } from "../../src/core/catalogo/ficha-de-cocina";

/**
 * M3c (2026-11-17): la ficha de cocina imprime SIEMPRE el bruto (dueño, chat con el orquestador: «Ok:» a «¿Querés que la hoja de cocina muestre siempre lo que hay que sacar de la cámara
 * (el bruto, como Pedernal), también para las recetas que ya tenés cargadas?»). Versión NETA: bruto = cantidad × (1 + merma/100), decimal exacto, UN solo redondeo a 4 decimales (mitad que
 * se aleja del cero); versión BRUTA: la cantidad tal cual. Con merma 0 el papel no cambia. El % de merma NUNCA se imprime. Interruptor reversible: `FICHA_IMPRIME_BRUTO`.
 *
 * El ORÁCULO está escrito aparte del código: una tabla a mano y una cuenta con enteros (BigInt), sin decimal.js ni el formateador del producto.
 */
const receta = (base: string, lineas: { cantidad: string; merma: string; unidad?: { nombre: string; decimales?: number } }[]): RecetaParaFicha => ({
  version: 3, baseDeCantidad: base,
  ingredientes: lineas.map((l, i) => ({ cantidad: l.cantidad, mermaPorcentaje: l.merma, unidad: l.unidad ?? { nombre: "kg", decimales: 2 }, insumoProducto: { nombre: `Insumo ${i + 1}` } })),
  pasos: [], rendimientoCantidad: null, rendimientoUnidad: null, racionesCantidad: null, racionTamano: null, racionUnidad: null, tiempoPreparacionMinutos: null, tiempoCoccionMinutos: null,
  comentarios: null, presentacionEmplatado: null, notasAdicionales: null, equipamientoNecesario: null,
});
const entrada = (r: RecetaParaFicha, extra: Partial<EntradaDeFichaDeCocina> = {}): EntradaDeFichaDeCocina => ({ productoNombre: "Plato", sucursalNombre: "Norte", origen: "CENTRAL", receta: r, ahora: new Date("2026-11-17T15:00:00Z"), ...extra });
const cantidades = (r: RecetaParaFicha, extra: Partial<EntradaDeFichaDeCocina> = {}) => armarFichaDeCocina(entrada(r, extra)).ingredientes.map((i) => i.cantidad);

describe("la ficha imprime el bruto (tabla escrita a mano)", () => {
  // [cantidad, merma, base, decimales de la unidad, lo que sale en el papel]
  const TABLA: [string, string, "NETA" | "BRUTA", number | undefined, string][] = [
    ["0.2000", "25.00", "NETA", 2, "0,25"], // 0,2 × 1,25
    ["0.3333", "12.50", "NETA", 2, "0,375"], // 0,3333 × 1,125 = 0,3749625 → 0,3750
    ["150.0000", "20.00", "NETA", 0, "180"],
    ["1.0000", "0.00", "NETA", 0, "1"], // merma 0: el papel no cambia
    ["2.5000", "33.33", "NETA", 2, "3,3333"], // 3,33325 → 3,3333 (mitad hacia arriba)
    ["1000.0000", "0.01", "NETA", 3, "1.000,1"],
    ["0.2000", "25.00", "BRUTA", 2, "0,2"], // BRUTA: la cantidad tal cual, sin sumar la merma
    ["0.3333", "12.50", "BRUTA", 2, "0,3333"],
    ["100.0000", "100.00", "NETA", 0, "200"],
    ["0.0001", "50.00", "NETA", 4, "0,0002"], // 0,00015 → 0,0002 (la mitad se aleja del cero)
  ];
  it.each(TABLA)("cantidad %s, merma %s, %s → «%s»", (cantidad, merma, base, decimales, esperado) => {
    expect(cantidades(receta(base, [{ cantidad, merma, unidad: { nombre: "kg", decimales } }]))).toEqual([esperado]);
  });

  it("con merma 0 el papel es EXACTAMENTE el de antes (la cantidad escrita) en las dos bases", () => {
    for (const base of ["NETA", "BRUTA"]) {
      const r = receta(base, [{ cantidad: "0.2200", merma: "0.00" }, { cantidad: "1.0000", merma: "0.00", unidad: { nombre: "unidad", decimales: 0 } }]);
      expect(cantidades(r)).toEqual(cantidades(r, { imprimeBruto: false }));
    }
  });
});

describe("el oráculo con enteros: para toda cantidad (≤ 4 decimales) y merma (≤ 2 decimales) la versión NETA imprime cantidad × (1 + merma/100) a 4 decimales", () => {
  /** bruto en diezmilésimas = c4 × (10000 + m2) / 10000, con la mitad alejándose del cero; devuelve el texto sin separador de miles (el bruto es < 1000: la cantidad llega a 499,9999 y el factor a 2). */
  const B = BigInt; // (los literales `10000n` no están disponibles con el target del proyecto)
  function oraculo(c4: bigint, m2: bigint): string {
    const numerador = c4 * (B(10000) + m2);
    const b4 = (numerador * B(2) + B(10000)) / B(20000); // redondeo de mitad hacia arriba de un positivo
    const entero = b4 / B(10000);
    const frac = (b4 % B(10000)).toString().padStart(4, "0").replace(/0+$/, "");
    return frac === "" ? entero.toString() : `${entero},${frac}`;
  }
  const texto = (n: bigint, decimales: number) => {
    const escala = B(10) ** B(decimales);
    return `${n / escala}.${(n % escala).toString().padStart(decimales, "0")}`;
  };

  it("1000 casos al azar (semilla fija)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: BigInt(1), max: BigInt(4_999_999) }), fc.bigInt({ min: BigInt(0), max: BigInt(10_000) }), (c4, m2) => {
        const cantidad = texto(c4, 4);
        const merma = texto(m2, 2);
        expect(cantidades(receta("NETA", [{ cantidad, merma }]))).toEqual([oraculo(c4, m2)]);
      }),
      { numRuns: 1000, seed: 20261117 }
    );
  });
});

describe("el interruptor y las salvaguardas", () => {
  const R = receta("NETA", [{ cantidad: "0.2200", merma: "8.00" }]);

  it("`FICHA_IMPRIME_BRUTO` está encendido (lo que decidió el dueño el 2026-11-17) y apagarlo vuelve al impreso de antes: la cantidad escrita", () => {
    expect(FICHA_IMPRIME_BRUTO).toBe(true);
    expect(cantidades(R)).toEqual(["0,2376"]);
    expect(cantidades(R, { imprimeBruto: true })).toEqual(["0,2376"]);
    expect(cantidades(R, { imprimeBruto: false })).toEqual(["0,22"]);
    expect(cantidades(receta("BRUTA", [{ cantidad: "0.2200", merma: "8.00" }]), { imprimeBruto: false })).toEqual(["0,22"]);
  });

  it("el porcentaje de merma NUNCA se imprime, sea cual sea la base", () => {
    for (const base of ["NETA", "BRUTA"]) {
      const ficha = JSON.stringify(armarFichaDeCocina(entrada(receta(base, [{ cantidad: "0.2200", merma: "8.00" }]))));
      expect(ficha).not.toMatch(/merma|8,00|8 %/i);
    }
  });

  it.each([undefined, null, "", "neta", "MIXTA", 1])("una marca ilegible (%j) CIERRA: error explícito, no se asume una base", (mala) => {
    expect(() => armarFichaDeCocina(entrada(receta(mala as never, [{ cantidad: "0.2200", merma: "8.00" }])))).toThrow(/no es legible/);
  });

  it("imprimir dos veces la misma versión da el mismo papel (sin estado)", () => {
    expect(armarFichaDeCocina(entrada(R))).toEqual(armarFichaDeCocina(entrada(R)));
  });
});
