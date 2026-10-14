import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  consumoDeLineaConfigurada,
  type ConsumoDeOpcionParaVender,
  type EntradaDeConsumoConfigurado,
  type IngredienteDeBase,
  type OpcionConConsumo,
  type ResultadoDeConsumoConfigurado,
} from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, paraConsumo, permitidosDe, type Escenario } from "./escenarios";
import { consumoDeLineaConfigurada as consumoAnterior } from "./oraculos/consumo-de-linea-configurada-anterior";

/**
 * GO-3 (ADR-032, frente B), paso B1: la rama ADITIVA `excepcion` de `consumoDeLineaConfigurada` (la receta propia de la combinación vendida).
 *  - SIN excepción (ausente, o con una versión vacía = «vuelve a la regla general») el resultado es IDÉNTICO (`Object.is` en cada número) al de la versión anterior copiada
 *    (`oraculos/consumo-de-linea-configurada-anterior.ts`), para cualquier elección de los escenarios de GO-0b (café, hotel y spa) y cualquier cantidad.
 *  - El flat white grande con su receta propia: 36 g de café y 200 ml de leche (sin escalar) y el vaso de 400 ml de la medida, entero.
 *  - La leche de almendras (que no es eje) se aplica sobre la excepción: reemplaza a la leche con la cantidad de la opción × el factor del tamaño.
 *  - Un reemplazo del envase cuyo insumo no está en la excepción se informa en `reemplazosSinEfecto`.
 *  - Decimal exacto con merma: la cuenta de la excepción es en decimal.js, sin el error del float.
 * Mutaciones demostradas: escalar la excepción por el tamaño (cae «36 g y 200 ml»), no saltear los consumos que escalan de la medida eje (cae «el vaso entero» por la crema de más) y aplicar la
 * excepción con una versión vacía (cae la paridad).
 */

const S = "suc-centro";
const D = Decimal.clone({ precision: 80 });
const ok = (r: ResultadoDeConsumoConfigurado) => {
  if (!r.ok) throw new Error(`se esperaba un consumo y vino ${r.codigo}: ${r.mensaje}`);
  return r;
};

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
  expect(identicos(consumoDeLineaConfigurada({ ...entrada, excepcion: { ingredientes: [], opcionesDeEjes: caso.ids } }), antes), `${caso.nombre} [${caso.ids.join(",")}] × ${cantidad}: una versión vacía es «sin excepción»`).toBe(true);
}

