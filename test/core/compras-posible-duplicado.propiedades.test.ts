import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DIAS_DE_VENTANA_DE_DUPLICADO,
  avisoDePosibleDuplicado,
  posiblesDuplicados,
  type CompraCandidata,
  type CompraNueva,
} from "../../src/core/compras/public";
import { sumarDias } from "../../src/core/tiempo/zona-horaria";

/**
 * Tests basados en propiedades (fast-check) del aviso C25 de posible factura repetida (src/core/compras/posible-duplicado.ts). Funciones puras,
 * sin Postgres ni reloj: los días son textos «AAAA-MM-DD» fijos.
 */

const RUNS = { numRuns: 500 };

const DIA = "2026-03-15";
const PROVEEDOR = "prov-1";

const dia = fc.integer({ min: 0, max: 3000 }).map((n) => sumarDias("2020-01-01", n));
const importePositivo = fc.integer({ min: 1, max: 99_999_999_999_999 }).map((c) => c / 100); // hasta 999.999.999.999,99

function candidata(parcial: Partial<CompraCandidata> = {}): CompraCandidata {
  return { id: "c1", proveedorId: PROVEEDOR, sucursalId: "suc-2", sucursalNombre: "Centro", dia: DIA, importe: 1500, anulado: false, ...parcial };
}
const nuevo = (parcial: Partial<CompraNueva> = {}): CompraNueva => ({ proveedorId: PROVEEDOR, dia: DIA, importe: 1500, ...parcial });

const candidataArb = fc.record({
  id: fc.uuid(),
  proveedorId: fc.constantFrom(PROVEEDOR, "prov-2", null),
  sucursalId: fc.constantFrom("suc-1", "suc-2", "suc-3"),
  sucursalNombre: fc.constantFrom("Norte", "Centro", "Sur"),
  dia: fc.integer({ min: -12, max: 12 }).map((d) => sumarDias(DIA, d)),
  importe: fc.constantFrom(1500, 1500.01, 0, 20),
  anulado: fc.boolean(),
});

