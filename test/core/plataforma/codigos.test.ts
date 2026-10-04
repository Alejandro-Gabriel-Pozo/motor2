import { describe, expect, it } from "vitest";
import { cifrarSecreto, descifrarSecreto } from "../../../src/core/plataforma/cifrado";
import {
  CANTIDAD_DE_CODIGOS_DE_RECUPERACION,
  generarCodigoDeIngreso,
  generarCodigosDeRecuperacion,
  hashDeCodigo,
  hashDeCodigoDeRecuperacion,
  hashesIguales,
  normalizarCodigoDeRecuperacion,
} from "../../../src/core/plataforma/codigos";

const SECRETO = "s".repeat(40);

describe("código de ingreso", () => {
  it("son 6 dígitos, con ceros a la izquierda, y salen distintos", () => {
    const codigos = Array.from({ length: 200 }, generarCodigoDeIngreso);
    for (const c of codigos) expect(c).toMatch(/^\d{6}$/);
    expect(new Set(codigos).size).toBeGreaterThan(150);
  });

  it("el hash depende del código, del contexto y del secreto del servidor", () => {
    const base = hashDeCodigo("123456", SECRETO, "ingreso:a:1");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeCodigo("123456", SECRETO, "ingreso:a:1")).toBe(base);
    expect(hashDeCodigo("123457", SECRETO, "ingreso:a:1")).not.toBe(base);
    expect(hashDeCodigo("123456", SECRETO, "ingreso:a:2")).not.toBe(base);
    expect(hashDeCodigo("123456", "t".repeat(40), "ingreso:a:1")).not.toBe(base);
  });

  it("un secreto del servidor corto no se acepta (sin secreto fuerte el hash de 6 dígitos se rompe)", () => {
    expect(() => hashDeCodigo("123456", "corto", "x")).toThrow("al menos 32");
  });

  it("hashesIguales compara en tiempo constante y no lanza con largos distintos", () => {
    expect(hashesIguales("abc", "abc")).toBe(true);
    expect(hashesIguales("abc", "abd")).toBe(false);
    expect(hashesIguales("abc", "abcd")).toBe(false);
    expect(hashesIguales("", "")).toBe(true);
  });
});

describe("códigos de recuperación", () => {
  it("son 10, con formato XXXXX-XXXXX sin caracteres ambiguos y todos distintos", () => {
    const codigos = generarCodigosDeRecuperacion();
    expect(codigos).toHaveLength(CANTIDAD_DE_CODIGOS_DE_RECUPERACION);
    for (const c of codigos) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("la forma canónica ignora mayúsculas, espacios y guiones", () => {
    expect(normalizarCodigoDeRecuperacion(" abcde fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizarCodigoDeRecuperacion("ABCDE-FGHJK")).toBe("ABCDEFGHJK");
  });

  it("el hash es el mismo para cualquier escritura del código y distinto para otro administrador o secreto", () => {
    const h = hashDeCodigoDeRecuperacion("ABCDE-FGHJK", SECRETO, "admin-1");
    expect(hashDeCodigoDeRecuperacion(" abcde fghjk ", SECRETO, "admin-1")).toBe(h);
    expect(hashDeCodigoDeRecuperacion("ABCDE-FGHJK", SECRETO, "admin-2")).not.toBe(h);
    expect(hashDeCodigoDeRecuperacion("ABCDE-FGHJK", "t".repeat(40), "admin-1")).not.toBe(h);
  });
});

describe("cifrado del secreto TOTP", () => {
  const CLAVE = Buffer.alloc(32, 7).toString("base64");

  it("ida y vuelta; el valor guardado no contiene el secreto y cada cifrado es distinto", () => {
    const a = cifrarSecreto("JBSWY3DPEHPK3PXP", CLAVE, "admin-1");
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(cifrarSecreto("JBSWY3DPEHPK3PXP", CLAVE, "admin-1")).not.toBe(a);
    expect(descifrarSecreto(a, CLAVE, "admin-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("no descifra con otra clave, otro contexto, un valor alterado o un formato ajeno (devuelve null, no lanza)", () => {
    const guardado = cifrarSecreto("JBSWY3DPEHPK3PXP", CLAVE, "admin-1");
    expect(descifrarSecreto(guardado, Buffer.alloc(32, 8).toString("base64"), "admin-1")).toBeNull();
    expect(descifrarSecreto(guardado, CLAVE, "admin-2")).toBeNull();
    const [v, iv, tag, ct] = guardado.split(".");
    expect(descifrarSecreto([v, iv, tag, ct.slice(0, -2) + (ct.endsWith("AA") ? "BB" : "AA")].join("."), CLAVE, "admin-1")).toBeNull();
    for (const malo of ["", "v1.a.b", "v2.a.b.c", "texto plano"]) expect(descifrarSecreto(malo, CLAVE, "admin-1"), malo).toBeNull();
  });

  it("una clave que no son 32 bytes lanza al cifrar", () => {
    expect(() => cifrarSecreto("x", Buffer.alloc(16).toString("base64"), "c")).toThrow("32 bytes");
  });
});
