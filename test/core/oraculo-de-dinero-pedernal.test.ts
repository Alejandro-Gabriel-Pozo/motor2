import { describe, expect, it } from "vitest";
import { precioCobradoConDescuentos } from "../../src/core/carta/public";
import { validarImporte } from "../../src/core/datos/importe";
import { importeDeLinea, redondearMoneda, repartirImporte, totalDeLineas } from "../../src/core/moneda";

/**
 * Oráculo de dinero de Motor2 contra los ejemplos de Pedernal (paso 12 de la auditoría 2026-11-12; pedido del dueño: «qué reglas tiene Pedernal que nosotros tenemos y dan un resultado diferente»).
 *
 * Los números de Pedernal salen de su código real (`ERP/src/modulos/fiscal/dominio/calculo-de-renglones.test.ts:121` y `ERP/src/primitivas/dinero/prorrateo.test.ts:24`, ejecutados el 2026-11-12,
 * anexo G de la auditoría), no de sus documentos. Acá se ejecuta el núcleo de Motor2 con la MISMA entrada y se escribe lo que da HOY.
 *
 * DIFERENCIA ABIERTA (decisión del dueño, no se cambia acá): el descuento. Pedernal calcula el descuento sobre el total y redondea UNA vez (80,595 → 80,60) y reparte el resultado entre los renglones por
 * mayor resto. Motor2 aplica el descuento al PRECIO UNITARIO de cada línea y lo redondea (9,95 × 0,90 = 8,955 → 8,96), y después multiplica por la cantidad: 3 × 8,96 = 26,88 por línea, 80,64 en total.
 * Son 4 centavos de diferencia en un ticket de $89,55. Si el dueño decide igualar a Pedernal, este test es el que tiene que cambiar, a propósito.
 */
const PRECIO = 9.95;
const CANTIDAD = 3;
const DESCUENTO = 10;
const RENGLONES = 3;
/** Lo que da Pedernal (código real) con esa entrada: total 80,60 repartido 26,87 / 26,87 / 26,86. */
const PEDERNAL = { total: 80.6, renglones: [26.87, 26.87, 26.86] } as const;

describe("descuento de cliente: 3 renglones de 3 × $9,95 con 10 %", () => {
  it("Motor2 hoy: el precio con descuento se redondea por unidad (8,96) y cada línea da 26,88, total 80,64", () => {
    const precioCobrado = precioCobradoConDescuentos(PRECIO, null, DESCUENTO).precio;
    expect(precioCobrado).toBe(8.96);
    const lineas = Array.from({ length: RENGLONES }, () => importeDeLinea(CANTIDAD, precioCobrado));
    expect(lineas).toEqual([26.88, 26.88, 26.88]);
    expect(redondearMoneda(lineas.reduce((suma, l) => suma + l, 0))).toBe(80.64);
  });

  it("la diferencia con Pedernal es de 4 centavos y queda escrita: si cambia el redondeo de Motor2, este test avisa", () => {
    const motor2 = Array.from({ length: RENGLONES }, () => importeDeLinea(CANTIDAD, precioCobradoConDescuentos(PRECIO, null, DESCUENTO).precio)).reduce((s, l) => s + l, 0);
    expect(redondearMoneda(motor2 - PEDERNAL.total)).toBe(0.04);
  });

  it("con UN solo renglón de cantidad 1 los dos sistemas coinciden: 8,955 sube a 8,96 (la mitad se aleja del cero)", () => {
    expect(precioCobradoConDescuentos(PRECIO, null, DESCUENTO).precio).toBe(8.96);
  });
});

describe("reparto de un importe entre renglones: el mismo método que Pedernal (mayor resto)", () => {
  it("80,60 entre tres renglones iguales da 26,87 / 26,87 / 26,86 (igual que Pedernal)", () => {
    const partes = repartirImporte(80.6, [29.85, 29.85, 29.85]);
    expect(partes).toEqual([...PEDERNAL.renglones]);
    expect(redondearMoneda(partes.reduce((s, p) => s + p, 0))).toBe(PEDERNAL.total);
  });

  it("la suma de las partes da siempre el importe, al centavo, para muchos importes y pesos", () => {
    for (let centavos = 1; centavos <= 400; centavos += 7) {
      const importe = centavos / 100;
      for (const pesos of [[1, 1, 1], [1, 2, 3], [29.85, 29.85, 29.85], [0.01, 99.99], [5, 5, 5, 5, 5, 5, 5]]) {
        const partes = repartirImporte(importe, pesos);
        expect(redondearMoneda(partes.reduce((s, p) => s + p, 0)), `importe ${importe} pesos ${pesos.join(",")}`).toBe(importe);
      }
    }
  });
});

describe("redondeo único sobre el total: Motor2 suma exacto y redondea una sola vez (igual que Pedernal)", () => {
  it("el total de 3 líneas de 3 × 9,95 sin descuento es 89,55", () => {
    expect(totalDeLineas(Array.from({ length: RENGLONES }, () => ({ cantidad: CANTIDAD, precioUnitario: PRECIO })))).toBe(89.55);
  });
});

describe("topes y decimales del importe: Motor2 hoy", () => {
  it("acepta 1.000.000.000,00 (Pedernal lo rechaza en caja: su tope es 999.999.999,99)", () => {
    expect(validarImporte(1_000_000_000, { etiqueta: "El importe" })).toEqual({ ok: true, valor: 1_000_000_000 });
  });

  it("rechaza 10,005 (tres decimales): no lo redondea", () => {
    const r = validarImporte("10,005", { etiqueta: "El importe" });
    expect(r.ok).toBe(false);
  });
});
