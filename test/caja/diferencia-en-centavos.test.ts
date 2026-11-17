import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { conciliarJornada, diferenciaDeArqueo, lineaPorExplicar, totalContadoEnCentavos } from "@/core/caja/public";
import { correccionesEsperadas, declaradoVigenteEsperado, diferenciaEsperada, registradoEsperado } from "./oraculo-de-diferencia";

/**
 * La diferencia de la conciliación (declarado − (registrado + correcciones), por medio) y la del arqueo (contado − esperado) son EXACTAS AL CENTAVO: nunca se redondean al peso. Antes los importes de las pruebas eran todos múltiplos de $1 y un
 * redondeo al peso pasaba sin que nada se pusiera rojo. Acá son PROPIEDADES con 5000 casos aleatorios de importes en centavos cualesquiera contra el oráculo escrito aparte (`oraculo-de-diferencia.ts`), sin base de datos.
 * La contraparte en la base (la columna generada `diferencia` con centavos) está en `reglas-de-la-base-de-cierre.test.ts`.
 * MUTACIONES que deben dejar esto en ROJO (confirmadas con el verificador, ver el informe del PR): (1) en `conciliarJornada` (src/core/caja/conciliacion.ts) reemplazar la resta por `((declarado − (reg + cor)) / BigInt(100)) * BigInt(100)`
 * (redondea al peso hacia cero); (2) igual en `diferenciaDeArqueo` (src/core/caja/arqueo.ts); (3) en `totalContadoEnCentavos` descartar las monedas con `monedasEnCentavos / BigInt(100) * BigInt(100)`.
 */
const CORRIDAS = 5000;
const EF = "ef";
const MEDIOS = [EF, "tarjeta", "qr"] as const;
// Centavos cualesquiera (casi nunca múltiplos de 100), dentro de lo que entra en una columna Decimal(14,2).
const centavos = (min: number, max: number) => fc.integer({ min, max }).map((n) => BigInt(n));
const CIEN = BigInt(100);

const entrada = fc.record({
  movimientos: fc.array(fc.record({ medioDePagoId: fc.constantFrom(...MEDIOS), importeEnCentavos: centavos(-900_000_000, 900_000_000) }), { maxLength: 12 }),
  correcciones: fc.array(
    fc.record({ importeEnCentavos: centavos(1, 900_000_000), par: fc.constantFrom(["tarjeta", "qr"], ["qr", "tarjeta"], [EF, "tarjeta"], ["tarjeta", EF], ["qr", EF], [EF, "qr"]) }).map((k) => ({ importeEnCentavos: k.importeEnCentavos, medioAntesId: k.par[0]!, medioDespuesId: k.par[1]! })),
    { maxLength: 6 },
  ),
  declaraciones: fc.array(fc.record({ medioDePagoId: fc.constantFrom("tarjeta", "qr"), secuencia: fc.integer({ min: 1, max: 4 }), importeEnCentavos: centavos(0, 900_000_000) }), { maxLength: 6 })
    // Una secuencia por medio no se repite (la base la exige sin huecos).
    .map((ds) => ds.filter((d, i) => ds.findIndex((o) => o.medioDePagoId === d.medioDePagoId && o.secuencia === d.secuencia) === i)),
  cierresDelEfectivo: fc.array(centavos(0, 900_000_000), { maxLength: 3 }),
});

