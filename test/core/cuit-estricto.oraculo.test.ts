import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LARGO_DE_CUIT, cuitDesdeTexto, digitoVerificadorDeCuit } from "@/core/fiscal/cuit-estricto";
import { ACEPTADOS, BASES_SIN_DIGITO, DIGITO_DE_LA_BASE, FORMATO_INVALIDO, VERIFICADOR_INVALIDO } from "./oraculo-cuit-estricto";

/** Recorre el oráculo del CUIT estricto (`oraculo-cuit-estricto.ts`, escrito aparte del código): forma × dígito verificador × prefijo. */
describe("CUIT estricto · oráculo", () => {
  it.each(ACEPTADOS)("acepta %s y guarda %s", (entrada, canonico) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: true, valor: canonico });
  });

  it.each(FORMATO_INVALIDO)("rechaza %j por formato", (entrada) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: false, error: "CUIT_FORMATO_INVALIDO" });
  });

  it.each(VERIFICADOR_INVALIDO)("rechaza %s por dígito verificador", (entrada) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: false, error: "CUIT_DIGITO_VERIFICADOR_INVALIDO" });
  });

  it.each([undefined, null, 20123456786, true, {}, [], ["20123456786"]])("lo que no es texto (%j) es formato inválido y no lanza", (entrada) => {
    expect(cuitDesdeTexto(entrada)).toEqual({ ok: false, error: "CUIT_FORMATO_INVALIDO" });
  });

  it.each(DIGITO_DE_LA_BASE)("la base %s tiene como único dígito válido el %i", (base, digito) => {
    expect(digitoVerificadorDeCuit(base)).toBe(digito);
    for (let d = 0; d <= 9; d++) {
      const r = cuitDesdeTexto(`${base}${d}`);
      expect(r.ok, `${base}${d}`).toBe(d === digito);
    }
  });

  it.each(BASES_SIN_DIGITO)("la base %s no tiene dígito verificador: ningún CUIT con esa base es válido", (base) => {
    expect(digitoVerificadorDeCuit(base)).toBeNull();
    for (let d = 0; d <= 9; d++) expect(cuitDesdeTexto(`${base}${d}`)).toEqual({ ok: false, error: "CUIT_DIGITO_VERIFICADOR_INVALIDO" });
  });

  it("sin lista de prefijos: con cualquier prefijo de 00 a 99 hay exactamente un dígito final válido (o ninguno si la base no lo tiene)", () => {
    for (let p = 0; p <= 99; p++) {
      const base = `${String(p).padStart(2, "0")}12345678`;
      const validos = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => cuitDesdeTexto(`${base}${d}`).ok);
      expect(validos.length, base).toBe(digitoVerificadorDeCuit(base) === null ? 0 : 1);
    }
  });
});

describe("CUIT estricto · propiedades", () => {
  const digitos = fc.stringMatching(/^[0-9]{10}$/);

  it("con el dígito que calcula la regla entra, con los guiones exactos o sin ellos; con cualquier otro no", () => {
    fc.assert(
      fc.property(digitos, (base) => {
        const dv = digitoVerificadorDeCuit(base);
        for (let d = 0; d <= 9; d++) {
          const canonico = `${base}${d}`;
          const conGuiones = `${canonico.slice(0, 2)}-${canonico.slice(2, 10)}-${canonico.slice(10)}`;
          const esperado = d === dv ? { ok: true, valor: canonico } : { ok: false, error: "CUIT_DIGITO_VERIFICADOR_INVALIDO" };
          if (JSON.stringify(cuitDesdeTexto(canonico)) !== JSON.stringify(esperado)) return false;
          if (JSON.stringify(cuitDesdeTexto(conGuiones)) !== JSON.stringify(esperado)) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it("nunca lanza y, si acepta, devuelve exactamente 11 dígitos", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 20 }), fc.stringMatching(/^[0-9 .\-\n]{0,16}$/)), (texto) => {
        const r = cuitDesdeTexto(texto);
        return r.ok ? r.valor.length === LARGO_DE_CUIT && /^[0-9]+$/.test(r.valor) : r.error === "CUIT_FORMATO_INVALIDO" || r.error === "CUIT_DIGITO_VERIFICADOR_INVALIDO";
      }),
      { numRuns: 2000 },
    );
  });
});
