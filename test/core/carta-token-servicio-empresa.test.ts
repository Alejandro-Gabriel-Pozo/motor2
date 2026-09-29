import { describe, expect, it } from "vitest";
import {
  extraerTokenBearer,
  generarTokenCartaPlano,
  hashTokenCarta,
  tokenCoincideConHash,
} from "@/core/carta/token-servicio-empresa";

describe("generarTokenCartaPlano", () => {
  it("genera tokens distintos en cada llamada, sin caracteres problemáticos para un header", () => {
    const a = generarTokenCartaPlano();
    const b = generarTokenCartaPlano();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url: nada de espacios, +, / ni = que compliquen el header Authorization
    expect(a.length).toBeGreaterThan(30); // 256 bits en base64url son bastante más largos que un token trivial
  });
});

describe("hashTokenCarta / tokenCoincideConHash", () => {
  it("el mismo token en texto plano siempre hashea igual", () => {
    const token = generarTokenCartaPlano();
    expect(hashTokenCarta(token)).toEqual(hashTokenCarta(token));
  });

  it("dos tokens distintos hashean distinto", () => {
    const a = generarTokenCartaPlano();
    const b = generarTokenCartaPlano();
    expect(hashTokenCarta(a)).not.toEqual(hashTokenCarta(b));
  });

  it("el hash nunca contiene el token en texto plano (no es identidad ni un simple encoding)", () => {
    const token = "token-de-prueba-bien-legible";
    expect(hashTokenCarta(token)).not.toContain(token);
  });

  it("tokenCoincideConHash acepta el token correcto contra su propio hash", () => {
    const token = generarTokenCartaPlano();
    expect(tokenCoincideConHash(token, hashTokenCarta(token))).toBe(true);
  });

  it("tokenCoincideConHash rechaza un token incorrecto", () => {
    const real = generarTokenCartaPlano();
    const otro = generarTokenCartaPlano();
    expect(tokenCoincideConHash(otro, hashTokenCarta(real))).toBe(false);
  });

  it("tokenCoincideConHash no explota con un hash de largo distinto (evita el path inseguro de timingSafeEqual)", () => {
    expect(tokenCoincideConHash("cualquier-cosa", "ab")).toBe(false);
  });
});

describe("extraerTokenBearer", () => {
  it("extrae el token de un header Bearer bien formado", () => {
    expect(extraerTokenBearer("Bearer abc123")).toBe("abc123");
  });

  it("es insensible a mayúsculas en 'Bearer' y tolera espacios extra", () => {
    expect(extraerTokenBearer("bearer   abc123  ")).toBe("abc123");
  });

  it("devuelve null sin header, con header vacío, o sin el prefijo Bearer", () => {
    expect(extraerTokenBearer(null)).toBeNull();
    expect(extraerTokenBearer(undefined)).toBeNull();
    expect(extraerTokenBearer("")).toBeNull();
    expect(extraerTokenBearer("Token abc123")).toBeNull();
  });
});
