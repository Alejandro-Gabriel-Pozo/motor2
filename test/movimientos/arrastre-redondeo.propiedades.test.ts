import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { crearArrastreDeRedondeo } from "../../src/core/movimientos/arrastre-redondeo";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

/**
 * Task #41 (Fase F, F2): propiedades generales (fast-check) de `crearArrastreDeRedondeo` (Task #27). Complementa los ejemplos
 * puntuales de `arrastre-redondeo.test.ts` — acá no hay casos elegidos a mano, sino invariantes que tienen que valer para CUALQUIER
 * secuencia de cantidades.
 *
 * La deuda interna no está expuesta: se reconstruye desde afuera con aritmética ENTERA exacta. Las magnitudes se generan como
 * enteros de millonésimas (`x = n / 1e6`, ≤ 6 decimales — más fino que cualquier `Unidad.decimales` real) y, como
 * `D' = D + x − escrito`, la deuda después de cada paso es `D0 + Σx − Σescrito`, que en millonésimas es un entero sin ruido de
 * coma flotante.
 */

const MICRO = 1_000_000;
const aMicro = (n: number) => Math.round(n * MICRO);
/** Unidad mínima `u = 10^-decimales`, en millonésimas (entero: decimales ≤ 3). */
const uMicro = (decimales: number) => MICRO / 10 ** decimales;

const decimalesArb = fc.integer({ min: 0, max: 3 });

/**
 * Magnitud (sin signo) en millonésimas, hasta 100 unidades. Mezcla valores cualesquiera con múltiplos exactos de medio paso
 * (`u/2`) de cada `decimales` posible, para forzar empates de `Math.round` — el borde donde la deuda toca `−u/2`.
 */
const magnitudMicroArb = fc.oneof(
  fc.integer({ min: 0, max: 100 * MICRO }),
  fc.integer({ min: 0, max: 200 }).map((k) => k * (MICRO / 2)), // medios de unidad (d=0)
  fc.integer({ min: 0, max: 2000 }).map((k) => k * (MICRO / 20)), // medios de décima (d=1)
  fc.integer({ min: 0, max: 2000 }).map((k) => k * (MICRO / 200)), // medios de centésima (d=2)
  fc.integer({ min: 0, max: 2000 }).map((k) => k * (MICRO / 2000)), // medios de milésima (d=3)
);

const secuenciaArb = fc.array(magnitudMicroArb, { minLength: 1, maxLength: 60 });

/** Deuda inicial válida para `decimales` (en millonésimas): dentro de `[−u/2, u/2]`, el rango que el propio arrastre mantiene. */
const deudaInicialMicroArb = (decimales: number) => fc.integer({ min: -uMicro(decimales) / 2, max: uMicro(decimales) / 2 });

