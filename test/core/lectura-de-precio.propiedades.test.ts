import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { componerPrecioDeLinea, formaDelGrupoPorRespuesta, leerPrecioDeOpcion, type OpcionParaPrecio } from "@/core/opciones/public";

/**
 * Fase 6, paso 6.9a: PROPIEDADES de la lectura del precio, en centavos (enteros: el dinero de la prueba no pasa por la coma flotante). El total de la lectura tiene que ser, siempre, el
 * `precioDeLista` de `componerPrecioDeLinea` armado POR FUERA con los mismos datos, y las partes que muestra (base y diferencia) tienen que sumar exactamente ese total.
 */

const CENTAVOS_MAXIMOS = 99_999_999; // $ 999.999,99: dentro de DECIMAL(14,2) y lejos de los bordes de la coma flotante
const aPesos = (centavos: number) => centavos / 100;
const aCentavos = (pesos: number) => Math.round(pesos * 100);

const opcionParaPrecio = (parcial: Partial<OpcionParaPrecio> & Pick<OpcionParaPrecio, "tipo">): OpcionParaPrecio => ({
  opcionId: "o",
  versionDeOpcionId: "v",
  nombre: "Opción",
  cantidad: 1,
  factorEscala: null,
  modoPrecio: null,
  precioAbsoluto: null,
  diferencia: null,
  ...parcial,
});

const centavos = fc.integer({ min: 1, max: CENTAVOS_MAXIMOS });
const centavosOCero = fc.integer({ min: 0, max: CENTAVOS_MAXIMOS });

describe("lectura del precio: propiedades", () => {
  it("PRECIO_FINAL: el total es el precioDeLista del compositor con la opción en absoluto, y es el importe tecleado", () => {
    fc.assert(
      fc.property(centavos, centavosOCero, (importe, base) => {
        const lectura = leerPrecioDeOpcion({ forma: formaDelGrupoPorRespuesta("PRECIO_FINAL"), opcion: { nombre: "Opción", esNinguna: false }, tecleado: aPesos(importe), precioBase: aPesos(base), referencia: null });
        const esperado = componerPrecioDeLinea({
          precioBase: aPesos(base),
          cantidad: 1,
          opciones: [opcionParaPrecio({ tipo: "MEDIDA", modoPrecio: "ABSOLUTO", precioAbsoluto: aPesos(importe) })],
        });
        expect(esperado.ok).toBe(true);
        if (!esperado.ok) return;
        expect(lectura.tipo).toBe("precio-final");
        if (lectura.tipo !== "precio-final") return;
        expect(lectura.total).toBe(esperado.precio.precioDeLista);
        expect(aCentavos(lectura.total)).toBe(importe);
      }),
      { numRuns: 500 },
    );
  });

  it("SUMA: el total es el precioDeLista del compositor con la variante, y base + diferencia === total (en centavos)", () => {
    fc.assert(
      fc.property(centavos, centavosOCero, fc.boolean(), (base, dif, conReferencia) => {
        const precioBase = conReferencia ? 1 : aPesos(base); // con referencia manda el precio de la referencia; sin ella, el precio de lista
        const referencia = conReferencia ? { opcion: "Napolitana", precio: aPesos(base) } : null;
        const lectura = leerPrecioDeOpcion({ forma: formaDelGrupoPorRespuesta("SUMA"), opcion: { nombre: "Trucha", esNinguna: false }, tecleado: aPesos(dif), precioBase, referencia });
        const esperado = componerPrecioDeLinea({
          precioBase: aPesos(base),
          cantidad: 1,
          opciones: [opcionParaPrecio({ tipo: "VARIANTE", diferencia: { tipo: "MONTO", monto: aPesos(dif) } })],
        });
        expect(esperado.ok).toBe(true);
        if (!esperado.ok) return;
        expect(lectura.tipo).toBe("suma");
        if (lectura.tipo !== "suma") return;
        expect(lectura.total).toBe(esperado.precio.precioDeLista);
        expect(aCentavos(lectura.base) + aCentavos(lectura.diferencia)).toBe(aCentavos(lectura.total));
        expect(aCentavos(lectura.base)).toBe(base);
        expect(aCentavos(lectura.diferencia)).toBe(dif);
      }),
      { numRuns: 500 },
    );
  });

  it("la opción «ninguna» y el importe vacío suman 0 en un grupo que suma: el total es la base", () => {
    fc.assert(
      fc.property(centavos, centavosOCero, (base, tecleado) => {
        for (const [esNinguna, valor] of [[true, aPesos(tecleado)], [false, null]] as const) {
          const lectura = leerPrecioDeOpcion({ forma: formaDelGrupoPorRespuesta("SUMA"), opcion: { nombre: "X", esNinguna }, tecleado: valor, precioBase: aPesos(base), referencia: null });
          expect(lectura).toMatchObject({ tipo: "suma", diferencia: 0 });
          if (lectura.tipo === "suma") expect(aCentavos(lectura.total)).toBe(base);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("INCLUIDO no cambia el precio, con cualquier importe tecleado", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.constant("invalido" as const), centavosOCero.map(aPesos)), centavosOCero, (tecleado, base) => {
        expect(leerPrecioDeOpcion({ forma: formaDelGrupoPorRespuesta("INCLUIDO"), opcion: { nombre: "X", esNinguna: false }, tecleado, precioBase: aPesos(base), referencia: null })).toEqual({ tipo: "no-cambia" });
      }),
      { numRuns: 100 },
    );
  });
});
