import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { textoDe, MENSAJE_GENERICO, huecosDe } from "@/core/textos/texto-de";

/** Lectura de textos (`textoDe`, tramo T1 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`). Oráculo escrito aparte del código: las frases exactas de a2-1. */
describe("textoDe: el rechazo de dos presentaciones activas en la misma unidad (a2-1)", () => {
  it("la compra dice lo de siempre, con comillas rectas", () => {
    expect(textoDe("aviso.no_se_puede_registrar_la_compra", { producto: "Harina 000", causa: "rechazo.PRESENTACION_AMBIGUA" })).toBe(
      'No se puede registrar la compra de "Harina 000": hay más de una presentación activa en esa unidad.',
    );
  });
  it("el alta gana «activa» (único cambio visible, aceptado por el orquestador el 2026-11-16)", () => {
    expect(textoDe("aviso.no_se_pudo_agregar_la_presentacion", { causa: "rechazo.PRESENTACION_AMBIGUA" })).toBe("No se pudo agregar la presentación: hay más de una presentación activa en esa unidad.");
  });
  it("sin huecos devuelve el texto tal cual", () => {
    expect(textoDe("rechazo.PRESENTACION_AMBIGUA")).toBe("hay más de una presentación activa en esa unidad");
  });
  it("es idempotente: leerlo dos veces da lo mismo", () => {
    const valores = { producto: "Aceite", causa: "rechazo.PRESENTACION_AMBIGUA" } as const;
    expect(textoDe("aviso.no_se_puede_registrar_la_compra", valores)).toBe(textoDe("aviso.no_se_puede_registrar_la_compra", valores));
  });
});

describe("textoDe: cerrado por defecto (IT-6)", () => {
  it("una clave inexistente no compila", () => {
    // @ts-expect-error la clave no está en el catálogo
    void (() => textoDe("rechazo.NO_EXISTE"));
    expect(true).toBe(true);
  });
  it("un hueco que falta o sobra no compila", () => {
    // @ts-expect-error falta `producto`
    void (() => textoDe("aviso.no_se_puede_registrar_la_compra", { causa: "rechazo.PRESENTACION_AMBIGUA" }));
    // @ts-expect-error sobra `extra`
    void (() => textoDe("aviso.no_se_pudo_agregar_la_presentacion", { causa: "rechazo.PRESENTACION_AMBIGUA", extra: "x" }));
    // @ts-expect-error una causa no puede ser una clave con huecos propios (un solo nivel)
    void (() => textoDe("aviso.no_se_pudo_agregar_la_presentacion", { causa: "aviso.no_se_pudo_agregar_la_presentacion" }));
    expect(true).toBe(true);
  });
  it("si algo llega igual (un `any`): mensaje genérico, nunca vacío ni el código crudo, y el error queda en los registros sin los valores", () => {
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const leer = textoDe as unknown as (clave: string, valores?: Record<string, string>) => string;
    expect(leer("rechazo.NO_EXISTE")).toBe(MENSAJE_GENERICO);
    expect(leer("aviso.no_se_puede_registrar_la_compra", { causa: "rechazo.PRESENTACION_AMBIGUA" })).toBe(MENSAJE_GENERICO);
    expect(leer("aviso.no_se_pudo_agregar_la_presentacion", { causa: "rechazo.NO_EXISTE" })).toBe(MENSAJE_GENERICO);
    expect(leer("aviso.no_se_pudo_agregar_la_presentacion", { causa: "aviso.no_se_pudo_agregar_la_presentacion" })).toBe(MENSAJE_GENERICO);
    expect(leer("aviso.no_se_puede_registrar_la_compra", { producto: "SECRETO-123", causa: "rechazo.NO_EXISTE" })).toBe(MENSAJE_GENERICO);
    expect(MENSAJE_GENERICO.length).toBeGreaterThan(0);
    expect(espia.mock.calls.flat().join(" ")).not.toContain("SECRETO-123");
    espia.mockRestore();
  });
});

describe("textoDe: propiedades", () => {
  it("lo que se inserta no se vuelve a interpretar: un nombre con llaves o `$&` sale tal cual", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (nombre) => {
        const salida = textoDe("aviso.no_se_puede_registrar_la_compra", { producto: nombre, causa: "rechazo.PRESENTACION_AMBIGUA" });
        expect(salida).toBe(`No se puede registrar la compra de "${nombre}": hay más de una presentación activa en esa unidad.`);
      }),
    );
    expect(textoDe("aviso.no_se_puede_registrar_la_compra", { producto: "{causa} $& {producto}", causa: "rechazo.PRESENTACION_AMBIGUA" })).toContain('"{causa} $& {producto}"');
  });
  it("huecosDe lee los huecos en orden y sin repetir", () => {
    expect(huecosDe("a {x} b {y} c {x} {Z} {}")).toEqual(["x", "y"]);
  });
});
