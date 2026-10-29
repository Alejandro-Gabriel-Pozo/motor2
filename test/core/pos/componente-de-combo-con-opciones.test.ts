import { describe, expect, it } from "vitest";
import { rechazoDeComponenteDeCombo, type ProductoComoComponente } from "../../../src/core/pos/componente-de-combo";

/**
 * Ventas con opciones, paso 3 (diseño 2026-10-29): una entrada de combo con CONFIGURACIÓN FIJA sobre una base sin receta es un componente válido si las opciones descuentan algún insumo
 * (`opciones.insumos > 0`); si no, se rechaza con `COMPONENTE_SIN_RECETA` y el mensaje nombra la opción. Sin `opciones` (un producto suelto) todo queda como antes.
 */
const base: ProductoComoComponente = { nombre: "Gaseosa", tipo: "PV", esAnclaDeAdicional: false, precioDeReferencia: 2500, seProduce: false, ingredientesDeLaRecetaVigente: 0 };

describe("rechazoDeComponenteDeCombo con opciones elegidas", () => {
  it("base sin receta: sin opciones se rechaza como siempre; con opciones que suman un insumo se acepta; con opciones que no descuentan, se rechaza nombrándolas", () => {
    expect(rechazoDeComponenteDeCombo(base)).toEqual({ codigo: "COMPONENTE_SIN_RECETA", mensaje: "«Gaseosa» no tiene receta: armala en Catálogo → Recetas para poder sumarlo al menú o al combo." });
    expect(rechazoDeComponenteDeCombo({ ...base, opcionesQueDescuentan: { insumos: 1, nombres: ["Coca"] } })).toBeNull();
    const fanta = rechazoDeComponenteDeCombo({ ...base, opcionesQueDescuentan: { insumos: 0, nombres: ["Fanta"] } });
    expect(fanta?.codigo).toBe("COMPONENTE_SIN_RECETA");
    expect(fanta?.mensaje).toBe("“Gaseosa” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa” en Catálogo → Recetas.");
  });

  it("con receta vigente o stock propio se acepta aunque las opciones no descuenten nada; los demás chequeos (PV, ancla, precio) siguen primero", () => {
    expect(rechazoDeComponenteDeCombo({ ...base, ingredientesDeLaRecetaVigente: 1, opcionesQueDescuentan: { insumos: 0, nombres: ["Fanta"] } })).toBeNull();
    expect(rechazoDeComponenteDeCombo({ ...base, seProduce: true, opcionesQueDescuentan: { insumos: 0, nombres: ["Fanta"] } })).toBeNull();
    expect(rechazoDeComponenteDeCombo({ ...base, tipo: "MP", opcionesQueDescuentan: { insumos: 1, nombres: ["Coca"] } })?.codigo).toBe("PRODUCTO_INVALIDO");
    expect(rechazoDeComponenteDeCombo({ ...base, esAnclaDeAdicional: true, opcionesQueDescuentan: { insumos: 1, nombres: ["Coca"] } })?.codigo).toBe("PRODUCTO_INVALIDO");
    expect(rechazoDeComponenteDeCombo({ ...base, precioDeReferencia: 0, opcionesQueDescuentan: { insumos: 1, nombres: ["Coca"] } })?.codigo).toBe("COMPONENTE_SIN_PRECIO_DE_REFERENCIA");
  });
});
