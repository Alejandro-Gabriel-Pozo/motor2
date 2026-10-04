import { describe, expect, it } from "vitest";
import { altaDeEmpresaSchema } from "../../src/core/features/empresa/empresa.schema";
import {
  VIDA_DE_LA_INVITACION_MS,
  enlaceDeInvitacion,
  esTokenConFormaValida,
  estadoEfectivoDeInvitacion,
  mensajeDeInvitacion,
  tokenDelFragmento,
  vencimientoDeInvitacion,
} from "../../src/core/features/empresa/invitacion";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";

const AHORA = new Date("2026-10-04T12:00:00Z");

describe("vida y estado efectivo de la invitación", () => {
  it("vence a los 7 días", () => {
    expect(vencimientoDeInvitacion(AHORA).getTime() - AHORA.getTime()).toBe(VIDA_DE_LA_INVITACION_MS);
    expect(VIDA_DE_LA_INVITACION_MS).toBe(7 * 24 * 3600 * 1000);
  });

  it("una pendiente es vencida desde el instante de venceEn (inclusive); las demás no cambian", () => {
    const venceEn = new Date("2026-10-05T00:00:00Z");
    expect(estadoEfectivoDeInvitacion({ estado: "PENDIENTE", venceEn }, new Date("2026-10-04T23:59:59Z"))).toBe("PENDIENTE");
    expect(estadoEfectivoDeInvitacion({ estado: "PENDIENTE", venceEn }, venceEn)).toBe("VENCIDA");
    expect(estadoEfectivoDeInvitacion({ estado: "ACEPTADA", venceEn }, new Date("2027-01-01T00:00:00Z"))).toBe("ACEPTADA");
    expect(estadoEfectivoDeInvitacion({ estado: "REVOCADA", venceEn }, new Date("2027-01-01T00:00:00Z"))).toBe("REVOCADA");
  });
});

describe("token y enlace", () => {
  it("solo se acepta la forma de un token generado (43 caracteres base64url)", () => {
    expect(esTokenConFormaValida(generarTokenOpaco())).toBe(true);
    for (const malo of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)} `]) expect(esTokenConFormaValida(malo), malo).toBe(false);
  });

  it("el enlace lleva el token en el fragmento y se lee de vuelta", () => {
    const token = generarTokenOpaco();
    const enlace = enlaceDeInvitacion("https://app.ejemplo.com/", token);
    expect(enlace).toBe(`https://app.ejemplo.com/invitacion#t=${token}`);
    expect(new URL(enlace).search).toBe("");
    expect(tokenDelFragmento(new URL(enlace).hash)).toBe(token);
    expect(tokenDelFragmento("#t=corto")).toBeNull();
    expect(tokenDelFragmento("")).toBeNull();
  });
});

describe("mensaje de la invitación", () => {
  it("el token está solo en el enlace; el hash no aparece; se dirige al invitado y dice cuándo vence en la zona de la empresa", () => {
    const token = generarTokenOpaco();
    const m = mensajeDeInvitacion({
      email: "dueno@ejemplo.com",
      nombreEmpresa: "Hostería Sur",
      enlace: enlaceDeInvitacion("https://app.ejemplo.com", token),
      venceEn: new Date("2026-10-11T02:30:00Z"),
      zonaHoraria: "America/Argentina/Buenos_Aires",
    });
    expect(m.para).toEqual(["dueno@ejemplo.com"]);
    expect(m.asunto).toContain("Hostería Sur");
    expect(m.texto.split(token)).toHaveLength(2);
    expect(m.texto).not.toContain(hashDeToken(token));
    expect(m.texto).toContain("10/10/2026 23:30");
  });
});

describe("altaDeEmpresaSchema", () => {
  const base = {
    nombre: "Hostería Sur",
    slug: "hosteria-sur",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ars",
    nombreSucursal: "Central",
    emailDuenio: " Dueno@Ejemplo.com ",
  };

  it("normaliza moneda y email", () => {
    expect(altaDeEmpresaSchema.parse(base)).toMatchObject({ moneda: "ARS", emailDuenio: "dueno@ejemplo.com" });
  });

  it("rechaza zona inexistente, moneda de símbolo, sucursal vacía, email inválido y slug con espacios", () => {
    for (const malo of [{ zonaHoraria: "America/Narnia" }, { moneda: "ar$" }, { nombreSucursal: "  " }, { emailDuenio: "no-es-email" }, { slug: "Mal Slug" }]) {
      expect(altaDeEmpresaSchema.safeParse({ ...base, ...malo }).success, JSON.stringify(malo)).toBe(false);
    }
  });
});
