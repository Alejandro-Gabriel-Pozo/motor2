import { describe, expect, it } from "vitest";
import { crearConCodigoAutogenerado } from "../../src/core/catalogo/generar-codigo";
import { cifrarSecreto, descifrarSecreto } from "../../src/core/plataforma/cifrado";
import { generarCodigoDeIngreso, generarCodigosDeRecuperacion } from "../../src/core/plataforma/codigos";
import { generarSecretoTotp } from "../../src/core/plataforma/totp";
import { generarNonce } from "../../src/core/seguridad/cabeceras";
import type { FuenteDeAzar } from "../../src/core/seguridad/azar";
import { generarTokenOpaco } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * Pureza 1.5: el núcleo no genera azar por su cuenta, lo recibe (`FuenteDeAzar`). Con una fuente FIJA, cada función da SIEMPRE el mismo resultado (antes era imposible
 * probar un token o un código de ingreso concreto), y el adaptador real (`src/lib/azar.ts`) cumple el contrato del puerto.
 */
/** Una fuente determinista: los bytes son 1, 2, 3… (módulo 256), los enteros recorren el rango en orden y el uuid sale de un contador. */
function fuenteFija(): FuenteDeAzar {
  let siguiente = 0;
  let contadorDeEnteros = 0;
  let contadorDeUuid = 0;
  return {
    bytes: (cantidad) => Uint8Array.from({ length: cantidad }, () => ++siguiente % 256),
    entero: (minimo, maximoExclusivo) => minimo + (contadorDeEnteros++ % (maximoExclusivo - minimo)),
    uuid: () => `${String(++contadorDeUuid).padStart(8, "0")}-0000-4000-8000-000000000000`,
  };
}

describe("el núcleo recibe el azar: con una fuente fija el resultado es siempre el mismo", () => {
  it("token opaco: 32 bytes en base64url", () => {
    const token = generarTokenOpaco(fuenteFija());
    expect(token).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64url"));
    expect(generarTokenOpaco(fuenteFija())).toBe(token);
  });

  it("código de ingreso: 6 dígitos de la fuente; códigos de recuperación: XXXXX-XXXXX del alfabeto sin ambiguos", () => {
    expect(generarCodigoDeIngreso(fuenteFija())).toBe("000000");
    const codigos = generarCodigosDeRecuperacion(fuenteFija(), 2);
    expect(codigos).toEqual(["ABCDE-FGHJK", "MNPQR-STUVW"]);
    expect(codigos.every((c) => /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/.test(c))).toBe(true);
  });

  it("secreto TOTP: 20 bytes en base32 (32 caracteres), reproducible", () => {
    const secreto = generarSecretoTotp(fuenteFija());
    expect(secreto).toHaveLength(32);
    expect(generarSecretoTotp(fuenteFija())).toBe(secreto);
  });

  it("nonce de la política de contenido: 16 bytes en base64, reproducible", () => {
    const nonce = generarNonce(fuenteFija());
    expect(nonce).toBe(Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)).toString("base64"));
  });

  it("cifrado: el vector de inicialización sale de la fuente (mismo texto, misma fuente, mismo cifrado) y se descifra", () => {
    const clave = Buffer.alloc(32, 7).toString("base64");
    const a = cifrarSecreto("secreto", clave, "admin-1", fuenteFija());
    const b = cifrarSecreto("secreto", clave, "admin-1", fuenteFija());
    expect(a).toBe(b);
    expect(descifrarSecreto(a, clave, "admin-1")).toBe("secreto");
    expect(descifrarSecreto(a, clave, "admin-2")).toBeNull();
  });

  it("código de producto: el sufijo sale del uuid de la fuente", async () => {
    const codigo = await crearConCodigoAutogenerado("MP", undefined, async (c) => c, fuenteFija());
    expect(codigo).toBe("MP_000000"); // el uuid fijo empieza con 00000001: los primeros 6 caracteres
  });
});

describe("el adaptador real (src/lib/azar.ts) cumple el contrato del puerto", () => {
  it("bytes: del largo pedido y distintos entre llamadas", () => {
    const a = azarDelProceso.bytes(32);
    const b = azarDelProceso.bytes(32);
    expect(a).toHaveLength(32);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("entero: siempre dentro de [mínimo, máximo) y recorre todo el rango", () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = azarDelProceso.entero(3, 8);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThan(8);
      vistos.add(n);
    }
    expect([...vistos].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("uuid: formato v4 y distinto cada vez", () => {
    const a = azarDelProceso.uuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(azarDelProceso.uuid()).not.toBe(a);
  });
});
