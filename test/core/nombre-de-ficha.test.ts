import { describe, expect, it } from "vitest";
import { nombreDeCocinaDeProducto, nombreDeFicha, nombreDeFichaSiCambio, nombreMinimoDeFicha } from "@/core/datos/nombre-de-ficha";

const VACIO = "El nombre no puede estar vacío.";
const GENERICO = "Esta acción no está permitida";

describe("nombreDeFicha (alta y todo cambio de nombre): la regla estricta con los mensajes de siempre", () => {
  it("devuelve el nombre canónico", () => {
    expect(nombreDeFicha("  Café   con leche ", "PRODUCTO", VACIO)).toEqual({ ok: true, valor: "Café con leche" });
  });
  it.each([null, undefined, "", "   ", "\n"])("vacío (%j) → mensaje de vacío", (v) => {
    expect(nombreDeFicha(v, "PRODUCTO", VACIO)).toEqual({ ok: false, codigo: "vacio", mensaje: VACIO });
  });
  it("alfabeto no latino y guion bajo → caracteres no permitidos", () => {
    for (const v of ["Привет", "Pan_integral", "Juan\nPérez", "<b>"]) {
      expect(nombreDeFicha(v, "PRODUCTO", VACIO)).toEqual({ ok: false, codigo: "caracteres", mensaje: GENERICO });
    }
  });
  it("«-» y «+» al principio se rechazan con el mismo mensaje genérico", () => {
    for (const v of ["-Kota", "+Kota", "-Ko_ta"]) expect(nombreDeFicha(v, "PRODUCTO", VACIO)).toEqual({ ok: false, codigo: "caracteres", mensaje: GENERICO });
  });
  it("largo por ficha: 120 producto, 80 elección, 200 razón social", () => {
    expect(nombreDeFicha("A".repeat(120), "PRODUCTO", VACIO).ok).toBe(true);
    expect(nombreDeFicha("A".repeat(121), "PRODUCTO", VACIO)).toEqual({ ok: false, codigo: "largo", mensaje: GENERICO });
    expect(nombreDeFicha("A".repeat(81), "ELECCION", VACIO)).toMatchObject({ ok: false, codigo: "largo" });
    expect(nombreDeFicha("A".repeat(200), "RAZON_SOCIAL", VACIO).ok).toBe(true);
    expect(nombreDeFicha("A".repeat(201), "RAZON_SOCIAL", VACIO)).toMatchObject({ ok: false, codigo: "largo" });
  });
  it("letra: producto y razón social la exigen, elección no", () => {
    expect(nombreDeFicha("12", "PRODUCTO", VACIO)).toMatchObject({ ok: false, codigo: "sin_alfanumerico" });
    expect(nombreDeFicha("12", "RAZON_SOCIAL", VACIO)).toMatchObject({ ok: false, codigo: "sin_alfanumerico" });
    expect(nombreDeFicha("12", "ELECCION", VACIO)).toEqual({ ok: true, valor: "12" });
  });
  it("signos de catálogo: sí en producto y elección, no en razón social", () => {
    expect(nombreDeFicha("¿Querés?", "PRODUCTO", VACIO).ok).toBe(true);
    expect(nombreDeFicha("50% $", "ELECCION", VACIO).ok).toBe(true);
    expect(nombreDeFicha("Ferro 50%", "RAZON_SOCIAL", VACIO)).toMatchObject({ ok: false, codigo: "caracteres" });
  });
  it("un valor que no es texto no lanza", () => {
    expect(nombreDeFicha(42, "PRODUCTO", VACIO)).toMatchObject({ ok: false });
    expect(nombreDeFicha({}, "PRODUCTO", VACIO)).toMatchObject({ ok: false });
  });
});

