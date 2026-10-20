import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { consumoDeLineaConfigurada, type EntradaDeConsumoConfigurado } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, paraConsumo, permitidosDe, type Escenario } from "./escenarios";
import { consumoDeLineaConfigurada as consumoAnterior } from "./oraculos/consumo-de-linea-configurada-anterior";

/**
 * PARIDAD de `consumoDeLineaConfigurada` con la versión anterior copiada (`oraculos/consumo-de-linea-configurada-anterior.ts`, la de antes de GO-3): el resultado es IDÉNTICO
 * (`Object.is` en cada número) para cualquier elección de los escenarios de GO-0b (café, hotel y spa) y cualquier cantidad.
 *
 * Nació en GO-3 (ADR-032, frente B, paso B1) como `consumo-con-excepcion.test.ts`, para probar que la rama ADITIVA `excepcion` (la receta propia de una combinación) no cambiaba nada sin
 * excepción. La Fase 3 de la ola «precio y carta» (paso 3.4) retiró esa rama con GO-3a: quedan la paridad exhaustiva (640 casos) y la de propiedad (1.500), que prueban que el consumo y el
 * costo congelado de toda venta con opciones siguen siendo exactamente los de antes. Los casos de la receta propia (el flat white grande) se fueron con ella.
 * Mutación demostrada (roja y revertida): usar la fórmula escalada de la base aunque el factor sea 1 (cae la paridad por `Object.is`).
 */


function eleccionDe(escenario: Escenario, ids: string[]) {
  const validadas = validarOpcionesElegidas(permitidosDe(escenario), ids.map((opcionId) => ({ opcionId, cantidad: 1 })));
  if (!validadas.ok) return null;
  return paraConsumo(escenario, validadas.opciones);
}

/** Igualdad estricta de dos resultados: misma forma y cada número `Object.is` (no alcanza `toEqual`, que da por iguales 0 y -0 y no mira el último bit de otra forma). */
function identicos(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => identicos(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return identicos(ka, kb) && ka.every((k) => identicos((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/**
 * TODAS las elecciones válidas de los tres escenarios, enumeradas por construcción (cada subconjunto de sus opciones que `validarOpcionesElegidas` acepta). Es determinista: no depende
 * del azar cuántos casos válidos se prueban (antes se filtraban subconjuntos al azar y la guarda «más de 200 válidos» fallaba a veces con 195). Hoy son 64 (café 24, hotel 16, spa 24).
 */
const ESCENARIOS = { CAFE, HOTEL, SPA } as const;
const ELECCIONES_VALIDAS = Object.entries(ESCENARIOS).flatMap(([nombre, escenario]) => {
  const ids = escenario.opciones.map((o) => o.opcionId);
  const validas: { nombre: string; escenario: Escenario; ids: string[]; eleccion: NonNullable<ReturnType<typeof eleccionDe>> }[] = [];
  for (let mascara = 0; mascara < 1 << ids.length; mascara++) {
    const elegidos = ids.filter((_, i) => (mascara & (1 << i)) !== 0);
    const eleccion = eleccionDe(escenario, elegidos);
    if (eleccion) validas.push({ nombre, escenario, ids: elegidos, eleccion });
  }
  return validas;
});
/** Cantidades enteras, fraccionarias (venta fraccionada) e inválidas (0 y negativa: las dos versiones rechazan igual). */
const CANTIDADES = [1, 2, 3, 7, 12, 0.5, 1.25, 2.75, 0, -1] as const;

function compararConLaAnterior(caso: (typeof ELECCIONES_VALIDAS)[number], cantidad: number) {
  const entrada: EntradaDeConsumoConfigurado = { cantidad, sucursalId: caso.escenario.sucursalId, base: caso.escenario.base, ...caso.eleccion };
  const antes = consumoAnterior(entrada);
  expect(identicos(consumoDeLineaConfigurada(entrada), antes), `${caso.nombre} [${caso.ids.join(",")}] × ${cantidad}`).toBe(true);
}

describe("la salida es la de siempre (Object.is), contra la versión anterior copiada", () => {
  it("la enumeración de elecciones válidas no está vacía ni se achicó sin aviso (64: café 24, hotel 16, spa 24)", () => {
    expect(ELECCIONES_VALIDAS.length).toBe(64);
    expect(Object.fromEntries(Object.keys(ESCENARIOS).map((n) => [n, ELECCIONES_VALIDAS.filter((c) => c.nombre === n).length]))).toEqual({ CAFE: 24, HOTEL: 16, SPA: 24 });
  });

  it("EXHAUSTIVO: cada elección válida × cada cantidad de la lista (640 casos) da EXACTAMENTE lo mismo que antes", () => {
    let probadas = 0;
    for (const caso of ELECCIONES_VALIDAS) {
      for (const cantidad of CANTIDADES) {
        compararConLaAnterior(caso, cantidad);
        probadas++;
      }
    }
    expect(probadas).toBe(ELECCIONES_VALIDAS.length * CANTIDADES.length);
  });

  it("propiedad: cualquier elección válida (por construcción, sin filtrar) y cualquier cantidad entera o de hasta 4 decimales, 1500 casos, todos probados", () => {
    let probadas = 0;
    const cantidadArb = fc.oneof(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 500_000 }).map((n) => n / 10_000));
    fc.assert(
      fc.property(fc.constantFrom(...ELECCIONES_VALIDAS), cantidadArb, (caso, cantidad) => {
        compararConLaAnterior(caso, cantidad);
        probadas++;
      }),
      { numRuns: 1500 },
    );
    expect(probadas, "cada corrida es un caso válido: ninguno se descarta").toBe(1500);
  });
});
