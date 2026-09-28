import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { armarFilasDeMovimiento, type ConsumoParaFilas, type LineaParaFilas } from "../../src/core/movimientos/armar-filas-de-movimiento";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";
import type { ProcesoGenerico } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Tests basados en propiedades (fast-check) de `armarFilasDeMovimiento` (backlog post-cierre de Task #41, 2026-09-28,
 * docs/pendientes-sesion-2026-09-27.md §6) — la función PURA extraída de `registrarMovimientoCasoDeUso` para armar las filas
 * `MovimientoStock` de un movimiento ya validado. Complementan los casos puntuales de `test/movimientos/registrar-movimiento.test.ts`
 * (que sí corren contra Postgres real, con permiso/guard/transacción de punta a punta) con invariantes que tienen que valer para
 * CUALQUIER combinación de líneas — mismo criterio que `test/core/moneda.propiedades.test.ts`.
 *
 * A propósito NO corre contra la ruta completa (`registrarMovimiento` con Postgres real, sin mocks): `fast-check` con ~1000 corridas
 * por propiedad multiplicaría por ~1000 el costo de esa integración — se corre exclusivamente sobre la función PURA, que no toca la
 * base ni ningún cliente de Prisma en runtime. El archivo entero corre en milisegundos.
 *
 * Invariantes confirmados por el usuario antes de escribir este archivo:
 *  1. Transferencia: la fila de salida y la de entrada llevan la MISMA magnitud, con signo opuesto.
 *  2. Consumos: la cantidad persistida nunca es positiva.
 *  3. Consignación: la fila financiera (LIQUIDACION_CONSIGNACION) siempre tiene cantidad física cero.
 *  4. La cantidad persistida de cada consumo respeta la precisión (decimales) de su unidad de stock.
 *  5. Misma entrada canónica (mismo contexto, mismas líneas) siempre arma las mismas filas.
 *  6. Ninguna fila "de más": cada línea de entrada produce exactamente su(s) fila(s) — una línea DESCARTADA nunca llega acá
 *     (`armarLineaMovimiento` ya la filtra antes de construir `lineas`), así que esta función no vuelve a decidir eso; lo que sí
 *     prueba, como equivalente al nivel de esta función pura, es que ninguna línea se pierde ni se duplica al armar las filas.
 */
const RUNS = { numRuns: 1000 };

const PROCESOS_GENERICOS_NO_TRANSFERENCIA: ProcesoGenerico[] = [
  "COMPRA", "PRODUCCION", "CONSUMO", "AJUSTE", "MERMA", "DEVOLUCION_CONSIGNACION", "DEVOLUCION_CLIENTE", "DEVOLUCION_PROVEEDOR",
];

const arbId = fc.string({ minLength: 1, maxLength: 12 });
const arbFecha = fc.option(fc.date(), { nil: null });
const arbMonto = fc.float({ min: 0, max: Math.fround(100_000), noNaN: true, noDefaultInfinity: true });
/** Cantidad de un consumo/línea: SIEMPRE >= 0 — mismo precondición real que `resolverConsumoPorFamilia`/`armarLineaMovimiento` (una
 * cantidad firmada negativa ya viene resuelta por `cantidadFirmada`, no por esto). */
const arbCantidadNoNegativa = fc.float({ min: 0, max: Math.fround(10_000), noNaN: true, noDefaultInfinity: true });
const arbCantidadFirmada = fc.float({ min: Math.fround(-10_000), max: Math.fround(10_000), noNaN: true, noDefaultInfinity: true });
const arbDecimales = fc.integer({ min: 0, max: 4 });
const arbProcesoNoTransferencia = fc.constantFrom(...PROCESOS_GENERICOS_NO_TRANSFERENCIA);
/**
 * Sin "CONSUMO": cuando `ctx.proceso` ES "CONSUMO" (un movimiento real de Consumo, ej. una merma manual), la fila BASE de cada línea
 * también lleva `proceso: "CONSUMO"` — el mismo literal que usan las filas generadas por `consumosReceta` (que solo existen en la
 * práctica bajo PRODUCCION, pero la función pura no lo impone). Filtrar por `proceso === "CONSUMO"` en el resultado sería ambiguo en
 * ese caso (mezclaría la fila base con las de receta) — se usa esta lista recortada en las propiedades que distinguen por ese campo,
 * no porque el comportamiento real de la función cambie.
 */
const arbProcesoSinAmbiguedadDeConsumo = fc.constantFrom(...PROCESOS_GENERICOS_NO_TRANSFERENCIA.filter((p) => p !== "CONSUMO"));

const arbConsumo: fc.Arbitrary<ConsumoParaFilas> = fc.record({
  productoId: arbId,
  cantidad: arbCantidadNoNegativa,
  loteVencimiento: arbFecha,
  decimalesUnidadStock: arbDecimales,
  esConsignacion: fc.boolean(),
  precioConsignacion: arbMonto,
});

const arbLinea: fc.Arbitrary<LineaParaFilas> = fc.record({
  productoId: arbId,
  cantidadFirmada: arbCantidadFirmada,
  cantidadIngresada: arbCantidadNoNegativa,
  loteVencimiento: arbFecha,
  detalle: fc.string(),
  precioTotal: arbMonto,
  precioPorUnidadStock: arbMonto,
  consumosReceta: fc.array(arbConsumo, { maxLength: 4 }),
});

