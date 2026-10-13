import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { claveDeLineaDeVenta, lineasDeVenta } from "../../../src/core/pos/cuenta";
import { claveDeLineaDeVentaConOpciones } from "../../../src/core/pos/clave-de-linea-con-opciones";

/**
 * GO-0b, invariante I8 (diseño §5): la clave de agrupación extendida. SIN opciones es IDÉNTICA, byte a byte, a `claveDeLineaDeVenta` de hoy; con huella suma `|h:<huella>`
 * y un adicional suma `|a:<clave de la línea padre>`. `claveDeLineaDeVenta` y `lineasDeVenta` no se tocan: acá se prueba que la extensión no los contradice.
 */

const HUELLA_A = "a".repeat(64);
const HUELLA_B = "b".repeat(64);
const cafe = { productoId: "p-cafe", precioUnitario: 3400 };

describe("claveDeLineaDeVentaConOpciones: sin opciones es la de hoy, byte a byte", () => {
  it("sin huella ni padre devuelve exactamente lo mismo que claveDeLineaDeVenta", () => {
    const casos = [
      cafe,
      { ...cafe, promoCuentaId: "promo-1" },
      { ...cafe, promoCuentaId: null, precioCartaUnitario: 4000 },
      { ...cafe, promoCuentaId: "promo-1", precioCartaUnitario: 4000 },
      { productoId: "p", precioUnitario: 0.1 },
      { productoId: "p", precioUnitario: 1234.56, precioCartaUnitario: null, huellaOpciones: null, clavePadre: null },
    ];
    for (const caso of casos) {
      expect(claveDeLineaDeVentaConOpciones(caso)).toBe(claveDeLineaDeVenta(caso));
      expect(claveDeLineaDeVentaConOpciones({ ...caso, huellaOpciones: null })).toBe(claveDeLineaDeVenta(caso));
    }
    expect(claveDeLineaDeVentaConOpciones(cafe)).toBe("p-cafe|3400|");
  });

  it("propiedad: para cualquier línea sin opciones, la clave es la de hoy", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 100_000_000 }).map((c) => c / 100),
        fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
        fc.option(fc.integer({ min: 1, max: 100_000_000 }).map((c) => c / 100), { nil: null }),
        (productoId, precioUnitario, promoCuentaId, precioCartaUnitario) => {
          const l = { productoId, precioUnitario, promoCuentaId, precioCartaUnitario };
          expect(claveDeLineaDeVentaConOpciones(l)).toBe(claveDeLineaDeVenta(l));
        }
      ),
      { numRuns: 500 }
    );
  });

  it("la agrupación por esta clave de una cuenta sin opciones es la MISMA que hace lineasDeVenta (mismo orden, mismas sumas)", () => {
    const items = [
      { productoId: "a", cantidad: 1, precioUnitario: 100 },
      { productoId: "b", cantidad: 2, precioUnitario: 50, promoCuentaId: "promo-1" },
      { productoId: "a", cantidad: 3, precioUnitario: 100 },
      { productoId: "a", cantidad: 1, precioUnitario: 90, precioCartaUnitario: 100 },
      { productoId: "b", cantidad: 1, precioUnitario: 50 },
    ];
    const porClave = new Map<string, number>();
    for (const i of items) {
      const clave = claveDeLineaDeVentaConOpciones({ productoId: i.productoId, precioUnitario: i.precioUnitario, promoCuentaId: i.promoCuentaId, precioCartaUnitario: i.promoCuentaId ? null : i.precioCartaUnitario });
      porClave.set(clave, (porClave.get(clave) ?? 0) + i.cantidad);
    }
    expect([...porClave.values()]).toEqual(lineasDeVenta(items).map((l) => l.cantidad));
    expect([...porClave.keys()]).toEqual(lineasDeVenta(items).map((l) => claveDeLineaDeVenta(l)));
  });
});

describe("claveDeLineaDeVentaConOpciones: línea configurada", () => {
  it("suma |h:<huella> a la clave de siempre", () => {
    expect(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A })).toBe(`p-cafe|3400||h:${HUELLA_A}`);
    expect(claveDeLineaDeVentaConOpciones({ ...cafe, precioCartaUnitario: 4000, huellaOpciones: HUELLA_A })).toBe(`p-cafe|3400||4000|h:${HUELLA_A}`);
  });

  it("café mediano y café mediano cortado, al mismo precio, tenían la misma clave y ahora no (cada configuración, su operación)", () => {
    expect(claveDeLineaDeVenta(cafe)).toBe(claveDeLineaDeVenta({ ...cafe }));
    expect(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A })).not.toBe(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_B }));
    expect(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A })).not.toBe(claveDeLineaDeVentaConOpciones(cafe));
  });

  it("la misma configuración al mismo precio da la misma clave (se agrupa)", () => {
    expect(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A })).toBe(claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A }));
  });

  it("la huella tiene que ser un SHA-256 en hexadecimal minúscula de 64 caracteres (el CHECK de la base)", () => {
    for (const mala of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), ` ${"a".repeat(63)}`]) {
      expect(() => claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: mala }), JSON.stringify(mala)).toThrow("SHA-256");
    }
  });
});

describe("claveDeLineaDeVentaConOpciones: adicional", () => {
  const clavePadre = claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_A });
  const adicional = { productoId: "p-shot", precioUnitario: 500, clavePadre };

  it("suma |a:<clave de la línea padre> (la clave del padre ya lleva su huella)", () => {
    expect(claveDeLineaDeVentaConOpciones(adicional)).toBe(`p-shot|500||a:p-cafe|3400||h:${HUELLA_A}`);
  });

  it("el mismo adicional de dos configuraciones distintas del padre no se junta; de la misma, sí", () => {
    const otroPadre = claveDeLineaDeVentaConOpciones({ ...cafe, huellaOpciones: HUELLA_B });
    expect(claveDeLineaDeVentaConOpciones({ ...adicional, clavePadre: otroPadre })).not.toBe(claveDeLineaDeVentaConOpciones(adicional));
    expect(claveDeLineaDeVentaConOpciones({ ...adicional })).toBe(claveDeLineaDeVentaConOpciones(adicional));
  });

  it("un adicional no se confunde con una línea común del mismo producto y precio", () => {
    expect(claveDeLineaDeVentaConOpciones(adicional)).not.toBe(claveDeLineaDeVenta({ productoId: "p-shot", precioUnitario: 500 }));
  });

  it("un adicional no lleva huella: pasar las dos cosas es un error de quien llama", () => {
    // @ts-expect-error el tipo ya lo impide: o huella (configurada) o padre (adicional)
    expect(() => claveDeLineaDeVentaConOpciones({ ...adicional, huellaOpciones: HUELLA_A })).toThrow("a la vez");
  });

  it("la clave del padre no puede estar vacía", () => {
    expect(() => claveDeLineaDeVentaConOpciones({ ...adicional, clavePadre: "" })).toThrow("vacía");
  });
});
