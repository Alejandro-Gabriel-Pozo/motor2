import { describe, expect, it } from "vitest";
import { CODIGO_PRODUCTO_SIN_RECETA, mensajeProductoSinReceta, rechazoSinOrigenDeStock } from "../../src/core/movimientos/origen-de-stock";
import * as fachada from "../../src/core/movimientos/public";

/**
 * SIN RECETA NO SE VENDE (ADR-033): la regla pura del origen de stock de un PV, sin base. El TEXTO se fija byte a byte (es lo que ve el mozo y quien cobra); las cuatro combinaciones que
 * importan: con receta, se produce, ancla de un adicional, y ninguna de las tres (el único rechazo).
 */
const pv = (o: Partial<Parameters<typeof rechazoSinOrigenDeStock>[0]> = {}) => ({ nombre: "Milanesa", seProduce: false, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 0, ...o });

describe("rechazoSinOrigenDeStock", () => {
  it("sin receta, sin stock propio y sin ser ancla: rechaza nombrando el producto y diciendo dónde se arregla", () => {
    expect(rechazoSinOrigenDeStock(pv())).toBe("«Milanesa» no tiene receta: armala en Catálogo → Recetas para poder venderla.");
  });

  it("con receta vigente (aunque sea de un solo ingrediente: una reventa) se vende", () => {
    expect(rechazoSinOrigenDeStock(pv({ ingredientesDeLaRecetaVigente: 1 }))).toBeNull();
    expect(rechazoSinOrigenDeStock(pv({ ingredientesDeLaRecetaVigente: 7 }))).toBeNull();
  });

  it("un producto que se produce tiene stock propio: se vende sin mirar la receta", () => {
    expect(rechazoSinOrigenDeStock(pv({ seProduce: true }))).toBeNull();
  });

  it("el ancla de un adicional queda exceptuada: su consumo es el de su opción", () => {
    expect(rechazoSinOrigenDeStock(pv({ esAnclaDeAdicional: true }))).toBeNull();
  });

  it("todas las combinaciones: rechaza SOLO cuando no hay ninguno de los tres orígenes", () => {
    for (const seProduce of [false, true])
      for (const esAnclaDeAdicional of [false, true])
        for (const ingredientesDeLaRecetaVigente of [0, 1, 3]) {
          const r = rechazoSinOrigenDeStock(pv({ seProduce, esAnclaDeAdicional, ingredientesDeLaRecetaVigente }));
          const sinOrigen = !seProduce && !esAnclaDeAdicional && ingredientesDeLaRecetaVigente === 0;
          expect(r, JSON.stringify({ seProduce, esAnclaDeAdicional, ingredientesDeLaRecetaVigente })).toBe(sinOrigen ? mensajeProductoSinReceta("Milanesa") : null);
        }
  });

  it("con opciones elegidas (ventas con opciones, 2026-10-29): la base sin receta se vende SOLO si las opciones suman algún insumo; con receta, se produce o ancla, ni se mira; sin `opciones` nada cambia", () => {
    const fanta = { insumos: 0, nombres: ["Fanta"] };
    for (const seProduce of [false, true])
      for (const esAnclaDeAdicional of [false, true])
        for (const ingredientesDeLaRecetaVigente of [0, 1])
          for (const opciones of [undefined, fanta, { insumos: 2, nombres: ["Coca"] }]) {
            const r = rechazoSinOrigenDeStock(pv({ seProduce, esAnclaDeAdicional, ingredientesDeLaRecetaVigente, opciones }));
            const tieneOrigen = seProduce || esAnclaDeAdicional || ingredientesDeLaRecetaVigente > 0 || (opciones?.insumos ?? 0) > 0;
            expect(r === null, JSON.stringify({ seProduce, esAnclaDeAdicional, ingredientesDeLaRecetaVigente, opciones })).toBe(tieneOrigen);
          }
    expect(rechazoSinOrigenDeStock(pv({ nombre: "Gaseosa", opciones: fanta }))).toBe("“Gaseosa” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa” en Catálogo → Recetas.");
    expect(rechazoSinOrigenDeStock(pv({ nombre: "Gaseosa", opciones: { insumos: 0, nombres: ["Chica", "Fanta"] } }))).toContain("con “Chica” y “Fanta” no descuenta");
  });

  it("en el CATÁLOGO (opciones ofrecidas): sin receta ni insumos que sumen, el mensaje de catálogo; si alguna opción suma, tiene origen", () => {
    expect(rechazoSinOrigenDeStock(pv({ nombre: "Gaseosa", opciones: { insumos: 0, nombres: [], ofrecidas: true } }))).toBe("“Gaseosa” no tiene receta ni opciones que descuenten insumos: armá la receta o cargale el consumo a sus opciones.");
    expect(rechazoSinOrigenDeStock(pv({ opciones: { insumos: 1, nombres: [], ofrecidas: true } }))).toBeNull();
    expect(rechazoSinOrigenDeStock(pv({ ingredientesDeLaRecetaVigente: 1, opciones: { insumos: 0, nombres: [], ofrecidas: true } }))).toBeNull();
  });

  it("el código tipado y el mensaje con otro nombre (comillas angulares, sin tocar el nombre)", () => {
    expect(CODIGO_PRODUCTO_SIN_RECETA).toBe("PRODUCTO_SIN_RECETA");
    expect(mensajeProductoSinReceta("Coca-Cola 500 ml")).toBe("«Coca-Cola 500 ml» no tiene receta: armala en Catálogo → Recetas para poder venderla.");
  });

  it("la fachada pública reexporta la regla y el código (la usa el agregado de ítems del POS, de otro dominio)", () => {
    expect(fachada.rechazoSinOrigenDeStock).toBe(rechazoSinOrigenDeStock);
    expect(fachada.CODIGO_PRODUCTO_SIN_RECETA).toBe(CODIGO_PRODUCTO_SIN_RECETA);
  });
});
