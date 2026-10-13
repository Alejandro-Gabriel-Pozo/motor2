import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importeDeLinea, redondearMoneda } from "../../src/core/moneda";
import {
  componentesDeEleccion,
  precioMinimoPromo,
  prorratearPrecioPromo,
  totalProrrateado,
  validarEleccionPromo,
  validarYAplanarEleccionPromo,
  type ComponentePromoElegido,
  type CupoDeEntradasDefinicion,
  type CupoPromoDefinicion,
  type EleccionDeCupo,
} from "../../src/core/pos/promo-combo";
import * as anterior from "./oraculos/promo-combo-anterior";

/**
 * GO-3 (ADR-032), paso D1 — propiedades de las extensiones ADITIVAS de `promo-combo.ts` (fast-check):
 *  1. PARIDAD CON EL ORÁCULO: sin cupos de entradas ni elecciones por cupo (todo lo de hoy), `validarYAplanarEleccionPromo`, `validarEleccionPromo` y `prorratearPrecioPromo` dan EXACTAMENTE
 *     (`toEqual`) lo mismo que la versión anterior copiada (`oraculos/promo-combo-anterior.ts`), con entradas rotas a propósito (secciones de más, repetidas, cantidades sueltas, precios raros).
 *     Así la huella del POS y los goldens no cambian.
 *  2. LA SUMA ES EXACTA también con cupos de entradas y claves de componente: la suma de las filas es el precio de la promo al centavo, y ninguna unidad baja de $0,01.
 *  3. DOS CONFIGURACIONES del mismo producto con el mismo precio no se mezclan en una fila (cada fila es de una sola clave de componente).
 * Mutaciones demostradas: agrupar por `productoId` en vez de por `claveComponente` (cae la 3) y dejar de copiar `claveComponente` a la fila (cae la 3).
 */

const SECCIONES = ["sec-a", "sec-b", "sec-c"] as const;
const PRODUCTOS = ["p1", "p2", "p3", "p4", "p5", "mp-ajena"] as const;

const cuposArb: fc.Arbitrary<CupoPromoDefinicion[]> = fc
  .uniqueArray(fc.constantFrom(...SECCIONES), { minLength: 1, maxLength: 3 })
  .chain((secciones) =>
    fc.tuple(
      ...secciones.map((seccionCartaId) =>
        fc
          .record({ cantidadMinima: fc.integer({ min: 0, max: 3 }), extra: fc.integer({ min: 0, max: 3 }), elegibles: fc.uniqueArray(fc.constantFrom("p1", "p2", "p3", "p4", "p5"), { minLength: 1, maxLength: 4 }) })
          .map(({ cantidadMinima, extra, elegibles }): CupoPromoDefinicion => ({ seccionCartaId, nombreSeccion: seccionCartaId, cantidadMinima, cantidadMaximaCupo: cantidadMinima + extra, elegibles: new Set(elegibles) })),
      ),
    ),
  );
const elegidoArb = fc.record({ productoId: fc.constantFrom(...PRODUCTOS), cantidad: fc.oneof(fc.integer({ min: -1, max: 5 }), fc.constantFrom(1.5, 30, Number.NaN)) });
const eleccionArb: fc.Arbitrary<EleccionDeCupo> = fc.record({ seccionCartaId: fc.constantFrom(...SECCIONES, "sec-fuera"), elegidos: fc.array(elegidoArb, { maxLength: 4 }) });
const eleccionesArb = fc.array(eleccionArb, { maxLength: 4 });

const precioArb = fc.oneof(fc.integer({ min: 1, max: 2_000_000 }).map((c) => c / 100), fc.constantFrom(0, -5, Number.NaN, 0.01, 0.03));
const componenteArb: fc.Arbitrary<ComponentePromoElegido> = fc.record({
  productoId: fc.constantFrom(...PRODUCTOS),
  cantidad: fc.oneof(fc.integer({ min: 1, max: 4 }), fc.constantFrom(0, 1.5)),
  precioCarta: fc.oneof(fc.integer({ min: 0, max: 900_000 }).map((c) => c / 100), fc.constant(0)),
});

describe("paridad con la versión anterior (oráculo copiado): sin cupos nuevos, la salida es la MISMA", () => {
  it("validarYAplanarEleccionPromo y validarEleccionPromo: mismo resultado para cualquier promo de sección y cualquier elección por sección", () => {
    fc.assert(
      fc.property(cuposArb, eleccionesArb, (cupos, elecciones) => {
        expect(validarYAplanarEleccionPromo(cupos, elecciones)).toEqual(anterior.validarYAplanarEleccionPromo(cupos, elecciones));
        expect(validarEleccionPromo(cupos, elecciones)).toEqual(anterior.validarEleccionPromo(cupos, elecciones));
      }),
      { numRuns: 1000 },
    );
  });

  it("prorratearPrecioPromo: mismo resultado (filas, orden y centavos) para cualquier precio y cualquier lista de componentes sin clave de componente", () => {
    fc.assert(
      fc.property(precioArb, fc.array(componenteArb, { maxLength: 6 }), (precio, componentes) => {
        expect(prorratearPrecioPromo(precio, componentes)).toEqual(anterior.prorratearPrecioPromo(precio, componentes));
      }),
      { numRuns: 1000 },
    );
  });

  it("componentesDeEleccion, precioMinimoPromo y totalProrrateado: mismo resultado que antes", () => {
    fc.assert(
      fc.property(eleccionesArb, fc.array(componenteArb, { maxLength: 6 }), precioArb, (elecciones, componentes, precio) => {
        expect(componentesDeEleccion(elecciones)).toEqual(anterior.componentesDeEleccion(elecciones));
        expect(precioMinimoPromo(componentes)).toEqual(anterior.precioMinimoPromo(componentes));
        const r = anterior.prorratearPrecioPromo(precio, componentes);
        if (r.ok) expect(totalProrrateado(r.filas)).toEqual(anterior.totalProrrateado(r.filas));
      }),
      { numRuns: 500 },
    );
  });

  it("la forma rota (no arreglo, elecciones que no son objetos) se rechaza igual que antes", () => {
    const cupos: CupoPromoDefinicion[] = [{ seccionCartaId: "sec-a", nombreSeccion: "A", cantidadMinima: 0, cantidadMaximaCupo: 1, elegibles: new Set(["p1"]) }];
    for (const roto of [null, 3, "x", [null], [{ seccionCartaId: 3, elegidos: [] }], [{ seccionCartaId: "sec-a", elegidos: [{}] }], [{ seccionCartaId: "sec-a", cupoId: "c", elegidos: [] }]] as unknown[]) {
      expect(validarYAplanarEleccionPromo(cupos, roto as EleccionDeCupo[])).toEqual(anterior.validarYAplanarEleccionPromo(cupos, roto as EleccionDeCupo[]));
    }
  });
});

