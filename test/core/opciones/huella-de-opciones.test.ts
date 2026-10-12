import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { componerPrecioDeLinea } from "../../../src/core/opciones/componer-precio-de-linea";
import { huellaDeOpciones, type OpcionParaHuella } from "../../../src/core/opciones/huella-de-opciones";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, paraPrecio, permitidosDe } from "./escenarios";

/**
 * GO-0b: la huella (SHA-256 hex, 64 caracteres) de las opciones DENTRO del precio. Sin opciones es `null`. Determinista, independiente del orden de entrada, y sensible a
 * cualquier cambio de opción, versión, cantidad, importe o factor.
 */

const mediano: OpcionParaHuella = { opcionId: "o-mediano", versionDeOpcionId: "v-mediano-1", cantidad: 1, importeUnitario: 3400, factorEscala: 1.5 };
const conLeche: OpcionParaHuella = { opcionId: "o-con-leche", versionDeOpcionId: "v-con-leche-1", cantidad: 1, importeUnitario: 300, factorEscala: null };
const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

describe("huellaDeOpciones", () => {
  it("sin opciones es null: lo de hoy, sin huella", () => {
    expect(huellaDeOpciones([])).toBeNull();
  });

  it("es el SHA-256 del canónico ordenado por opción, con decimales fijos (valor fijado: si cambia el formato, esto avisa)", () => {
    const canonico =
      '[{"opcionId":"o-con-leche","versionDeOpcionId":"v-con-leche-1","cantidad":1,"importeUnitario":"300.00","factorEscala":null},' +
      '{"opcionId":"o-mediano","versionDeOpcionId":"v-mediano-1","cantidad":1,"importeUnitario":"3400.00","factorEscala":"1.5000"}]';
    expect(huellaDeOpciones([mediano, conLeche])).toBe(sha256(canonico));
    expect(huellaDeOpciones([mediano, conLeche])).toBe("3e6014bb20ffbc94c01c947059304d839c916c7b5ac2140073e22bb0e823dc8f");
  });

  it("son 64 caracteres hexadecimales en minúscula (el CHECK de CuentaItem.huellaOpciones)", () => {
    expect(huellaDeOpciones([mediano])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no depende del orden de entrada", () => {
    expect(huellaDeOpciones([conLeche, mediano])).toBe(huellaDeOpciones([mediano, conLeche]));
  });

  it("café mediano con leche y café mediano cortado no comparten huella (es lo que evita juntarlos en una sola operación)", () => {
    const huellaDe = (ids: string[]) => {
      const validadas = validarOpcionesElegidas(permitidosDe(CAFE), ids.map((opcionId) => ({ opcionId, cantidad: 1 })));
      if (!validadas.ok) throw new Error(validadas.mensaje);
      const precio = componerPrecioDeLinea({ precioBase: CAFE.precioBase, cantidad: 1, opciones: paraPrecio(CAFE, validadas.opciones) });
      if (!precio.ok) throw new Error(precio.mensaje);
      return huellaDeOpciones(precio.precio.dentroDelPrecio);
    };
    const conLecheMediano = huellaDe(["o-mediano", "o-con-leche"]);
    const cortadoMediano = huellaDe(["o-mediano", "o-cortado"]);
    expect(conLecheMediano).not.toBe(cortadoMediano);
    expect(huellaDe(["o-con-leche", "o-mediano"])).toBe(conLecheMediano);
    expect(huellaDe(["o-mediano"])).not.toBe(conLecheMediano);
  });

  it("cada campo cuenta: cambiar la opción, la versión, la cantidad, el importe o el factor cambia la huella", () => {
    const base = huellaDeOpciones([mediano]);
    const cambios: Array<Partial<OpcionParaHuella>> = [
      { opcionId: "o-grande" },
      { versionDeOpcionId: "v-mediano-2" },
      { cantidad: 2 },
      { importeUnitario: 3400.01 },
      { factorEscala: 2 },
      { factorEscala: null },
    ];
    for (const cambio of cambios) expect(huellaDeOpciones([{ ...mediano, ...cambio }]), JSON.stringify(cambio)).not.toBe(base);
  });

  it("los números se normalizan: 3400 y 3400.00 son lo mismo, 1.5 y 1.50 también; el -0 no se distingue del 0", () => {
    expect(huellaDeOpciones([{ ...mediano, importeUnitario: 3400.0, factorEscala: 1.5 }])).toBe(huellaDeOpciones([mediano]));
    expect(huellaDeOpciones([{ ...conLeche, importeUnitario: -0 }])).toBe(huellaDeOpciones([{ ...conLeche, importeUnitario: 0 }]));
  });

  it("un número que no es finito es un error de quien llama, no una huella", () => {
    expect(() => huellaDeOpciones([{ ...mediano, importeUnitario: Number.NaN }])).toThrow(RangeError);
    expect(() => huellaDeOpciones([{ ...mediano, cantidad: Number.POSITIVE_INFINITY }])).toThrow(RangeError);
    expect(() => huellaDeOpciones([{ ...mediano, factorEscala: Number.NaN }])).toThrow(RangeError);
    expect(() => huellaDeOpciones([mediano, { ...conLeche, importeUnitario: Number.NEGATIVE_INFINITY }])).toThrow("o-con-leche");
  });

  it("dos filas de la misma opción se ordenan por versión y por cantidad: sigue sin depender del orden", () => {
    const a = { ...mediano, versionDeOpcionId: "v-1", cantidad: 2 };
    const b = { ...mediano, versionDeOpcionId: "v-1", cantidad: 1 };
    const c = { ...mediano, versionDeOpcionId: "v-0", cantidad: 3 };
    const h = huellaDeOpciones([a, b, c]);
    expect(huellaDeOpciones([c, b, a])).toBe(h);
    expect(huellaDeOpciones([b, a, c])).toBe(h);
  });
});

describe("huellaDeOpciones (propiedades)", () => {
  const opcionArb: fc.Arbitrary<OpcionParaHuella> = fc.record({
    opcionId: fc.stringMatching(/^o-[a-z0-9]{1,6}$/),
    versionDeOpcionId: fc.stringMatching(/^v-[a-z0-9]{1,6}$/),
    cantidad: fc.integer({ min: 1, max: 10 }),
    importeUnitario: fc.integer({ min: -100_000, max: 100_000_000 }).map((c) => c / 100),
    factorEscala: fc.option(fc.integer({ min: 1, max: 100_000 }).map((m) => m / 10_000), { nil: null }),
  });
  const listaArb = fc.uniqueArray(opcionArb, { minLength: 1, maxLength: 6, selector: (o) => o.opcionId });

  it("no depende del orden de entrada, es de 64 caracteres hexadecimales y es determinista", () => {
    const conBarajada = listaArb.chain((lista) => fc.tuple(fc.constant(lista), fc.shuffledSubarray(lista, { minLength: lista.length, maxLength: lista.length })));
    fc.assert(
      fc.property(conBarajada, ([lista, barajada]) => {
        const h = huellaDeOpciones(lista);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(huellaDeOpciones(barajada)).toBe(h);
        expect(huellaDeOpciones(lista)).toBe(h);
      }),
      { numRuns: 500 }
    );
  });

  it("dos configuraciones distintas no comparten huella", () => {
    fc.assert(
      fc.property(listaArb, listaArb, (a, b) => {
        const mismaConfiguracion = JSON.stringify([...a].sort((x, y) => (x.opcionId < y.opcionId ? -1 : 1))) === JSON.stringify([...b].sort((x, y) => (x.opcionId < y.opcionId ? -1 : 1)));
        if (!mismaConfiguracion) expect(huellaDeOpciones(a)).not.toBe(huellaDeOpciones(b));
      }),
      { numRuns: 500 }
    );
  });
});
