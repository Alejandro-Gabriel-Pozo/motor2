import { describe, expect, it } from "vitest";
import { textoDeAvisoDeLogin } from "../../src/core/auth/avisos-de-login";

/** E8 (ADR-024): el aviso del login sale de un código de la URL, con texto fijo. */
describe("textoDeAvisoDeLogin", () => {
  it("muestra el texto de los códigos que usa signIn", () => {
    expect(textoDeAvisoDeLogin("cuenta-desactivada")).toContain("desactivada");
    expect(textoDeAvisoDeLogin("falta-invitacion")).toContain("invitación");
    expect(textoDeAvisoDeLogin("cuenta-distinta")).toContain("plataforma");
  });
  it("un código desconocido, vacío o de la cadena de prototipos no muestra nada, y nunca se refleja", () => {
    for (const c of [undefined, "", "otro", "<script>", "constructor", "__proto__", "toString"]) expect(textoDeAvisoDeLogin(c), String(c)).toBeNull();
  });
});
