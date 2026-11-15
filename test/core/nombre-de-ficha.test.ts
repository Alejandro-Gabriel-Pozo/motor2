import { describe, expect, it } from "vitest";
import { nombreDeFicha, nombreDeFichaSiCambio, nombreMinimoDeFicha } from "@/core/datos/nombre-de-ficha";

const VACIO = "El nombre no puede estar vacío.";
const E = "El nombre";

describe("nombreDeFicha (alta y todo cambio de nombre): la regla estricta con los mensajes de siempre", () => {
  it("devuelve el nombre canónico", () => {
    expect(nombreDeFicha("  Café   con leche ", "PRODUCTO", VACIO, E)).toEqual({ ok: true, valor: "Café con leche" });
  });
  it.each([null, undefined, "", "   ", "\n"])("vacío (%j) → mensaje de vacío", (v) => {
    expect(nombreDeFicha(v, "PRODUCTO", VACIO, E)).toEqual({ ok: false, codigo: "vacio", mensaje: VACIO });
  });
  it("alfabeto no latino y guion bajo → caracteres no permitidos", () => {
    for (const v of ["Привет", "Pan_integral", "Juan\nPérez", "<b>"]) {
      const r = nombreDeFicha(v, "PRODUCTO", VACIO, E);
      expect(r).toMatchObject({ ok: false, codigo: "caracteres" });
      expect(!r.ok && r.mensaje).toContain("tiene caracteres no permitidos");
    }
  });
  it("«-» al principio conserva su mensaje; «+» al principio y «-» con otro carácter malo, el de caracteres", () => {
    expect(nombreDeFicha("-Kota", "PRODUCTO", VACIO, E)).toEqual({ ok: false, codigo: "caracteres", mensaje: 'El nombre no puede empezar con "-".' });
    expect(nombreDeFicha("+Kota", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "caracteres", mensaje: expect.stringContaining("caracteres no permitidos") });
    expect(nombreDeFicha("-Ko_ta", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, mensaje: expect.stringContaining("caracteres no permitidos") });
  });
  it("largo por ficha: 120 producto, 80 elección, 200 razón social", () => {
    expect(nombreDeFicha("A".repeat(120), "PRODUCTO", VACIO, E).ok).toBe(true);
    expect(nombreDeFicha("A".repeat(121), "PRODUCTO", VACIO, E)).toEqual({ ok: false, codigo: "largo", mensaje: "El nombre no puede superar los 120 caracteres." });
    expect(nombreDeFicha("A".repeat(81), "ELECCION", VACIO, E)).toMatchObject({ ok: false, codigo: "largo" });
    expect(nombreDeFicha("A".repeat(200), "RAZON_SOCIAL", VACIO, E).ok).toBe(true);
    expect(nombreDeFicha("A".repeat(201), "RAZON_SOCIAL", VACIO, E)).toMatchObject({ ok: false, codigo: "largo" });
  });
  it("letra: producto y razón social la exigen, elección no", () => {
    expect(nombreDeFicha("12", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "sin_alfanumerico" });
    expect(nombreDeFicha("12", "RAZON_SOCIAL", VACIO, E)).toMatchObject({ ok: false, codigo: "sin_alfanumerico" });
    expect(nombreDeFicha("12", "ELECCION", VACIO, E)).toEqual({ ok: true, valor: "12" });
  });
  it("signos de catálogo: sí en producto y elección, no en razón social", () => {
    expect(nombreDeFicha("¿Querés?", "PRODUCTO", VACIO, E).ok).toBe(true);
    expect(nombreDeFicha("50% $", "ELECCION", VACIO, E).ok).toBe(true);
    expect(nombreDeFicha("Ferro 50%", "RAZON_SOCIAL", VACIO, E)).toMatchObject({ ok: false, codigo: "caracteres" });
  });
  it("un valor que no es texto no lanza", () => {
    expect(nombreDeFicha(42, "PRODUCTO", VACIO, E)).toMatchObject({ ok: false });
    expect(nombreDeFicha({}, "PRODUCTO", VACIO, E)).toMatchObject({ ok: false });
  });
});

describe("nombreMinimoDeFicha (el guard de una edición): recorta, no vacío, tope; no mira los caracteres", () => {
  it("deja pasar un nombre viejo con caracteres que la regla nueva no admite", () => {
    expect(nombreMinimoDeFicha("  Pan_integral Привет ", "PRODUCTO", VACIO, E)).toEqual({ ok: true, valor: "Pan_integral Привет" });
  });
  it("rechaza vacío y lo que pasa del tope de la ficha", () => {
    expect(nombreMinimoDeFicha("  ", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "vacio" });
    expect(nombreMinimoDeFicha("A".repeat(121), "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "largo" });
    expect(nombreMinimoDeFicha("A".repeat(120), "PRODUCTO", VACIO, E).ok).toBe(true);
  });
});

describe("nombreDeFichaSiCambio (el caso de uso de una edición, con el nombre guardado por el servidor)", () => {
  it("el mismo nombre guardado, aunque no cumpla la regla nueva, NO falla y devuelve el guardado", () => {
    expect(nombreDeFichaSiCambio("Pan_integral", "Pan_integral", "PRODUCTO", VACIO, E)).toEqual({ ok: true, valor: "Pan_integral" });
    expect(nombreDeFichaSiCambio("  Привет ", "Привет", "PRODUCTO", VACIO, E)).toEqual({ ok: true, valor: "Привет" });
  });
  it("un nombre distinto que no cumple falla con el mensaje de siempre", () => {
    expect(nombreDeFichaSiCambio("Pan_nuevo", "Pan_integral", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "caracteres" });
  });
  it("un nombre distinto que cumple pasa canonizado", () => {
    expect(nombreDeFichaSiCambio("  Pan   nuevo ", "Pan_integral", "PRODUCTO", VACIO, E)).toEqual({ ok: true, valor: "Pan nuevo" });
  });
  it("vacío falla aunque el guardado también lo fuera", () => {
    expect(nombreDeFichaSiCambio("", "", "PRODUCTO", VACIO, E)).toMatchObject({ ok: false, codigo: "vacio" });
  });
});
