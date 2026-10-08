import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validarEleccionPromo, validarYAplanarEleccionPromo, type CupoPromoDefinicion, type EleccionDeCupo } from "../../src/core/pos/promo-combo";

/**
 * Propiedades (fast-check, 1000 corridas) de la validación de la elección de una promo armable (S-01, O.50 de docs/pureza-integracion.md, GT-11 del plan
 * de endurecimiento): para CUALQUIER promo y CUALQUIER elección que llegue del cliente (secciones de más, repetidas, productos ajenos, cantidades sueltas),
 * si la validación acepta entonces
 *  - cada producto del resultado pertenece a los elegibles de SU cupo, sin repetirse;
 *  - cada sección elegida es un cupo de la promo y aparece una sola vez;
 *  - el total por cupo queda entre su mínimo y su máximo;
 *  - los componentes aplanados son EXACTAMENTE lo elegido en los cupos (nada de otra sección, nada de más).
 * La mutación de la propiedad es devolver `ok` siempre: el generador arma elecciones rotas a propósito y la propiedad cae.
 */

const SECCIONES = ["sec-a", "sec-b", "sec-c"] as const;
const PRODUCTOS = ["p1", "p2", "p3", "p4", "p5", "mp-ajena"] as const;

const cuposArb: fc.Arbitrary<CupoPromoDefinicion[]> = fc
  .uniqueArray(fc.constantFrom(...SECCIONES), { minLength: 1, maxLength: 2 })
  .chain((secciones) =>
    fc.tuple(
      ...secciones.map((seccionCartaId) =>
        fc
          .record({
            cantidadMinima: fc.integer({ min: 0, max: 3 }),
            extra: fc.integer({ min: 0, max: 3 }),
            elegibles: fc.uniqueArray(fc.constantFrom("p1", "p2", "p3", "p4", "p5"), { minLength: 1, maxLength: 4 }),
          })
          .map(({ cantidadMinima, extra, elegibles }): CupoPromoDefinicion => ({ seccionCartaId, nombreSeccion: seccionCartaId, cantidadMinima, cantidadMaximaCupo: cantidadMinima + extra, elegibles: new Set(elegibles) })),
      ),
    ),
  );

const elegidoArb = fc.record({ productoId: fc.constantFrom(...PRODUCTOS), cantidad: fc.oneof(fc.integer({ min: -1, max: 5 }), fc.constantFrom(1.5, 30, 1e6, Number.NaN)) });
const eleccionArb: fc.Arbitrary<EleccionDeCupo> = fc.record({ seccionCartaId: fc.constantFrom(...SECCIONES, "sec-fuera"), elegidos: fc.array(elegidoArb, { maxLength: 4 }) });
const eleccionesArb = fc.array(eleccionArb, { maxLength: 4 });

describe("validarYAplanarEleccionPromo: lo aceptado cumple los cupos de la promo", () => {
  it("toda elección aceptada: secciones de cupo sin repetir, productos elegibles sin repetir, total entre mínimo y máximo, componentes = lo elegido", () => {
    let aceptadas = 0;
    fc.assert(
      fc.property(cuposArb, eleccionesArb, (cupos, elecciones) => {
        const r = validarYAplanarEleccionPromo(cupos, elecciones);
        if (!r.ok) return;
        aceptadas++;
        const seccionesDeCupo = new Set(cupos.map((c) => c.seccionCartaId));
        const vistas = new Set<string>();
        for (const e of elecciones) {
          expect(seccionesDeCupo.has(e.seccionCartaId)).toBe(true);
          expect(vistas.has(e.seccionCartaId)).toBe(false);
          vistas.add(e.seccionCartaId);
        }
        const esperado: { productoId: string; cantidad: number }[] = [];
        for (const cupo of cupos) {
          const elegidos = elecciones.find((e) => e.seccionCartaId === cupo.seccionCartaId)?.elegidos ?? [];
          const productos = elegidos.map((el) => el.productoId);
          expect(new Set(productos).size).toBe(productos.length);
          let total = 0;
          for (const el of elegidos) {
            expect(cupo.elegibles.has(el.productoId)).toBe(true);
            expect(Number.isInteger(el.cantidad) && el.cantidad > 0).toBe(true);
            total += el.cantidad;
            esperado.push({ productoId: el.productoId, cantidad: el.cantidad });
          }
          expect(total).toBeGreaterThanOrEqual(cupo.cantidadMinima);
          expect(total).toBeLessThanOrEqual(cupo.cantidadMaximaCupo);
        }
        expect(r.componentes).toEqual(esperado);
      }),
      { numRuns: 1000 },
    );
    // La propiedad no es vacía: el generador produce elecciones aceptadas (si el generador se rompiera y rechazara todo, la propiedad pasaría sin probar nada).
    expect(aceptadas).toBeGreaterThan(20);
  });

  it("`validarEleccionPromo` y `validarYAplanarEleccionPromo` aceptan y rechazan exactamente lo mismo, con el mismo mensaje", () => {
    fc.assert(
      fc.property(cuposArb, eleccionesArb, (cupos, elecciones) => {
        const corta = validarEleccionPromo(cupos, elecciones);
        const larga = validarYAplanarEleccionPromo(cupos, elecciones);
        expect(corta.ok).toBe(larga.ok);
        if (!corta.ok && !larga.ok) expect(corta.mensaje).toBe(larga.mensaje);
      }),
      { numRuns: 1000 },
    );
  });

  it("una elección con una sección que no es cupo NUNCA se acepta, cualquiera sea el resto", () => {
    fc.assert(
      fc.property(cuposArb, eleccionesArb, eleccionArb, (cupos, elecciones, extra) => {
        const fuera: EleccionDeCupo = { ...extra, seccionCartaId: "sec-que-no-es-cupo" };
        expect(validarYAplanarEleccionPromo(cupos, [...elecciones, fuera]).ok).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
