import { describe, expect, it } from "vitest";
import { contarFormulaDeMermaAMano } from "./formula-de-merma-unica-apoyo";

/**
 * Violaciones inyectadas de `formula-de-merma-unica.test.ts`: cada forma de escribir la fórmula del factor de merma a mano tiene su caso. Si se debilita el detector
 * (`formula-de-merma-unica-apoyo.ts`), el caso deja de contar y esta prueba se pone roja. Y lo permitido (llamar a la función única, o fórmulas que no son el factor de merma) no cuenta.
 */
const cuenta = (texto: string) => contarFormulaDeMermaAMano(texto, "x.ts");

describe("fórmula de merma única: cada forma escrita a mano se cuenta", () => {
  it.each([
    ["number, como se escribía en venta", "export const q = (c: number, ef: { cantidad: number; mermaPorcentaje: number }) => c * ef.cantidad * (1 + ef.mermaPorcentaje / 100);"],
    ["number, sin paréntesis", "export const f = (mermaPorcentaje: number) => 1 + mermaPorcentaje / 100;"],
    ["number, con el 1 a la derecha", "export const f = (mermaPorcentaje: number) => mermaPorcentaje / 100 + 1;"],
    ["number, con la división entre paréntesis", "export const f = (merma: number) => 1 + (merma / 100);"],
    ["number, con 1.0 y 100.0", "export const f = (merma: number) => 1.0 + merma / 100.0;"],
    ["number, en la inversa (división por el factor)", "export const f = (c: number, merma: number) => c / (1 + merma / 100);"],
    ["decimal, como en el consumo configurado", "export const f = (D: any, c: { mermaPorcentaje: number }) => new D(1).plus(new D(c.mermaPorcentaje).dividedBy(100));"],
    ["decimal, con div", "export const f = (D: any, merma: number) => new D(1).plus(new D(merma).div(100));"],
    ["decimal, con Decimal(1) sin new", "export const f = (merma: number) => Decimal(1).plus(Decimal(merma).dividedBy(100));"],
  ])("%s", (_nombre, fuente) => {
    expect(cuenta(fuente)).toBe(1);
  });

  it("cuenta cada aparición (tres en un archivo = 3)", () => {
    expect(cuenta("const a = 1 + merma / 100; const b = 1 + m.mermaPorcentaje / 100; const c = new D(1).plus(new D(merma).dividedBy(100));")).toBe(3);
  });

  it.each([
    ["llamar a la función única", "export const f = (merma: number) => factorDeMerma(merma);"],
    ["la función única decimal", "export const f = (merma: number) => factorDeMermaExacto(merma);"],
    ["una suma con 1 que no es merma", "export const f = (iva: number) => 1 + iva / 100;"],
    ["una división por 100 de la merma sin sumar 1", "export const f = (merma: number) => merma / 100;"],
    ["el neto (otra etapa): 100 menos merma", "export const f = (merma: number) => (100 - merma) / 100;"],
    ["un comentario", "// 1 + merma / 100\nexport const f = 1;"],
    ["un string", "export const f = '1 + merma / 100';"],
    ["decimal que no suma 1", "export const f = (D: any, merma: number) => new D(2).plus(new D(merma).dividedBy(100));"],
  ])("no cuenta: %s", (_nombre, fuente) => {
    expect(cuenta(fuente)).toBe(0);
  });
});
