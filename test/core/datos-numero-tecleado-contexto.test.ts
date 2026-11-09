import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CONTEXTO_IMPORTE, contextoDeCantidad, interpretarNumeroTecleado } from "@/core/datos/numero-tecleado";

// Sin base de datos. El parser de lo que la persona escribe o pega (regla de números del dueño, 2026-11-09). La tabla completa por contexto, tecleado/pegado y cliente/servidor es el oráculo (`campo-numerico-entrada.oraculo.test.ts`).

describe("interpretarNumeroTecleado — mensajes y propiedades de la regla de números (el detalle por contexto está en el oráculo)", () => {
  it("el «.» dice cómo escribir un decimal; los decimales de más dicen el máximo y, con «21,000», cómo escribir veintiún mil; una unidad entera pide un entero", () => {
    expect(interpretarNumeroTecleado("2.5", CONTEXTO_IMPORTE)).toEqual({ ok: false, codigo: "punto", mensaje: "Los decimales van con coma: 0,5" });
    expect(interpretarNumeroTecleado("21,000", CONTEXTO_IMPORTE)).toEqual({ ok: false, codigo: "decimales", mensaje: "Admite como máximo 2 decimales. Para 21000 escribí 21000." });
    expect(interpretarNumeroTecleado("1,5555", CONTEXTO_IMPORTE)).toEqual({ ok: false, codigo: "decimales", mensaje: "Admite como máximo 2 decimales." });
    expect(interpretarNumeroTecleado("1,5", contextoDeCantidad(0))).toEqual({ ok: false, codigo: "decimales", mensaje: "Tiene que ser un número entero." });
  });

  it("propiedad: sin «.» y con a lo sumo los decimales del contexto, se lee exacto; con un «.» en cualquier lugar, siempre es el aviso del punto", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999_999 }), fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 9999 }), (entero, decimales, resto) => {
        const dec = decimales === 0 ? "" : String(resto % 10 ** decimales).padStart(decimales, "0");
        const texto = dec ? `${entero},${dec}` : String(entero);
        const r = interpretarNumeroTecleado(texto, contextoDeCantidad(4));
        expect(r).toEqual({ ok: true, valor: Number(dec ? `${entero}.${dec}` : entero) });
        const conPunto = interpretarNumeroTecleado(`${entero}.${dec || "5"}`, contextoDeCantidad(4));
        expect(conPunto).toMatchObject({ ok: false, codigo: "punto" });
      })
    );
  });
});
