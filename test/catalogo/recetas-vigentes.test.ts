import { describe, expect, expectTypeOf, it } from "vitest";
import fc from "fast-check";
import { cargarRecetaVigente, cargarRecetasVigentes, incluirRecetaVigente, quedarseConLaVigente, versionVigentePorProducto, whereConReceta } from "../../src/core/catalogo/recetas-vigentes";

/**
 * El embudo de la receta vigente (vigente = la de mayor `version` de cada plato). La lógica pura es `quedarseConLaVigente`; el resto son
 * consultas finas que se verifican de punta a punta en `test/recetas/caracterizacion-vigente-por-lector.test.ts` y
 * `test/reportes/recetas-una-consulta.test.ts` (contra Postgres real).
 *
 * `>` vs `>=` en la comparación es una mutación equivalente: `@@unique([productoId, version])` impide dos versiones iguales de un plato, así
 * que el empate no existe. Quedarse con la MENOR (o la primera de una lista descendente) sí lo detectan la propiedad y la caracterización.
 */
type Fila = { productoId: string; version: number; marca: number };

const filas = fc.array(
  fc.record({
    productoId: fc.constantFrom("a", "b", "c", "d"),
    version: fc.integer({ min: 1, max: 6 }),
  }),
  { maxLength: 40 }
);

/** Cada fila con una marca única, para distinguir filas con el mismo (productoId, version). */
const conMarca = (xs: { productoId: string; version: number }[]): Fila[] => xs.map((x, i) => ({ ...x, marca: i }));

describe("quedarseConLaVigente", () => {
  it("para cualquier orden de entrada, de cada plato gana la versión más alta", () => {
    fc.assert(
      fc.property(filas, (xs) => {
        const entrada = conMarca(xs);
        const vigentes = quedarseConLaVigente(entrada);
        for (const [productoId, ganadora] of vigentes) {
          const maxima = Math.max(...entrada.filter((f) => f.productoId === productoId).map((f) => f.version));
          expect(ganadora.version).toBe(maxima);
        }
        expect(new Set(vigentes.keys())).toEqual(new Set(entrada.map((f) => f.productoId)));
      })
    );
  });

  it("el resultado no depende del orden de la entrada (salvo empates exactos de versión, que no existen en la base)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ productoId: fc.constantFrom("a", "b", "c"), version: fc.integer({ min: 1, max: 8 }) }), { selector: (x) => `${x.productoId}-${x.version}`, maxLength: 20 }),
        fc.nat(),
        (xs, giro) => {
          const entrada = conMarca(xs);
          const rotada = entrada.length ? [...entrada.slice(giro % entrada.length), ...entrada.slice(0, giro % entrada.length)] : entrada;
          const a = quedarseConLaVigente(entrada);
          const b = quedarseConLaVigente(rotada);
          expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
        }
      )
    );
  });

  it("con la entrada ascendente por versión (como la devuelve la consulta), las claves salen en el orden de la versión más baja de cada plato", () => {
    fc.assert(
      fc.property(filas, (xs) => {
        const ascendente = conMarca(xs).sort((p, q) => p.version - q.version);
        const claves = [...quedarseConLaVigente(ascendente).keys()];
        const esperado: string[] = [];
        for (const f of ascendente) if (!esperado.includes(f.productoId)) esperado.push(f.productoId);
        expect(claves).toEqual(esperado);
      })
    );
  });

  it("ejemplo: una versión vieja que aparece después de la nueva no la pisa", () => {
    const v = quedarseConLaVigente([
      { productoId: "pan", version: 1 },
      { productoId: "pan", version: 3 },
      { productoId: "pan", version: 2 },
    ]);
    expect(v.get("pan")?.version).toBe(3);
  });

  it("conserva el tipo de la fila de entrada", () => {
    const v = quedarseConLaVigente([{ productoId: "x", version: 1, extra: "dato" as const }]);
    expectTypeOf(v).toEqualTypeOf<Map<string, { productoId: string; version: number; extra: "dato" }>>();
  });
});

describe("tipos del embudo", () => {
  it("la receta vigente de un plato trae exactamente lo que pide el include (o null)", () => {
    type Retorno = Awaited<ReturnType<typeof cargarRecetaVigente<{ include: { ingredientes: true } }>>>;
    expectTypeOf<NonNullable<Retorno>["ingredientes"]>().toBeArray();
    expectTypeOf<Retorno>().toBeNullable();
  });

  it("cargarRecetasVigentes devuelve un Map por plato con el include tipado", () => {
    type Retorno = Awaited<ReturnType<typeof cargarRecetasVigentes<{ ingredientes: true }>>>;
    expectTypeOf<Retorno>().toExtend<Map<string, { productoId: string; version: number }>>();
  });

  it("versionVigentePorProducto devuelve el número (o null) por plato", () => {
    expectTypeOf<Awaited<ReturnType<typeof versionVigentePorProducto>>>().toEqualTypeOf<Map<string, number | null>>();
  });

  it("los fragmentos de Producto son estructuras literales de solo lectura", () => {
    expect(whereConReceta()).toEqual({ recetaVersiones: { some: {} } });
    expect(incluirRecetaVigente({ ingredientes: true })).toEqual({ recetaVersiones: { orderBy: { version: "desc" }, take: 1, include: { ingredientes: true } } });
  });
});