/** Un cupo LISTA con entradas: dos configuraciones del MISMO producto («café chico» y «café grande») y otro producto. */
function cupoDeCafe(cantidadMaxima: number): CupoDeEntradasDefinicion {
  return {
    cupoId: "cupo-cafe",
    tipo: "LISTA",
    nombre: "Café",
    cantidadMinima: 0,
    cantidadMaximaCupo: cantidadMaxima,
    entradas: new Map([
      ["e-chico", { entradaId: "e-chico", productoId: "cafe", claveComponente: "cafe#chico=1" }],
      ["e-grande", { entradaId: "e-grande", productoId: "cafe", claveComponente: "cafe#grande=1" }],
      ["e-agua", { entradaId: "e-agua", productoId: "agua", claveComponente: "agua" }],
    ]),
  };
}

describe("con cupos de entradas: la suma es exacta y las configuraciones no se mezclan", () => {
  const elegidosArb = fc.record({ chico: fc.integer({ min: 0, max: 3 }), grande: fc.integer({ min: 0, max: 3 }), agua: fc.integer({ min: 0, max: 3 }) });
  const preciosDeListaArb = fc.record({ chico: fc.integer({ min: 1, max: 900_000 }).map((c) => c / 100), mismoPrecio: fc.boolean(), grande: fc.integer({ min: 1, max: 900_000 }).map((c) => c / 100), agua: fc.integer({ min: 1, max: 900_000 }).map((c) => c / 100) });

  it("para cualquier elección y precios de lista: suma exacta al centavo, piso de $0,01 y cada fila de UNA sola clave de componente", () => {
    let probadas = 0;
    fc.assert(
      fc.property(elegidosArb, preciosDeListaArb, fc.integer({ min: 1, max: 5_000_000 }).map((c) => c / 100), (n, precios, precioPromo) => {
        const elecciones = [{ cupoId: "cupo-cafe", elegidos: Object.entries({ "e-chico": n.chico, "e-grande": n.grande, "e-agua": n.agua }).filter(([, c]) => c > 0).map(([entradaId, cantidad]) => ({ entradaId, cantidad })) }];
        const v = validarYAplanarEleccionPromo([cupoDeCafe(9)], elecciones);
        if (!v.ok) return;
        const listaDe: Record<string, number> = { "e-chico": precios.chico, "e-grande": precios.mismoPrecio ? precios.chico : precios.grande, "e-agua": precios.agua };
        const componentes = v.componentes.map((c) => ({ ...c, precioCarta: listaDe[c.entradaId!]! }));
        const r = prorratearPrecioPromo(precioPromo, componentes);
        const unidades = componentes.reduce((s, c) => s + c.cantidad, 0);
        if (unidades === 0) {
          expect(r.ok).toBe(false);
          return;
        }
        if (redondearMoneda(precioPromo) < redondearMoneda(0.01 * unidades)) {
          expect(r.ok).toBe(false);
          return;
        }
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        probadas++;
        expect(totalProrrateado(r.filas)).toBe(redondearMoneda(precioPromo));
        expect(r.filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0)).toBeCloseTo(precioPromo, 6);
        for (const f of r.filas) expect(f.precioUnitario).toBeGreaterThanOrEqual(0.01);
        // Cada fila tiene la clave de su componente; las unidades de cada clave suman lo elegido de ella.
        const porClave = new Map<string, number>();
        for (const f of r.filas) porClave.set(f.claveComponente!, (porClave.get(f.claveComponente!) ?? 0) + f.cantidad);
        for (const c of componentes) expect(porClave.get(c.claveComponente!), c.claveComponente).toBe(c.cantidad);
      }),
      { numRuns: 1000 },
    );
    expect(probadas).toBeGreaterThan(100);
  });

  it("dos configuraciones del mismo producto con el MISMO precio quedan en dos filas, una por configuración", () => {
    const v = validarYAplanarEleccionPromo([cupoDeCafe(2)], [{ cupoId: "cupo-cafe", elegidos: [{ entradaId: "e-chico", cantidad: 1 }, { entradaId: "e-grande", cantidad: 1 }] }]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = prorratearPrecioPromo(5000, v.componentes.map((c) => ({ ...c, precioCarta: 3300 })));
    expect(r).toEqual({
      ok: true,
      filas: [
        { productoId: "cafe", claveComponente: "cafe#chico=1", cantidad: 1, precioUnitario: 2500 },
        { productoId: "cafe", claveComponente: "cafe#grande=1", cantidad: 1, precioUnitario: 2500 },
      ],
    });
  });
});