describe("crearArrastreDeRedondeo — propiedades (fast-check)", () => {
  /*
   * El comentario de `arrastre-redondeo.ts` promete `D ∈ [−u/2, u/2)` (semiabierto, por `Math.round` desempatando hacia arriba).
   * En coma flotante eso NO se sostiene: un empate exacto en decimal puede no serlo tras multiplicar por 10^d — ej. d=2, x=1,005:
   * `1.005 * 100 === 100.49999999999999`, `Math.round` da 100, se escribe 1,00 y la deuda queda en +0,005 = +u/2. El invariante
   * real (y el que importa: el Kardex nunca se aparta más de medio paso de lo exacto acumulado) es el intervalo CERRADO
   * `[−u/2, u/2]`, `|Σexacto − Σescrito| ≤ u/2`.
   */
  it("la deuda (D0 + Σexacto − Σescrito) queda SIEMPRE en [−u/2, u/2] — incluida la acumulada contra lo exacto", () => {
    fc.assert(
      fc.property(
        decimalesArb.chain((d) => fc.tuple(fc.constant(d), deudaInicialMicroArb(d), secuenciaArb)),
        fc.boolean(),
        ([decimales, deudaInicialMicro, secuencia], conDeudaInicial) => {
          const u = uMicro(decimales);
          const d0 = conDeudaInicial ? deudaInicialMicro : 0;
          const arrastre = crearArrastreDeRedondeo(conDeudaInicial ? new Map([["p", d0 / MICRO]]) : undefined);
          let deuda = d0;
          for (const n of secuencia) {
            const { cantidad } = arrastre.consumir("p", n / MICRO, decimales);
            deuda += n - aMicro(cantidad);
            expect(deuda).toBeGreaterThanOrEqual(-u / 2);
            expect(deuda).toBeLessThanOrEqual(u / 2);
          }
        },
      ),
    );
  });

  it("cada cantidad escrita es un múltiplo exacto de u, no negativa y nunca -0", () => {
    fc.assert(
      fc.property(decimalesArb, secuenciaArb, (decimales, secuencia) => {
        const factor = 10 ** decimales;
        const arrastre = crearArrastreDeRedondeo();
        for (const n of secuencia) {
          const { cantidad } = arrastre.consumir("p", n / MICRO, decimales);
          // Múltiplo exacto: es bit a bit el mismo número que `k / 10^d` para un entero k.
          expect(cantidad).toBe(Math.round(cantidad * factor) / factor);
          expect(cantidad).toBeGreaterThanOrEqual(0);
          expect(Object.is(cantidad, -0)).toBe(false);
        }
      }),
    );
  });

  it("cantidadExacta es null EXACTAMENTE cuando la magnitud exacta coincide con la escrita; si no, trae la magnitud de ESTA parte", () => {
    fc.assert(
      fc.property(decimalesArb, secuenciaArb, (decimales, secuencia) => {
        const arrastre = crearArrastreDeRedondeo();
        for (const n of secuencia) {
          const exacto = redondearACantidadDeUnidad(n / MICRO, 8); // lo que la implementación compara (limpio a 8 decimales)
          const { cantidad, cantidadExacta } = arrastre.consumir("p", n / MICRO, decimales);
          if (cantidadExacta === null) {
            expect(cantidad).toBe(exacto);
          } else {
            expect(cantidadExacta).toBe(exacto);
            expect(cantidadExacta).not.toBe(cantidad);
          }
        }
      }),
    );
  });

  it("sin deuda inicial (sin argumento o Map vacío), el PRIMER resultado coincide con redondearACantidadDeUnidad directo", () => {
    fc.assert(
      fc.property(decimalesArb, magnitudMicroArb, fc.boolean(), (decimales, n, sinArgumento) => {
        const arrastre = sinArgumento ? crearArrastreDeRedondeo() : crearArrastreDeRedondeo(new Map());
        expect(arrastre.consumir("p", n / MICRO, decimales).cantidad).toBe(redondearACantidadDeUnidad(n / MICRO, decimales));
      }),
    );
  });

  it("para CUALQUIER double ≥ 0, el primer resultado es redondearACantidadDeUnidad sobre la magnitud limpia a 8 decimales", () => {
    // Contrato exacto para entradas con más de 8 decimales: la implementación limpia primero a 8 (r8) y recién después redondea
    // a la unidad — por eso, fuera del dominio de ≤ 8 decimales, NO siempre coincide con redondearACantidadDeUnidad a secas
    // (ej. 0,4999999999 con d=0: limpio da 0,5 → 1; directo daría 0).
    fc.assert(
      fc.property(
        decimalesArb,
        fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (decimales, x) => {
          const esperado = redondearACantidadDeUnidad(redondearACantidadDeUnidad(x, 8), decimales) || 0;
          expect(crearArrastreDeRedondeo().consumir("p", x, decimales).cantidad).toBe(esperado);
        },
      ),
    );
  });

  it("productos distintos intercalados se procesan cada uno por su cuenta (mismo resultado que con un arrastre por producto)", () => {
    const productos = ["a", "b", "c", "d"] as const;
    fc.assert(
      fc.property(
        fc.tuple(decimalesArb, decimalesArb, decimalesArb, decimalesArb),
        fc.array(fc.tuple(fc.integer({ min: 0, max: productos.length - 1 }), magnitudMicroArb), { minLength: 1, maxLength: 80 }),
        (decimalesPorProducto, pasos) => {
          const compartido = crearArrastreDeRedondeo();
          const aislados = new Map(productos.map((p) => [p, crearArrastreDeRedondeo()]));
          for (const [i, n] of pasos) {
            const producto = productos[i];
            const d = decimalesPorProducto[i];
            expect(compartido.consumir(producto, n / MICRO, d)).toEqual(aislados.get(producto)!.consumir(producto, n / MICRO, d));
          }
        },
      ),
    );
  });

  it("nunca muta el Map de deuda inicial recibido", () => {
    fc.assert(
      fc.property(
        decimalesArb.chain((d) =>
          fc.tuple(
            fc.constant(d),
            fc.dictionary(fc.constantFrom("a", "b", "c"), deudaInicialMicroArb(d)),
            fc.array(fc.tuple(fc.constantFrom("a", "b", "c", "z"), magnitudMicroArb), { maxLength: 40 }),
          ),
        ),
        ([decimales, deudas, pasos]) => {
          const inicial = new Map(Object.entries(deudas).map(([p, micro]) => [p, micro / MICRO]));
          const copia = [...inicial.entries()];
          const arrastre = crearArrastreDeRedondeo(inicial);
          for (const [p, n] of pasos) arrastre.consumir(p, n / MICRO, decimales);
          expect([...inicial.entries()]).toEqual(copia);
        },
      ),
    );
  });
});