describe("armarFilasDeMovimiento (propiedades)", () => {
  it("1) Transferencia: la fila de salida y la de entrada llevan la misma magnitud, con signo opuesto", () => {
    fc.assert(
      fc.property(fc.array(arbLinea, { minLength: 1, maxLength: 5 }), arbId, arbId, arbId, (lineas, operacionId, seccionId, seccionDestinoId) => {
        const filas = armarFilasDeMovimiento({ operacionId, proceso: "TRANSFERENCIA", seccionId, seccionDestinoId }, lineas);
        expect(filas.length).toBe(lineas.length * 2);
        for (let i = 0; i < lineas.length; i++) {
          const salida = filas[i * 2];
          const entrada = filas[i * 2 + 1];
          expect(Number(salida.cantidad)).toBe(-Number(entrada.cantidad));
          expect(Number(entrada.cantidad)).toBe(lineas[i].cantidadIngresada);
          expect(salida.seccionId).toBe(seccionId);
          expect(entrada.seccionId).toBe(seccionDestinoId);
        }
      }),
      RUNS
    );
  });

  it("2) Consumos: la cantidad persistida nunca es positiva", () => {
    fc.assert(
      fc.property(fc.array(arbLinea, { maxLength: 5 }), arbProcesoSinAmbiguedadDeConsumo, arbId, arbId, (lineas, proceso, operacionId, seccionId) => {
        const filas = armarFilasDeMovimiento({ operacionId, proceso, seccionId, seccionDestinoId: null }, lineas);
        for (const f of filas.filter((f) => f.proceso === "CONSUMO")) expect(Number(f.cantidad)).toBeLessThanOrEqual(0);
      }),
      RUNS
    );
  });

  it("3) Consignación: la fila LIQUIDACION_CONSIGNACION siempre tiene cantidad física 0", () => {
    fc.assert(
      fc.property(fc.array(arbLinea, { maxLength: 5 }), arbProcesoNoTransferencia, arbId, arbId, (lineas, proceso, operacionId, seccionId) => {
        const filas = armarFilasDeMovimiento({ operacionId, proceso, seccionId, seccionDestinoId: null }, lineas);
        for (const f of filas.filter((f) => f.proceso === "LIQUIDACION_CONSIGNACION")) expect(Number(f.cantidad)).toBe(0);
        // Una fila de LIQUIDACION_CONSIGNACION por cada consumo con esConsignacion — ni una de más, ni una de menos.
        const esperadas = lineas.flatMap((l) => l.consumosReceta).filter((c) => c.esConsignacion).length;
        expect(filas.filter((f) => f.proceso === "LIQUIDACION_CONSIGNACION").length).toBe(esperadas);
      }),
      RUNS
    );
  });

  it("4) la cantidad de cada consumo persiste redondeada a los decimales de su propia unidad de stock", () => {
    fc.assert(
      fc.property(fc.array(arbLinea, { maxLength: 5 }), arbProcesoSinAmbiguedadDeConsumo, arbId, arbId, (lineas, proceso, operacionId, seccionId) => {
        const filas = armarFilasDeMovimiento({ operacionId, proceso, seccionId, seccionDestinoId: null }, lineas);
        const reales = filas.filter((f) => f.proceso === "CONSUMO").map((f) => Number(f.cantidad));
        const esperadas = lineas.flatMap((l) => l.consumosReceta).map((c) => -redondearACantidadDeUnidad(c.cantidad, c.decimalesUnidadStock));
        expect(reales).toEqual(esperadas);
      }),
      RUNS
    );
  });

  it("5) misma entrada canónica (mismo contexto, mismas líneas) arma siempre las mismas filas", () => {
    fc.assert(
      fc.property(
        fc.array(arbLinea, { maxLength: 5 }),
        fc.constantFrom<ProcesoGenerico>(...PROCESOS_GENERICOS_NO_TRANSFERENCIA, "TRANSFERENCIA"),
        arbId,
        arbId,
        arbId,
        (lineas, proceso, operacionId, seccionId, seccionDestinoId) => {
          const ctx = { operacionId, proceso, seccionId, seccionDestinoId: proceso === "TRANSFERENCIA" ? seccionDestinoId : null };
          expect(armarFilasDeMovimiento(ctx, lineas)).toEqual(armarFilasDeMovimiento(ctx, lineas));
        }
      ),
      RUNS
    );
  });

  it("6) cada línea de entrada produce exactamente su(s) fila(s) base — ninguna se pierde ni se duplica", () => {
    expect(armarFilasDeMovimiento({ operacionId: "op", proceso: "COMPRA", seccionId: "s", seccionDestinoId: null }, [])).toEqual([]);

    fc.assert(
      fc.property(
        fc.array(arbLinea, { maxLength: 5 }),
        fc.constantFrom<ProcesoGenerico>(...PROCESOS_GENERICOS_NO_TRANSFERENCIA.filter((p) => p !== "CONSUMO"), "TRANSFERENCIA"),
        arbId,
        arbId,
        arbId,
        (lineas, proceso, operacionId, seccionId, seccionDestinoId) => {
          const ctx = { operacionId, proceso, seccionId, seccionDestinoId: proceso === "TRANSFERENCIA" ? seccionDestinoId : null };
          const filas = armarFilasDeMovimiento(ctx, lineas);
          const filasBase = proceso === "TRANSFERENCIA" ? filas.length / 2 : filas.filter((f) => f.proceso !== "CONSUMO" && f.proceso !== "LIQUIDACION_CONSIGNACION").length;
          expect(filasBase).toBe(lineas.length);
        }
      ),
      RUNS
    );
  });
});
