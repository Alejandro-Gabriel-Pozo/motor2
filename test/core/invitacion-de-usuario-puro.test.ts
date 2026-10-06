import { describe, expect, it } from "vitest";
import { enlaceDeInvitacion, mensajeDeInvitacionDeUsuario, mensajeDeInvitacionDeVinculacion, urlPublicaDeLaApp } from "../../src/core/features/empresa/invitacion";

/** E8 (ADR-024): reglas puras de la invitación de usuario y de vinculación. */
describe("urlPublicaDeLaApp", () => {
  it("acepta https y http solo en localhost, sin ruta, y saca la barra final", () => {
    expect(urlPublicaDeLaApp("https://app.ejemplo.com")).toBe("https://app.ejemplo.com");
    expect(urlPublicaDeLaApp("https://app.ejemplo.com/")).toBe("https://app.ejemplo.com");
    expect(urlPublicaDeLaApp("http://localhost:3000")).toBe("http://localhost:3000");
    expect(urlPublicaDeLaApp("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
  });
  it("rechaza lo vacío, http fuera de localhost, rutas, consultas, fragmentos y basura", () => {
    for (const v of [undefined, "", "http://app.ejemplo.com", "https://app.ejemplo.com/x", "https://app.ejemplo.com?x=1", "https://app.ejemplo.com#h", "no es una url", "ftp://a.com"]) expect(urlPublicaDeLaApp(v), String(v)).toBeNull();
  });
});

describe("mails", () => {
  const venceEn = new Date("2026-10-12T15:00:00.000Z");
  const enlace = enlaceDeInvitacion("https://app.ejemplo.com", "t".repeat(43));

  it("de usuario: dice quién invita, las sucursales con su rol, el enlace, que es de un solo uso y cuándo vence", () => {
    const m = mensajeDeInvitacionDeUsuario({ email: "nueva@ejemplo.com", nombreEmpresa: "La Cuadra", emailDeQuienInvita: "gerente@ejemplo.com", accesos: [{ sucursal: "Centro", rol: "operador" }, { sucursal: "Norte", rol: "admin" }], enlace, venceEn, zonaHoraria: "America/Argentina/Buenos_Aires" });
    expect(m.para).toEqual(["nueva@ejemplo.com"]);
    expect(m.asunto).toBe("Te dieron acceso a La Cuadra");
    for (const t of ["gerente@ejemplo.com te dio acceso a «La Cuadra»", "- Centro (operador)", "- Norte (admin)", enlace, "una sola vez", "cuenta de Google de nueva@ejemplo.com"]) expect(m.texto).toContain(t);
  });

  it("de vinculación: dice que el usuario ya está dado de alta y trae el enlace", () => {
    const m = mensajeDeInvitacionDeVinculacion({ email: "viejo@ejemplo.com", nombreEmpresa: "La Cuadra", enlace, venceEn, zonaHoraria: "America/Argentina/Buenos_Aires" });
    expect(m.asunto).toBe("Entrá a La Cuadra");
    expect(m.texto).toContain("ya está dado de alta");
    expect(m.texto).toContain(enlace);
  });

  it("el enlace lleva el token en el fragmento, nunca en la consulta", () => {
    expect(enlace).toBe(`https://app.ejemplo.com/invitacion#t=${"t".repeat(43)}`);
    expect(enlace).not.toContain("?");
  });
});
