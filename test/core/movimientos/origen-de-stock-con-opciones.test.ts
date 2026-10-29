import { describe, expect, it } from "vitest";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender, type OpcionConConsumo } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { rechazoSinOrigenDeStock } from "../../../src/core/movimientos/origen-de-stock";
import {
  BASES,
  CONSUMOS,
  GRUPOS,
  esperadoDeAdicional,
  esperadoDeProducto,
  esperadoSinConfigurar,
  type Base,
  type ConsumoDeLaOpcion,
  type TipoDeGrupo,
} from "./oraculos/origen-de-stock-con-opciones";

/**
 * Ventas con opciones (diseño 2026-10-29, sección E): el ORÁCULO PURO de 78 casos (4 sin configurar + 72 de una línea con opciones + 2 de un adicional) contra `rechazoSinOrigenDeStock` y
 * `consumoDeLineaConfigurada`. La tabla de lo esperado vive aparte (`oraculos/origen-de-stock-con-opciones.ts`) y está escrita a mano. El veredicto se arma como lo hace la barrera final de la
 * venta (`registrar-venta-en-tx.ts`): los pedidos reales de la línea alimentan la regla.
 */
const SUCURSAL = "sucursal-1";
const UNIDAD = "u1";

const ingredienteX = (): { ingrediente: { insumoProductoId: string; cantidad: number; mermaPorcentaje: number; rendimientosLocales: []; insumoSustitutoIds: string[] }; unidadStockId: string } => ({
  ingrediente: { insumoProductoId: "X", cantidad: 2, mermaPorcentaje: 0, rendimientosLocales: [], insumoSustitutoIds: [] },
  unidadStockId: UNIDAD,
});

const suma = (insumo: string): ConsumoDeOpcionParaVender => ({ efecto: "SUMA", insumoProductoId: insumo, reemplazaAProductoId: null, cantidad: 1, unidadStockId: UNIDAD, mermaPorcentaje: 0, escalaConLaMedida: false });
const reemplaza = (de: string, por: string): ConsumoDeOpcionParaVender => ({ efecto: "REEMPLAZA", insumoProductoId: por, reemplazaAProductoId: de, cantidad: 1, unidadStockId: UNIDAD, mermaPorcentaje: 0, escalaConLaMedida: false });

function consumosDe(c: ConsumoDeLaOpcion): ConsumoDeOpcionParaVender[] {
  switch (c) {
    case "ninguno":
    case "«ninguna»":
      return [];
    case "SUMA Y":
      return [suma("Y")];
    case "REEMPLAZA X→Y":
      return [reemplaza("X", "Y")];
    case "REEMPLAZA Z→Y":
      return [reemplaza("Z", "Y")];
    case "SUMA Y + REEMPLAZA X→W":
      return [suma("Y"), reemplaza("X", "W")];
  }
}

function opcion(grupo: TipoDeGrupo, c: ConsumoDeLaOpcion): OpcionConConsumo {
  return { opcionId: "o1", nombre: c === "«ninguna»" ? "Ninguna" : "Opción", tipo: grupo, ordenDeGrupo: 1, ordenDeOpcion: 1, cantidad: 1, factorEscala: grupo === "MEDIDA" ? 1 : null, consumos: consumosDe(c) };
}

/** Lo que decide la barrera final para una línea PRODUCTO que no se produce: `rechazoSinOrigenDeStock` alimentada con los pedidos reales. */
function veredictoDeProducto(base: Base, grupo: TipoDeGrupo, c: ConsumoDeLaOpcion) {
  const opciones = [opcion(grupo, c)];
  const r = consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: base === "con X" ? [ingredienteX()] : [], opciones, adicionales: [] });
  if (!r.ok) throw new Error(`el consumo no debería fallar: ${r.mensaje}`);
  const rechazo = rechazoSinOrigenDeStock({
    nombre: "Gaseosa",
    seProduce: false,
    esAnclaDeAdicional: false,
    ingredientesDeLaRecetaVigente: base === "con X" ? 1 : 0,
    opciones: { insumos: r.pedidos.length, nombres: opciones.map((o) => o.nombre) },
  });
  return { rechazo, descuenta: r.pedidos.map((p) => p.productoId).sort() };
}