describe("sin excepción, la salida es la de siempre (Object.is), contra la versión anterior copiada", () => {
  it("la enumeración de elecciones válidas no está vacía ni se achicó sin aviso (64: café 24, hotel 16, spa 24)", () => {
    expect(ELECCIONES_VALIDAS.length).toBe(64);
    expect(Object.fromEntries(Object.keys(ESCENARIOS).map((n) => [n, ELECCIONES_VALIDAS.filter((c) => c.nombre === n).length]))).toEqual({ CAFE: 24, HOTEL: 16, SPA: 24 });
  });

  it("EXHAUSTIVO: cada elección válida × cada cantidad de la lista (640 casos): sin `excepcion` y con una excepción vacía da EXACTAMENTE lo mismo que antes", () => {
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

// El flat white del ADR de ZuluHub: base (lo del mediano) 18 g de café, 150 ml de leche y el vaso estándar; Tamaño (eje 1) Grande ×1,5 que suma el vaso de 400 ml (no escala) y una crema
// que escala; Tipo (eje 2) Flat white que suma un shot (escala); y una Leche (no es eje) de almendras que reemplaza a la leche con 150 ml (escala).
const ing = (insumoProductoId: string, cantidad: number, unidadStockId: string, mermaPorcentaje = 0): IngredienteDeBase => ({
  ingrediente: { insumoProductoId, cantidad, mermaPorcentaje, rendimientosLocales: [], insumoSustitutoIds: [] },
  unidadStockId,
});
const consumo = (c: Partial<ConsumoDeOpcionParaVender> & Pick<ConsumoDeOpcionParaVender, "insumoProductoId" | "cantidad">): ConsumoDeOpcionParaVender => ({
  efecto: "SUMA",
  reemplazaAProductoId: null,
  unidadStockId: "u",
  mermaPorcentaje: 0,
  escalaConLaMedida: false,
  ...c,
});
const BASE = [ing("cafe", 0.018, "kg"), ing("leche", 0.15, "l"), ing("vaso-estandar", 1, "u")];
const GRANDE: OpcionConConsumo = {
  opcionId: "grande",
  nombre: "Grande",
  tipo: "MEDIDA",
  ordenDeGrupo: 0,
  ordenDeOpcion: 3,
  cantidad: 1,
  factorEscala: 1.5,
  consumos: [consumo({ insumoProductoId: "vaso-400", cantidad: 1 }), consumo({ insumoProductoId: "crema", cantidad: 0.01, unidadStockId: "l", escalaConLaMedida: true })],
};
const FLAT_WHITE: OpcionConConsumo = { opcionId: "flat-white", nombre: "Flat white", tipo: "VARIANTE", ordenDeGrupo: 1, ordenDeOpcion: 3, cantidad: 1, factorEscala: null, consumos: [consumo({ insumoProductoId: "cafe-shot", cantidad: 0.009, unidadStockId: "kg", escalaConLaMedida: true })] };
const ALMENDRAS: OpcionConConsumo = {
  opcionId: "almendras",
  nombre: "Almendras",
  tipo: "VARIANTE",
  ordenDeGrupo: 2,
  ordenDeOpcion: 2,
  cantidad: 1,
  factorEscala: null,
  consumos: [consumo({ efecto: "REEMPLAZA", insumoProductoId: "almendras", reemplazaAProductoId: "leche", cantidad: 0.15, unidadStockId: "l", escalaConLaMedida: true })],
};
const EXCEPCION = { ingredientes: [{ insumoProductoId: "cafe", cantidad: 0.036, mermaPorcentaje: 0, unidadStockId: "kg" }, { insumoProductoId: "leche", cantidad: 0.2, mermaPorcentaje: 0, unidadStockId: "l" }], opcionesDeEjes: ["grande", "flat-white"] };
const pedidos = (r: ResultadoDeConsumoConfigurado) => ok(r).pedidos.map((p) => [p.productoId, p.cantidad, p.unidadStockId]);

describe("con la receta propia de la combinación", () => {
  it("sin excepción, el flat white grande sale de la regla general: la base × 1,5, el vaso estándar más el de 400, la crema y el shot escalados", () => {
    expect(pedidos(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: S, base: BASE, opciones: [GRANDE, FLAT_WHITE], adicionales: [] }))).toEqual([
      ["cafe", 0.027, "kg"], ["leche", 0.225, "l"], ["vaso-estandar", 1.5, "u"], ["vaso-400", 1, "u"], ["crema", 0.015, "l"], ["cafe-shot", 0.0135, "kg"],
    ]);
  });

  it("con excepción: 36 g de café y 200 ml de leche SIN escalar, y el vaso de 400 ml de la medida entero; la crema que escala y el shot del eje ya están en la excepción", () => {
    const r = ok(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: S, base: BASE, opciones: [GRANDE, FLAT_WHITE], adicionales: [], excepcion: EXCEPCION }));
    expect(r.pedidos.map((p) => [p.productoId, p.cantidad, p.unidadStockId, p.insumoSustitutoIds])).toEqual([["cafe", 0.036, "kg", []], ["leche", 0.2, "l", []], ["vaso-400", 1, "u", []]]);
    expect(r.reemplazosSinEfecto).toEqual([]);
    expect(pedidos(consumoDeLineaConfigurada({ cantidad: 3, sucursalId: S, base: BASE, opciones: [FLAT_WHITE, GRANDE], adicionales: [], excepcion: EXCEPCION })), "× 3, sin depender del orden").toEqual([
      ["cafe", 0.108, "kg"], ["leche", 0.6, "l"], ["vaso-400", 3, "u"],
    ]);
  });

  it("la leche de almendras (no es eje) se aplica sobre la excepción: reemplaza a la leche, en su lugar, con 150 ml × 1,5", () => {
    expect(pedidos(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: S, base: BASE, opciones: [GRANDE, FLAT_WHITE, ALMENDRAS], adicionales: [], excepcion: EXCEPCION }))).toEqual([
      ["cafe", 0.036, "kg"], ["almendras", 0.225, "l"], ["vaso-400", 1, "u"],
    ]);
  });

  it("un reemplazo del envase cuyo insumo no está en la excepción no hace nada y se informa en `reemplazosSinEfecto`", () => {
    const grandeQueReemplaza: OpcionConConsumo = { ...GRANDE, consumos: [consumo({ efecto: "REEMPLAZA", insumoProductoId: "vaso-400", reemplazaAProductoId: "vaso-estandar", cantidad: 1 })] };
    const r = ok(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: S, base: BASE, opciones: [grandeQueReemplaza, FLAT_WHITE], adicionales: [], excepcion: EXCEPCION }));
    expect(r.pedidos.map((p) => p.productoId)).toEqual(["cafe", "leche"]);
    expect(r.reemplazosSinEfecto).toEqual([{ opcionId: "grande", reemplazaAProductoId: "vaso-estandar" }]);
  });

  it("decimal exacto con merma: 3 × 0,0333 × 1,05 = 0,104895 justo (el float daría otro último dígito)", () => {
    const excepcion = { ingredientes: [{ insumoProductoId: "cafe", cantidad: 0.0333, mermaPorcentaje: 5, unidadStockId: "kg" }], opcionesDeEjes: ["grande"] };
    const r = ok(consumoDeLineaConfigurada({ cantidad: 3, sucursalId: S, base: BASE, opciones: [GRANDE], adicionales: [], excepcion }));
    const esperado = new D(3).times(0.0333).times(new D(1).plus(new D(5).dividedBy(100))).toNumber();
    expect(r.pedidos[0]!.cantidad).toBe(esperado);
    expect(esperado).toBe(0.104895);
  });

  it("si la MEDIDA no es eje (los ejes son variantes), la excepción se escala por el tamaño como cualquier base", () => {
    const r = consumoDeLineaConfigurada({ cantidad: 1, sucursalId: S, base: BASE, opciones: [GRANDE, FLAT_WHITE], adicionales: [], excepcion: { ...EXCEPCION, opcionesDeEjes: ["flat-white"] } });
    expect(pedidos(r)).toEqual([["cafe", 0.054, "kg"], ["leche", 0.3, "l"], ["vaso-400", 1, "u"], ["crema", 0.015, "l"]]);
  });

  it("falla cerrado (CONSUMO_INVALIDO) con un eje que no es una opción elegida, con una INCLUIDA como eje o con un ingrediente inválido", () => {
    const base = { cantidad: 1, sucursalId: S, base: BASE, adicionales: [] };
    expect(consumoDeLineaConfigurada({ ...base, opciones: [GRANDE], excepcion: { ...EXCEPCION, opcionesDeEjes: ["otra"] } })).toMatchObject({ ok: false, codigo: "CONSUMO_INVALIDO" });
    const incluida: OpcionConConsumo = { ...FLAT_WHITE, opcionId: "azucar", tipo: "INCLUIDA", consumos: [] };
    expect(consumoDeLineaConfigurada({ ...base, opciones: [GRANDE, incluida], excepcion: { ...EXCEPCION, opcionesDeEjes: ["azucar"] } })).toMatchObject({ ok: false, codigo: "CONSUMO_INVALIDO" });
    for (const malo of [{ cantidad: 0 }, { cantidad: Number.NaN }, { mermaPorcentaje: 101 }, { mermaPorcentaje: -1 }]) {
      const excepcion = { ingredientes: [{ insumoProductoId: "cafe", cantidad: 0.036, mermaPorcentaje: 0, unidadStockId: "kg", ...malo }], opcionesDeEjes: ["grande"] };
      expect(consumoDeLineaConfigurada({ ...base, opciones: [GRANDE], excepcion }), JSON.stringify(malo)).toMatchObject({ ok: false, codigo: "CONSUMO_INVALIDO" });
    }
  });
});
