import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aCentavos, faltaRepartir, repartirFactura, type RenglonARepartir } from "@/core/compras/reparto-de-factura";

/**
 * Lote 1b (hallazgo D de la auditoría): el «falta repartir» de la pantalla y el servidor tienen que decir LO MISMO. `faltaRepartir` es la cuenta de la pantalla (centavos o puntos básicos
 * ENTEROS; positivo = falta, negativo = sobra); el servidor es `repartirFactura`. Antes la pantalla sumaba en coma flotante y redondeaba con `Math.round`.
 */
const renglon = (precioTotal: number): RenglonARepartir => ({ nombre: "Harina", precioTotal, cantidadStock: 1000, decimales: 2 });

describe("faltaRepartir: la pantalla coincide con el servidor", () => {
  it("33,33 + 33,33 + 33,34 cierra en cero", () => {
    expect(faltaRepartir("PORCENTAJE", [100], [33.33, 33.33, 33.34])).toBe(0);
    expect(faltaRepartir("PORCENTAJE", [100], [33.33, 33.33, 33.33])).toBe(1); // falta 0,01 %
    expect(faltaRepartir("PORCENTAJE", [100], [60, 50])).toBe(-1000); // sobra 10 %
  });

  it("importes con muchos decimales: cada uno se redondea a centavos como en el servidor (0,1 + 0,2 = 0,3)", () => {
    expect(faltaRepartir("IMPORTE", [0.3], [0.1, 0.2])).toBe(0);
    expect(faltaRepartir("IMPORTE", [1.005], [1.005])).toBe(0);
    expect(faltaRepartir("IMPORTE", [100], [33.335, 33.335, 33.33])).toBe(10000 - (aCentavos(33.335) * 2 + aCentavos(33.33)));
  });

  it("el total de la factura es la suma de los renglones redondeados uno por uno (igual que el servidor)", () => {
    // 10,005 + 10,005 → cada renglón se redondea (1001 + 1001 = 2002 centavos), no la suma (2001).
    expect(faltaRepartir("IMPORTE", [10.005, 10.005], [20.02])).toBe(0);
  });

  it("sin valores tecleados falta todo el total", () => {
    expect(faltaRepartir("IMPORTE", [10, 5.5], [])).toBe(1550);
    expect(faltaRepartir("PORCENTAJE", [10], [])).toBe(10000);
  });

  it("propiedad (importes): la diferencia de la pantalla es la que informa el servidor", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 4 }),
        (renglonesCentavos, valoresCentavos) => {
          const rs = renglonesCentavos.map((c) => c / 100);
          const vs = valoresCentavos.map((c) => c / 100);
          const falta = faltaRepartir("IMPORTE", rs, vs);
          const r = repartirFactura(rs.map(renglon), "IMPORTE", vs);
          if (falta === 0) {
            if (!r.ok) expect(r.mensaje).not.toMatch(/faltan|sobran/);
          } else {
            expect(r.ok).toBe(false);
            if (r.ok) return;
            const pesos = (Math.abs(falta) / 100).toFixed(2);
            expect(r.mensaje).toContain(falta > 0 ? `faltan $${pesos}` : `sobran $${pesos}`);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("propiedad (porcentajes): la pantalla dice «cierra» si y solo si el servidor no rechaza por la suma", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 5 }), (bps) => {
        const vs = bps.map((b) => b / 100);
        const falta = faltaRepartir("PORCENTAJE", [100], vs);
        const r = repartirFactura([renglon(1000)], "PORCENTAJE", vs);
        const rechazoPorSuma = !r.ok && /tienen que sumar 100/.test(r.mensaje);
        expect(rechazoPorSuma).toBe(falta !== 0);
        if (!r.ok && rechazoPorSuma) expect(r.mensaje).toContain(`suman ${((10000 - falta) / 100).toFixed(2)} %`);
      }),
      { numRuns: 500 }
    );
  });
});