describe("posiblesDuplicados — ventana de días", () => {
  it("la ventana es de 7 días de cada lado, inclusiva: 7 avisa y 8 no", () => {
    expect(DIAS_DE_VENTANA_DE_DUPLICADO).toBe(7);
    expect(posiblesDuplicados(nuevo(), [candidata({ dia: sumarDias(DIA, -7) })])).toHaveLength(1);
    expect(posiblesDuplicados(nuevo(), [candidata({ dia: sumarDias(DIA, 7) })])).toHaveLength(1);
    expect(posiblesDuplicados(nuevo(), [candidata({ dia: sumarDias(DIA, -8) })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo(), [candidata({ dia: sumarDias(DIA, 8) })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo(), [candidata({ dia: DIA })])).toHaveLength(1);
  });

  it("cruza bien el fin de mes, de año y el 29 de febrero", () => {
    expect(posiblesDuplicados(nuevo({ dia: "2026-01-03" }), [candidata({ dia: "2025-12-27" })])).toHaveLength(1);
    expect(posiblesDuplicados(nuevo({ dia: "2026-01-03" }), [candidata({ dia: "2025-12-26" })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo({ dia: "2028-03-05" }), [candidata({ dia: "2028-02-27" })])).toHaveLength(1);
    expect(posiblesDuplicados(nuevo({ dia: "2028-03-05" }), [candidata({ dia: "2028-02-26" })])).toHaveLength(0);
  });

  it("es simétrica: A avisa a B si y solo si B avisaría a A", () => {
    fc.assert(
      fc.property(dia, dia, (a, b) => {
        const deAaB = posiblesDuplicados(nuevo({ dia: a }), [candidata({ dia: b })]).length === 1;
        const deBaA = posiblesDuplicados(nuevo({ dia: b }), [candidata({ dia: a })]).length === 1;
        expect(deAaB).toBe(deBaA);
      }),
      RUNS,
    );
  });

  it("avisa exactamente cuando la distancia en días es de 7 o menos", () => {
    fc.assert(
      fc.property(fc.integer({ min: -40, max: 40 }), (d) => {
        const hay = posiblesDuplicados(nuevo(), [candidata({ dia: sumarDias(DIA, d) })]).length === 1;
        expect(hay).toBe(Math.abs(d) <= 7);
      }),
      RUNS,
    );
  });
});

describe("posiblesDuplicados — qué cuenta", () => {
  it("el orden de los candidatos no cambia el resultado y sale por día descendente y después por id", () => {
    fc.assert(
      fc.property(fc.array(candidataArb, { maxLength: 12 }), fc.nat(), (lista, giro) => {
        const ids = new Set<string>();
        const unicos = lista.filter((c) => (ids.has(c.id) ? false : (ids.add(c.id), true)));
        const base = posiblesDuplicados(nuevo(), unicos);
        const rotada = unicos.length ? [...unicos.slice(giro % unicos.length), ...unicos.slice(0, giro % unicos.length)] : [];
        expect(posiblesDuplicados(nuevo(), rotada)).toEqual(base);
        expect(posiblesDuplicados(nuevo(), [...unicos].reverse())).toEqual(base);
        for (let i = 1; i < base.length; i++) {
          const [a, b] = [base[i - 1], base[i]];
          expect(a.dia > b.dia || (a.dia === b.dia && a.id < b.id)).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("nunca incluye una anulada, otro proveedor, otro importe ni la propia", () => {
    fc.assert(
      fc.property(fc.array(candidataArb, { maxLength: 12 }), (lista) => {
        for (const c of posiblesDuplicados(nuevo({ excluirId: lista[0]?.id }), lista)) {
          expect(c.anulado).toBe(false);
          expect(c.proveedorId).toBe(PROVEEDOR);
          expect(c.importe).toBe(1500);
          expect(c.id).not.toBe(lista[0]?.id);
        }
      }),
      RUNS,
    );
  });

  it("una anulada no cuenta; la misma vigente sí", () => {
    expect(posiblesDuplicados(nuevo(), [candidata({ anulado: true })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo(), [candidata({ anulado: false })])).toHaveLength(1);
  });

  it("otro proveedor no cuenta", () => {
    expect(posiblesDuplicados(nuevo(), [candidata({ proveedorId: "prov-2" })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo(), [candidata({ proveedorId: null })])).toHaveLength(0);
  });

  it("la propia compra (excluirId) no cuenta", () => {
    expect(posiblesDuplicados(nuevo({ excluirId: "c1" }), [candidata({ id: "c1" })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo({ excluirId: "c9" }), [candidata({ id: "c1" })])).toHaveLength(1);
  });

  it("un importe distinto no cuenta, ni siquiera por un centavo", () => {
    fc.assert(
      fc.property(importePositivo, fc.constantFrom(-0.01, 0.01), (importe, delta) => {
        const otro = Math.round((importe + delta) * 100) / 100;
        fc.pre(otro > 0 && otro !== importe);
        expect(posiblesDuplicados(nuevo({ importe }), [candidata({ importe: otro })])).toHaveLength(0);
        expect(posiblesDuplicados(nuevo({ importe }), [candidata({ importe })])).toHaveLength(1);
      }),
      RUNS,
    );
  });

  it("el importe se compara en centavos exactos: 0,1 + 0,2 es 0,3", () => {
    expect(posiblesDuplicados(nuevo({ importe: 0.1 + 0.2 }), [candidata({ importe: 0.3 })])).toHaveLength(1);
    expect(posiblesDuplicados(nuevo({ importe: 0.3 }), [candidata({ importe: 0.1 + 0.2 })])).toHaveLength(1);
  });

  it("un importe de 0 (o negativo) nunca avisa, ni contra otra compra de 0", () => {
    expect(posiblesDuplicados(nuevo({ importe: 0 }), [candidata({ importe: 0 })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo({ importe: -5 }), [candidata({ importe: -5 })])).toHaveLength(0);
    expect(posiblesDuplicados(nuevo({ importe: Number.NaN }), [candidata({ importe: Number.NaN })])).toHaveLength(0);
    expect(avisoDePosibleDuplicado(posiblesDuplicados(nuevo({ importe: 0 }), [candidata({ importe: 0 })]), "suc-1")).toBe("");
  });

  it("los importes grandes (hasta 999.999.999.999,99) se comparan sin perder centavos", () => {
    fc.assert(
      fc.property(importePositivo, (importe) => {
        expect(posiblesDuplicados(nuevo({ importe }), [candidata({ importe })])).toHaveLength(1);
      }),
      RUNS,
    );
    expect(posiblesDuplicados(nuevo({ importe: 999_999_999_999.99 }), [candidata({ importe: 999_999_999_999.98 })])).toHaveLength(0);
  });
});

describe("avisoDePosibleDuplicado — texto", () => {
  it("sin compras encontradas no hay aviso", () => {
    expect(avisoDePosibleDuplicado([], "suc-1")).toBe("");
  });

  it("nombra la otra sucursal y la fecha, y no repite el importe", () => {
    const texto = avisoDePosibleDuplicado([candidata()], "suc-1");
    expect(texto).toContain("en la sucursal Centro");
    expect(texto).toContain("15/03/2026");
    expect(texto).toContain("en la sucursal Centro el 15/03/2026. Revisá que no la estés cargando dos veces.");
    expect(texto).not.toContain("1500");
    expect(texto).not.toContain("1.500");
  });

  it("si es la misma sucursal dice «en esta sucursal»", () => {
    const texto = avisoDePosibleDuplicado([candidata({ sucursalId: "suc-1" })], "suc-1");
    expect(texto).toContain("en esta sucursal");
    expect(texto).not.toContain("Centro");
  });

  it("nunca nombra el N.º de factura (dato de piso administrador): ni aunque la candidata lo traiga de más", () => {
    const conNumero = { ...candidata(), numero: "1-1234" } as CompraCandidata;
    const texto = avisoDePosibleDuplicado([conNumero], "suc-1");
    expect(texto).not.toContain("1234");
    expect(texto).not.toContain("00001-");
    expect(texto).not.toContain("N.º");
  });

  it("muestra hasta 3 y después «y N más»", () => {
    const cinco = [1, 2, 3, 4, 5].map((n) => candidata({ id: `c${n}`, sucursalNombre: `Suc ${n}` }));
    const texto = avisoDePosibleDuplicado(cinco, "suc-1");
    expect(texto).toContain("Suc 1");
    expect(texto).toContain("Suc 3");
    expect(texto).not.toContain("Suc 4");
    expect(texto).toContain("y 2 más");
    expect(avisoDePosibleDuplicado(cinco.slice(0, 3), "suc-1")).not.toContain("más");
    expect(avisoDePosibleDuplicado(cinco.slice(0, 4), "suc-1")).toContain("y 1 más");
  });

  it("de punta a punta: la compra de otra sucursal a 3 días avisa y la de 8 días no", () => {
    const lista = [candidata({ id: "a", dia: sumarDias(DIA, -3) }), candidata({ id: "b", dia: sumarDias(DIA, -8) })];
    const texto = avisoDePosibleDuplicado(posiblesDuplicados(nuevo(), lista), "suc-1");
    expect(texto).toContain("12/03/2026");
    expect(texto).not.toContain("07/03/2026");
  });
});
