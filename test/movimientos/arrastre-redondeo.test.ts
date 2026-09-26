import { describe, expect, it } from "vitest";
import { crearArrastreDeRedondeo } from "../../src/core/movimientos/arrastre-redondeo";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

/**
 * Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md), Paso 1: núcleo puro, sin base de datos y SIN usarse todavía en
 * ningún lado (`registrar-venta.ts` sigue llamando a `redondearACantidadDeUnidad` a secas hasta el Paso 4) — este archivo no puede
 * cambiar ningún comportamiento observable de la aplicación.
 */

/** Generador determinista (LCG, mismo patrón que `centavosAlAzar` en test/auditoria/precision-medio-centavo.test.ts). */
function* magnitudesAlAzar(cuantos: number, semilla: number): Generator<number> {
  let x = semilla;
  for (let i = 0; i < cuantos; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    yield (x % 100_000) / 1000; // 0,000 a 99,999
  }
}

describe("crearArrastreDeRedondeo", () => {
  it("0,5 + 0,5 con d=0 da [1, 0] (no [1, 1]: dos medias pizzas consumen UN bollo, no dos)", () => {
    const arrastre = crearArrastreDeRedondeo();
    const r1 = arrastre.consumir("bollo", 0.5, 0);
    const r2 = arrastre.consumir("bollo", 0.5, 0);
    expect([r1.cantidad, r2.cantidad]).toEqual([1, 0]);
    expect(r1.cantidad + r2.cantidad).toBe(1);
  });

  it("4 × 0,25 con d=0 da total 1 (no 0: Math.round(0,25) redondea hacia abajo, la deuda lo recupera)", () => {
    const arrastre = crearArrastreDeRedondeo();
    const escritos = [0, 0, 0, 0].map(() => arrastre.consumir("bollo", 0.25, 0).cantidad);
    expect(escritos).toEqual([0, 1, 0, 0]);
    expect(escritos.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("con D=0 (arrastre recién creado, o un producto que nunca acumuló deuda) coincide EXACTAMENTE con redondearACantidadDeUnidad — compatibilidad con el comportamiento de hoy", () => {
    const casos: [number, number][] = [
      [2.247, 0], // el caso "Contraste" existente (7 × 0,3 × 1,07)
      [0.5, 0],
      [0.25, 0],
      [1.256, 2],
      [0.3, 2],
      [999.9999, 4],
    ];
    for (const [cantidad, decimales] of casos) {
      // Cada caso con SU PROPIO arrastre (D=0): no hay deuda previa que mezclarse entre casos.
      const arrastre = crearArrastreDeRedondeo();
      const { cantidad: escrito } = arrastre.consumir("producto-x", cantidad, decimales);
      expect(escrito, `cantidad=${cantidad}, decimales=${decimales}`).toBe(redondearACantidadDeUnidad(cantidad, decimales));
    }
  });

  it("-0 se normaliza a 0 (Math.round(-0.25) da -0; nunca se escribe un cero con signo)", () => {
    const arrastre = crearArrastreDeRedondeo();
    // Deuda negativa (-0.5) + 0.25 = -0.25 → Math.round(-0.25) = -0.
    arrastre.consumir("bollo", 0.5, 0); // deuda queda en -0.5
    const { cantidad } = arrastre.consumir("bollo", 0.25, 0);
    expect(Object.is(cantidad, -0)).toBe(false);
    expect(cantidad).toBe(0);
  });

  it("cantidadExacta es null cuando la cantidad escrita ya es exacta (0,3 kg con d=2 — sin deuda previa)", () => {
    const arrastre = crearArrastreDeRedondeo();
    const { cantidad, cantidadExacta } = arrastre.consumir("mp-kg", 0.3, 2);
    expect(cantidad).toBe(0.3);
    expect(cantidadExacta).toBeNull();
  });

  it("cantidadExacta lleva la magnitud EXACTA de esta parte cuando difiere de lo escrito", () => {
    const arrastre = crearArrastreDeRedondeo();
    const { cantidad, cantidadExacta } = arrastre.consumir("bollo", 0.5, 0);
    expect(cantidad).toBe(1);
    expect(cantidadExacta).toBe(0.5);
  });

  it("la deuda inicial (Map productoId→D) se respeta, y arranca en 0 para un producto ausente del Map", () => {
    const arrastre = crearArrastreDeRedondeo(new Map([["bollo", -0.5]]));
    // Con deuda -0.5, la próxima parte de 0,5 debería redondear a 0 (mismo estado que después de dos ventas de 0,5).
    expect(arrastre.consumir("bollo", 0.5, 0).cantidad).toBe(0);
    // Un producto sin entrada en el Map arranca en D=0, como si el arrastre estuviera recién creado.
    expect(arrastre.consumir("otro", 0.5, 0).cantidad).toBe(1);
  });

  it("no muta el Map de deuda inicial recibido (se copia)", () => {
    const inicial = new Map([["bollo", -0.5]]);
    const arrastre = crearArrastreDeRedondeo(inicial);
    arrastre.consumir("bollo", 0.5, 0);
    expect(inicial.get("bollo")).toBe(-0.5);
  });

  it("productos distintos llevan deudas independientes (Napolitana y muzzarella comparten bollo, pero un insumo hermano de otra unidad no)", () => {
    const arrastre = crearArrastreDeRedondeo();
    expect(arrastre.consumir("bollo", 0.5, 0).cantidad).toBe(1);
    expect(arrastre.consumir("jamon", 0.5, 0).cantidad).toBe(1); // jamón nunca vio la deuda de bollo — redondea desde D=0 otra vez
    expect(arrastre.consumir("bollo", 0.5, 0).cantidad).toBe(0); // bollo sigue arrastrando su propia deuda
  });

  describe("propiedad: después de cada paso, |Σexacto − Σescrito| ≤ u/2 y escrito ≥ 0 (2.000 magnitudes, semilla fija)", () => {
    for (const decimales of [0, 2, 4] as const) {
      it(`decimales=${decimales}`, () => {
        const u = 10 ** -decimales;
        const arrastre = crearArrastreDeRedondeo();
        let sumaExacto = 0;
        let sumaEscrito = 0;
        let i = 0;
        for (const magnitud of magnitudesAlAzar(2000, 20260926 + decimales)) {
          const { cantidad, cantidadExacta } = arrastre.consumir("mp", magnitud, decimales);
          sumaExacto += magnitud;
          sumaEscrito += cantidad;
          expect(cantidad, `paso ${i}`).toBeGreaterThanOrEqual(0);
          expect(Math.abs(sumaExacto - sumaEscrito), `paso ${i}: Σexacto=${sumaExacto}, Σescrito=${sumaEscrito}`).toBeLessThanOrEqual(u / 2 + 1e-9);
          // cantidadExacta, cuando está presente, es SIEMPRE la magnitud exacta de ESTA parte (nunca la acumulada).
          if (cantidadExacta !== null) expect(Math.abs(cantidadExacta - magnitud)).toBeLessThan(1e-6);
          i++;
        }
      });
    }
  });
});
