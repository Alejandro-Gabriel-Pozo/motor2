import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { claveDeLote, evaluarAnulacion, type LineaComprada } from "../../src/core/compras/anulacion";

/**
 * GT-6, parte de la reversión de una COMPRA (S-02, O.51 de docs/pureza-integracion.md; plan de endurecimiento, tanda T1): después de `anularCompra`, el saldo
 * TOTAL de cada (producto, sección) que la compra tocó no puede quedar negativo. Propiedad (fast-check, 1000 corridas) sobre compras con y sin lote y saldos
 * por bucket arbitrarios —incluidos los negativos que deja una salida sin lote—: si `evaluarAnulacion` acepta, el total del par menos lo comprado de ese par
 * es ≥ 0 (con la tolerancia de milésimas de siempre) y cada bucket de la compra tampoco queda negativo. Mutación: volver a mirar solo el bucket → la
 * propiedad cae (una compra con lote y una salida sin lote la rompe).
 */
const LOTES = [null, new Date("2026-12-01T00:00:00.000Z"), new Date("2027-01-01T00:00:00.000Z")] as const;
const PRODUCTOS = ["harina", "queso"] as const;
const SECCIONES = ["deposito", "cocina"] as const;

const lineaArb: fc.Arbitrary<LineaComprada> = fc.record({
  productoId: fc.constantFrom(...PRODUCTOS),
  productoCodigo: fc.constant("COD"),
  productoNombre: fc.constant("Producto"),
  seccionId: fc.constantFrom(...SECCIONES),
  seccionNombre: fc.constant("Sección"),
  loteVencimiento: fc.constantFrom(...LOTES),
  cantidad: fc.integer({ min: 1, max: 12 }),
  precioTotal: fc.constant(100),
  precioPorUnidadStock: fc.constant(10),
  detalle: fc.constant("Compra"),
});

/** Un saldo por cada bucket posible (producto × sección × lote), entre −8 y 25: los negativos son lo que deja una salida sin lote. */
const saldosArb = fc
  .array(fc.integer({ min: -8, max: 25 }), { minLength: PRODUCTOS.length * SECCIONES.length * LOTES.length, maxLength: PRODUCTOS.length * SECCIONES.length * LOTES.length })
  .map((valores) => {
    const saldos = new Map<string, number>();
    let i = 0;
    for (const p of PRODUCTOS) for (const s of SECCIONES) for (const l of LOTES) saldos.set(claveDeLote(p, s, l), valores[i++]);
    return saldos;
  });

describe("evaluarAnulacion: si acepta, el saldo total de cada (producto, sección) queda ≥ 0", () => {
  it("con cualquier compra y cualquier saldo por bucket", () => {
    let aceptadas = 0;
    fc.assert(
      fc.property(fc.array(lineaArb, { minLength: 1, maxLength: 5 }), saldosArb, (lineas, saldos) => {
        const r = evaluarAnulacion({ proceso: "COMPRA", anuladaEn: null, lineas }, saldos);
        if (!r.ok) return;
        aceptadas++;
        const compradoPorPar = new Map<string, number>();
        const compradoPorBucket = new Map<string, number>();
        for (const l of lineas) {
          compradoPorPar.set(`${l.productoId}|${l.seccionId}`, (compradoPorPar.get(`${l.productoId}|${l.seccionId}`) ?? 0) + l.cantidad);
          const b = claveDeLote(l.productoId, l.seccionId, l.loteVencimiento);
          compradoPorBucket.set(b, (compradoPorBucket.get(b) ?? 0) + l.cantidad);
        }
        for (const [par, comprado] of compradoPorPar) {
          const [productoId, seccionId] = par.split("|");
          let total = 0;
          for (const l of LOTES) total += saldos.get(claveDeLote(productoId, seccionId, l)) ?? 0;
          expect(total - comprado).toBeGreaterThanOrEqual(-0.0005);
        }
        for (const [bucket, comprado] of compradoPorBucket) expect((saldos.get(bucket) ?? 0) - comprado).toBeGreaterThanOrEqual(-0.0005);
      }),
      { numRuns: 1000 },
    );
    // El generador produce compras aceptadas: si dejara de hacerlo, la propiedad pasaría sin probar nada.
    expect(aceptadas).toBeGreaterThan(20);
  });
});
