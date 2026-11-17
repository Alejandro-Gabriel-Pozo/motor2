import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CUENTAS_ADMITIDAS, TIPOS_DE_CUENTA, TIPOS_DE_MEDIO, cuentaDelRenglon, cuentaPorDefectoDelRenglon } from "../../src/core/caja/public";

/**
 * Núcleo puro de la cuenta por defecto del cobro (etapa P-C3), con propiedades (`fast-check`): la función recibe SOLO las cuentas activas de la sucursal de la caja (quien las carga, `cargarCuentasActivasDeLaSucursal`,
 * filtra «activa» y «sucursal» con la base; que una cuenta inactiva o de otra sucursal no llega acá y no cuenta lo prueba el oráculo contra Postgres real, `cuenta-por-defecto-oraculo.test.ts`). Lo que se prueba acá es lo
 * que la función decide con lo que recibe: nunca inventa una cuenta, nunca elige una incompatible con el medio, con una explícita no la cambia, el efectivo nunca lleva cuenta y 0 / 1 / 2 o más compatibles dan nada / esa / «a elegir».
 */
const tipoDeMedio = fc.constantFrom(...TIPOS_DE_MEDIO);
const cuentas = fc.uniqueArray(fc.record({ id: fc.uuid(), tipo: fc.constantFrom(...TIPOS_DE_CUENTA) }), { selector: (x) => x.id, maxLength: 8 });

describe("cuentaPorDefectoDelRenglon: propiedades", () => {
  it("si devuelve una cuenta, es una de las recibidas y de un tipo que el medio admite; nunca una incompatible", () => {
    fc.assert(
      fc.property(tipoDeMedio, cuentas, (tipo, activas) => {
        const r = cuentaPorDefectoDelRenglon(tipo, activas);
        if (r.ok && r.valor !== null) {
          const elegida = activas.find((a) => a.id === r.valor);
          expect(elegida).toBeDefined();
          expect(CUENTAS_ADMITIDAS[tipo]).toContain(elegida?.tipo);
        }
      }),
    );
  });

  it("0 compatibles → ninguna (la venta nunca se frena); 1 → esa; 2 o más → a elegir; el efectivo, siempre ninguna", () => {
    fc.assert(
      fc.property(tipoDeMedio, cuentas, (tipo, activas) => {
        const compatibles = activas.filter((a) => CUENTAS_ADMITIDAS[tipo].includes(a.tipo));
        const r = cuentaPorDefectoDelRenglon(tipo, activas);
        if (compatibles.length === 0) expect(r).toEqual({ ok: true, valor: null });
        else if (compatibles.length === 1) expect(r).toEqual({ ok: true, valor: compatibles[0]?.id });
        else expect(r).toEqual({ ok: false, error: "CUENTA_DE_COBRO_A_ELEGIR" });
        if (tipo === "EFECTIVO") expect(r).toEqual({ ok: true, valor: null });
      }),
    );
  });

  it("es pura: no depende del orden de las cuentas y no las modifica", () => {
    fc.assert(
      fc.property(tipoDeMedio, cuentas, (tipo, activas) => {
        const copia = JSON.stringify(activas);
        const a = cuentaPorDefectoDelRenglon(tipo, activas);
        expect(JSON.stringify(activas)).toBe(copia);
        expect(cuentaPorDefectoDelRenglon(tipo, [...activas].reverse())).toEqual(a);
      }),
    );
  });
});

describe("cuentaDelRenglon: la que el renglón trae no se cambia", () => {
  it("con cuenta explícita devuelve esa, sea cual sea el medio y las cuentas activas", () => {
    fc.assert(fc.property(tipoDeMedio, cuentas, fc.uuid(), (tipo, activas, explicita) => {
      expect(cuentaDelRenglon(explicita, tipo, activas)).toEqual({ ok: true, valor: explicita });
    }));
  });
  it("sin cuenta explícita es la de cuentaPorDefectoDelRenglon", () => {
    fc.assert(fc.property(tipoDeMedio, cuentas, (tipo, activas) => {
      expect(cuentaDelRenglon(null, tipo, activas)).toEqual(cuentaPorDefectoDelRenglon(tipo, activas));
    }));
  });
});
