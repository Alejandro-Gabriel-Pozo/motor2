import { describe, expect, it } from "vitest";
import { esIdentificador } from "../../src/core/datos/identificador";

describe("esIdentificador", () => {
  it("acepta cadenas no vacías", () => {
    expect(esIdentificador("cl123")).toBe(true);
  });
  it.each([undefined, null, "", 0, 7, {}, { not: "x" }, [], ["a"], true])("rechaza %j", (v) => {
    expect(esIdentificador(v)).toBe(false);
  });
});