describe("nombreMinimoDeFicha (el guard de una edición): recorta, no vacío, tope; no mira los caracteres", () => {
  it("deja pasar un nombre viejo con caracteres que la regla nueva no admite", () => {
    expect(nombreMinimoDeFicha("  Pan_integral Привет ", "PRODUCTO", VACIO)).toEqual({ ok: true, valor: "Pan_integral Привет" });
  });
  it("rechaza vacío y lo que pasa del tope de la ficha", () => {
    expect(nombreMinimoDeFicha("  ", "PRODUCTO", VACIO)).toMatchObject({ ok: false, codigo: "vacio" });
    expect(nombreMinimoDeFicha("A".repeat(121), "PRODUCTO", VACIO)).toMatchObject({ ok: false, codigo: "largo" });
    expect(nombreMinimoDeFicha("A".repeat(120), "PRODUCTO", VACIO).ok).toBe(true);
  });
});

describe("nombreDeFichaSiCambio (el caso de uso de una edición, con el nombre guardado por el servidor)", () => {
  it("el mismo nombre guardado, aunque no cumpla la regla nueva, NO falla y devuelve el guardado", () => {
    expect(nombreDeFichaSiCambio("Pan_integral", "Pan_integral", "PRODUCTO", VACIO)).toEqual({ ok: true, valor: "Pan_integral" });
    expect(nombreDeFichaSiCambio("  Привет ", "Привет", "PRODUCTO", VACIO)).toEqual({ ok: true, valor: "Привет" });
  });
  it("un nombre distinto que no cumple falla con el mensaje de siempre", () => {
    expect(nombreDeFichaSiCambio("Pan_nuevo", "Pan_integral", "PRODUCTO", VACIO)).toMatchObject({ ok: false, codigo: "caracteres" });
  });
  it("un nombre distinto que cumple pasa canonizado", () => {
    expect(nombreDeFichaSiCambio("  Pan   nuevo ", "Pan_integral", "PRODUCTO", VACIO)).toEqual({ ok: true, valor: "Pan nuevo" });
  });
  it("vacío falla aunque el guardado también lo fuera", () => {
    expect(nombreDeFichaSiCambio("", "", "PRODUCTO", VACIO)).toMatchObject({ ok: false, codigo: "vacio" });
  });
});

describe("nombreDeCocinaDeProducto (opcional, solo un PV, ficha NOMBRE_DE_COCINA)", () => {
  it("sin dato (undefined, null o solo espacios) es «sin nombre de cocina»: null, en cualquier tipo", () => {
    for (const valor of [undefined, null, "", "   ", "\n\t"]) {
      for (const tipo of ["PV", "MP", undefined]) expect(nombreDeCocinaDeProducto(valor, tipo), `${JSON.stringify(valor)} / ${String(tipo)}`).toEqual({ ok: true, valor: null });
    }
  });

  it("con dato en un PV: el nombre canónico (recortado, NFC, espacios colapsados)", () => {
    expect(nombreDeCocinaDeProducto("  Medallón   de bife ", "PV")).toEqual({ ok: true, valor: "Medallón de bife" });
    expect(nombreDeCocinaDeProducto("x".repeat(80), "PV").ok).toBe(true);
  });

  it("rechaza con el mensaje genérico: largo, sin letras, signos de catálogo, invisibles, salto de línea, y lo que no es texto", () => {
    for (const malo of ["x".repeat(81), "12 34", "¿Bife?", "Bife 50%", "a​b", "a\nb", 5, {}, ["x"], true]) {
      expect(nombreDeCocinaDeProducto(malo, "PV"), JSON.stringify(malo)).toEqual({ ok: false, codigo: "formato", mensaje: "Esta acción no está permitida" });
    }
  });

  it("falla cerrado en el tipo: con dato, solo un PV; una MP, un tipo desconocido o ausente lo rechazan", () => {
    for (const tipo of ["MP", "pv", "", null, undefined, 1]) {
      expect(nombreDeCocinaDeProducto("Medallón", tipo), String(tipo)).toEqual({ ok: false, codigo: "formato", mensaje: "Esta acción no está permitida" });
    }
  });
});