describe("origen de stock con opciones: oráculo puro de 78 casos", () => {
  let casos = 0;

  it("sin configurar (4 casos): se vende si se produce o la base tiene un ingrediente; si no, el rechazo de siempre", () => {
    for (const base of BASES)
      for (const seProduce of [false, true]) {
        casos++;
        const esperado = esperadoSinConfigurar(base, seProduce);
        const rechazo = rechazoSinOrigenDeStock({ nombre: "Gaseosa", seProduce, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: base === "con X" ? 1 : 0 });
        expect(rechazo === null, JSON.stringify({ base, seProduce })).toBe(esperado.acepta);
      }
  });

  it("PRODUCTO (72 casos: base × se produce × grupo × consumo): veredicto y consumo contra la tabla", () => {
    for (const base of BASES)
      for (const seProduce of [false, true])
        for (const grupo of GRUPOS)
          for (const c of CONSUMOS) {
            casos++;
            const clave = JSON.stringify({ base, seProduce, grupo, c });
            const esperado = esperadoDeProducto(base, seProduce, c);
            if (seProduce) {
              // Un PV que se produce no se vende con opciones: lo rechaza `armarLinea` ANTES de la regla del origen de stock (que, de hecho, lo daría por bueno: tiene stock propio).
              expect(esperado.motivo, clave).toBe("se produce por lote");
              expect(rechazoSinOrigenDeStock({ nombre: "Gaseosa", seProduce: true, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 0 }), clave).toBeNull();
              continue;
            }
            const { rechazo, descuenta } = veredictoDeProducto(base, grupo, c);
            expect(rechazo === null, clave).toBe(esperado.acepta);
            if (esperado.acepta) expect(descuenta, clave).toEqual(esperado.descuenta);
            // I1: una línea aceptada genera al menos un consumo; una rechazada no descontaría nada.
            expect(rechazo === null, clave).toBe(descuenta.length > 0);
          }
  });

  it("ADICIONAL (2 casos): la excepción vigente, se vende; con SUMA descuenta Y y sin consumo no descuenta nada", () => {
    for (const c of ["SUMA Y", "ninguno"] as const) {
      casos++;
      const esperado = esperadoDeAdicional(c);
      const r = consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: [], opciones: [], adicionales: [{ opcionId: "a1", nombre: "Extra", cantidadPorUnidad: 1, consumos: c === "SUMA Y" ? [suma("Y")] : [] }] });
      if (!r.ok) throw new Error(r.mensaje);
      expect(rechazoSinOrigenDeStock({ nombre: "Ancla", seProduce: false, esAnclaDeAdicional: true, ingredientesDeLaRecetaVigente: 0 }) === null, c).toBe(esperado.acepta);
      expect(r.pedidosDeAdicionales[0]!.pedidos.map((p) => p.productoId).sort(), c).toEqual(esperado.descuenta);
    }
  });

  it("son exactamente 78 casos", () => {
    expect(casos).toBe(78);
  });

  it("una MEDIDA con factor y consumo que escala con la medida: la cantidad descontada lleva el factor (y el que no escala, no)", () => {
    const medida = (escala: boolean): OpcionConConsumo => ({
      opcionId: "g",
      nombre: "Grande",
      tipo: "MEDIDA",
      ordenDeGrupo: 1,
      ordenDeOpcion: 1,
      cantidad: 1,
      factorEscala: 1.5,
      consumos: [{ ...suma("Y"), cantidad: 4, escalaConLaMedida: escala }],
    });
    const cantidadDeY = (escala: boolean) => {
      const r = consumoDeLineaConfigurada({ cantidad: 2, sucursalId: SUCURSAL, base: [], opciones: [medida(escala)], adicionales: [] });
      if (!r.ok) throw new Error(r.mensaje);
      return r.pedidos.find((p) => p.productoId === "Y")!.cantidad;
    };
    expect(cantidadDeY(true)).toBe(12); // 2 vendidas × 4 × 1,5
    expect(cantidadDeY(false)).toBe(8); // el vaso no se multiplica
  });

  it("los mensajes nuevos: nombran el producto y las opciones y dicen dónde se arregla; sin nombres de opción vuelve el mensaje de siempre", () => {
    expect(rechazoSinOrigenDeStock({ nombre: "Gaseosa 500 cc", seProduce: false, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 0, opciones: { insumos: 0, nombres: ["Fanta"] } })).toBe(
      "“Gaseosa 500 cc” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa 500 cc” en Catálogo → Recetas."
    );
    expect(rechazoSinOrigenDeStock({ nombre: "Gaseosa 500 cc", seProduce: false, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 0, opciones: { insumos: 0, nombres: [] } })).toBe(
      "«Gaseosa 500 cc» no tiene receta: armala en Catálogo → Recetas para poder venderla."
    );
  });
});