describe("diferencia de la conciliación: exacta al centavo (propiedad, 5000 casos)", () => {
  it("diferencia = declarado − (registrado + correcciones) en cada medio con total, contra el oráculo", () => {
    let conCentavos = 0;
    fc.assert(
      fc.property(entrada, (e) => {
        const lineas = conciliarJornada({
          efectivoId: EF,
          movimientos: e.movimientos,
          correcciones: e.correcciones,
          declaraciones: e.declaraciones,
          conformeGeneral: null,
          cierres: e.cierresDelEfectivo.map((contadoEnCentavos) => ({ medioDePagoId: EF, conforme: false as const, contadoEnCentavos })),
        });
        for (const l of lineas) {
          const registrado = registradoEsperado(l.medioDePagoId, e.movimientos);
          const correcciones = correccionesEsperadas(l.medioDePagoId, e.correcciones);
          expect(l.registradoEnCentavos).toBe(registrado);
          expect(l.correccionesEnCentavos).toBe(correcciones);
          const declarado = l.medioDePagoId === EF ? e.cierresDelEfectivo.reduce((s, x) => s + x, BigInt(0)) : declaradoVigenteEsperado(l.medioDePagoId, e.declaraciones);
          if (declarado === null) {
            // Sin declaración ni conforme ni cierres de caja de ese medio: no hay total, no hay diferencia.
            expect(l.diferenciaEnCentavos).toBeNull();
            expect(l.estado).toBe("SIN_DATO");
          } else {
            const esperada = diferenciaEsperada(declarado, registrado, correcciones);
            expect(l.declaradoEnCentavos).toBe(declarado);
            expect(l.diferenciaEnCentavos).toBe(esperada);
            // La identidad al centavo, sin resto de redondeo.
            expect((l.diferenciaEnCentavos as bigint) + registrado + correcciones).toBe(declarado);
            if (esperada % CIEN !== BigInt(0)) conCentavos += 1;
            // ¿Hay que explicarla? Un centavo de diferencia ya cuenta; solo el cero exacto no.
            expect(lineaPorExplicar(l)).toBe(esperada !== BigInt(0));
          }
        }
      }),
      { numRuns: CORRIDAS },
    );
    // Guarda contra una prueba vacía: el generador sí produjo diferencias que no son múltiplos de $1 (si fuera 0, la prueba no podría detectar un redondeo al peso).
    expect(conCentavos).toBeGreaterThan(CORRIDAS / 10);
  });

  it("una diferencia de UN centavo (declarado de más o de menos) se ve y hay que explicarla", () => {
    for (const declaradoEnCentavos of [BigInt(100_01), BigInt(99_99)]) {
      const [l] = conciliarJornada({
        efectivoId: EF,
        movimientos: [{ medioDePagoId: "tarjeta", importeEnCentavos: BigInt(100_00) }],
        correcciones: [],
        declaraciones: [{ medioDePagoId: "tarjeta", secuencia: 1, importeEnCentavos: declaradoEnCentavos }],
        conformeGeneral: null,
        cierres: [],
      });
      expect(l!.diferenciaEnCentavos).toBe(declaradoEnCentavos - BigInt(100_00));
      expect(lineaPorExplicar(l!)).toBe(true);
    }
  });
});

describe("diferencia del arqueo y total contado: exactos al centavo (propiedad, 5000 casos)", () => {
  it("diferenciaDeArqueo = contado − esperado", () => {
    fc.assert(
      fc.property(centavos(0, 900_000_000), centavos(-900_000_000, 900_000_000), (contado, esperado) => {
        const d = diferenciaDeArqueo(contado, esperado);
        expect(d).toBe(contado - esperado);
        expect(d + esperado).toBe(contado);
      }),
      { numRuns: CORRIDAS },
    );
  });

  it("el total contado = Σ billetes × denominación × 100 + monedas, en centavos exactos", () => {
    const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10] as const;
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 10, maxLength: 10 }), centavos(0, 99_999), (cantidades, monedas) => {
        const billetes = Object.fromEntries(DENOMINACIONES.map((d, i) => [d, cantidades[i]!]));
        // Oráculo con `number` entero (todo cabe en 2^53): otra forma que la del código, que suma en `bigint`.
        const esperado = DENOMINACIONES.reduce((s, d, i) => s + d * cantidades[i]! * 100, 0) + Number(monedas);
        const r = totalContadoEnCentavos({ billetes: billetes as never, monedasEnCentavos: monedas });
        expect(r).toEqual({ ok: true, centavos: BigInt(esperado) });
      }),
      { numRuns: CORRIDAS },
    );
  });
});
