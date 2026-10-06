import { describe, expect, it } from "vitest";
import { codificarBase32, codigoTotp, decodificarBase32, generarSecretoTotp, pasoDeTotp, uriOtpauth, verificarTotp } from "../../../src/core/plataforma/totp";

/** RFC 6238, Apéndice B (SHA-1, secreto ASCII "12345678901234567890"): los valores de 8 dígitos truncados a los 6 últimos. */
const SECRETO_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const VECTORES_RFC: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("base32", () => {
  it("coincide con los vectores de la RFC 4648 (sin relleno)", () => {
    const casos: Array<[string, string]> = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
    for (const [texto, esperado] of casos) {
      expect(codificarBase32(Buffer.from(texto))).toBe(esperado);
      if (texto) expect(Buffer.from(decodificarBase32(esperado)!).toString()).toBe(texto);
    }
  });

  it("decodifica minúsculas, espacios, guiones y relleno; rechaza lo que no es del alfabeto", () => {
    expect(Buffer.from(decodificarBase32("mzxw 6ytb-oi==")!).toString()).toBe("foobar");
    for (const malo of ["", "   ", "MZXW1", "MZXW6!", "mzxw8"]) expect(decodificarBase32(malo), JSON.stringify(malo)).toBeNull();
  });

  it("ida y vuelta con bytes al azar", () => {
    for (let i = 0; i < 50; i++) {
      const bytes = Uint8Array.from({ length: 1 + (i % 25) }, () => Math.floor(Math.random() * 256));
      expect(Array.from(decodificarBase32(codificarBase32(bytes))!)).toEqual(Array.from(bytes));
    }
  });
});

describe("codigoTotp", () => {
  for (const [segundos, esperado] of VECTORES_RFC) {
    it(`vector de la RFC 6238 a los ${segundos} s → ${esperado}`, () => {
      expect(codigoTotp(SECRETO_RFC, pasoDeTotp(segundos * 1000))).toBe(esperado);
    });
  }

  it("un secreto que no es base32 lanza (es un dato roto, no un código incorrecto)", () => {
    expect(() => codigoTotp("no es base32!", 1)).toThrow("ilegible");
  });

  it("el secreto generado son 32 caracteres base32 y no se repite", () => {
    const a = generarSecretoTotp();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generarSecretoTotp()).not.toBe(a);
  });
});

describe("verificarTotp", () => {
  const AHORA = 1111111111 * 1000;
  const paso = pasoDeTotp(AHORA);
  const codigo = (p: number) => codigoTotp(SECRETO_RFC, p);

  it("acepta el paso actual y devuelve el paso, para guardarlo", () => {
    expect(verificarTotp(SECRETO_RFC, codigo(paso), AHORA, null)).toEqual({ ok: true, paso });
  });

  it("tolera un paso hacia cada lado y rechaza dos", () => {
    expect(verificarTotp(SECRETO_RFC, codigo(paso - 1), AHORA, null)).toEqual({ ok: true, paso: paso - 1 });
    expect(verificarTotp(SECRETO_RFC, codigo(paso + 1), AHORA, null)).toEqual({ ok: true, paso: paso + 1 });
    expect(verificarTotp(SECRETO_RFC, codigo(paso - 2), AHORA, null)).toEqual({ ok: false });
    expect(verificarTotp(SECRETO_RFC, codigo(paso + 2), AHORA, null)).toEqual({ ok: false });
  });

  it("anti-replay: un paso ya usado (o anterior) no entra de nuevo; uno posterior sí", () => {
    expect(verificarTotp(SECRETO_RFC, codigo(paso), AHORA, paso)).toEqual({ ok: false });
    expect(verificarTotp(SECRETO_RFC, codigo(paso - 1), AHORA, paso)).toEqual({ ok: false });
    expect(verificarTotp(SECRETO_RFC, codigo(paso + 1), AHORA, paso)).toEqual({ ok: true, paso: paso + 1 });
  });

  it("acepta espacios en el código y rechaza lo que no son 6 dígitos", () => {
    const c = codigo(paso);
    expect(verificarTotp(SECRETO_RFC, `${c.slice(0, 3)} ${c.slice(3)}`, AHORA, null)).toEqual({ ok: true, paso });
    for (const malo of ["", "12345", "1234567", "abcdef", "12 34 5a"]) expect(verificarTotp(SECRETO_RFC, malo, AHORA, null), malo).toEqual({ ok: false });
  });

  it("un código de otro secreto no sirve", () => {
    expect(verificarTotp(generarSecretoTotp(), codigo(paso), AHORA, null)).toEqual({ ok: false });
  });
});

describe("uriOtpauth", () => {
  it("arma la URI con emisor y email escapados", () => {
    expect(uriOtpauth("ABC234", "ana+x@d.com", "Motor 2")).toBe("otpauth://totp/Motor%202:ana%2Bx%40d.com?secret=ABC234&issuer=Motor%202&algorithm=SHA1&digits=6&period=30");
  });
});
