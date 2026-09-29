import { describe, expect, it } from "vitest";
import { armarHostCarta, interpretarHostCarta } from "@/core/carta/host";

describe("interpretarHostCarta", () => {
  const BASE = "motor2carta.com";

  it("acepta la forma exacta carta.<slug>.<dominioBase>", () => {
    expect(interpretarHostCarta("carta.la-cuadra.motor2carta.com", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("ignora el puerto (típico en desarrollo)", () => {
    expect(interpretarHostCarta("carta.e2e.motor2carta.com:3101", BASE)).toEqual({ empresaSlug: "e2e" });
  });

  it("es insensible a mayúsculas", () => {
    expect(interpretarHostCarta("CARTA.La-Cuadra.MOTOR2CARTA.COM", BASE)).toEqual({ empresaSlug: "la-cuadra" });
  });

  it("rechaza el dominio pelado, sin carta.", () => {
    expect(interpretarHostCarta("motor2carta.com", BASE)).toBeNull();
    expect(interpretarHostCarta("la-cuadra.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza www", () => {
    expect(interpretarHostCarta("www.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza carta. sin ningún slug de empresa", () => {
    expect(interpretarHostCarta("carta.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza más de un nivel de subdominio de empresa", () => {
    expect(interpretarHostCarta("carta.a.b.motor2carta.com", BASE)).toBeNull();
  });

  it("rechaza un host de otro dominio", () => {
    expect(interpretarHostCarta("carta.la-cuadra.otrodominio.com", BASE)).toBeNull();
  });

  it("rechaza un slug con guion al principio o al final", () => {
    expect(interpretarHostCarta("carta.-la-cuadra.motor2carta.com", BASE)).toBeNull();
    expect(interpretarHostCarta("carta.la-cuadra-.motor2carta.com", BASE)).toBeNull();
  });

  it("null, vacío o sin dominioBase configurado da null, nunca explota", () => {
    expect(interpretarHostCarta(null, BASE)).toBeNull();
    expect(interpretarHostCarta("", BASE)).toBeNull();
    expect(interpretarHostCarta("carta.la-cuadra.motor2carta.com", "")).toBeNull();
    expect(interpretarHostCarta("carta.la-cuadra.motor2carta.com", null)).toBeNull();
  });

  it("localhost con subdominios (desarrollo/e2e) funciona igual que un dominio real", () => {
    expect(interpretarHostCarta("carta.e2e.localhost", "localhost")).toEqual({ empresaSlug: "e2e" });
  });
});

describe("armarHostCarta", () => {
  it("es la inversa de interpretarHostCarta", () => {
    const host = armarHostCarta("la-cuadra", "motor2carta.com");
    expect(host).toBe("carta.la-cuadra.motor2carta.com");
    expect(interpretarHostCarta(host, "motor2carta.com")).toEqual({ empresaSlug: "la-cuadra" });
  });
});
