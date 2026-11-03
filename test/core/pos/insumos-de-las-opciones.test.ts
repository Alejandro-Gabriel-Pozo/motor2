import { describe, expect, it } from "vitest";
import { insumosQuePuedeSumarAlgunaOpcion } from "../../../src/core/pos/insumos-de-las-opciones";
import type { GrupoParaVender, OpcionParaVender } from "../../../src/core/pos/linea-configurada";

/**
 * Ventas con opciones, paso 4 (diseño 2026-10-29): `insumosQuePuedeSumarAlgunaOpcion`, la definición de origen de stock del CATÁLOGO para un producto sin receta: cuántos insumos distintos suma alguna
 * opción OFRECIDA (grupo y opción activos y admitidos; el apagado temporal de la sucursal no cuenta). Solo las SUMA de las opciones del precio: el REEMPLAZA no (con la base vacía no tiene qué
 * reemplazar), la «ninguna» aporta cero y los ADICIONALES no entran.
 */
const suma = (insumoProductoId: string) => ({ efecto: "SUMA" as const, insumoProductoId, reemplazaAProductoId: null, cantidad: 1, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: false });
const reemplaza = (de: string, por: string) => ({ efecto: "REEMPLAZA" as const, insumoProductoId: por, reemplazaAProductoId: de, cantidad: 1, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: false });

function opcion(id: string, consumos: OpcionParaVender["consumos"], extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId: id,
    nombre: id,
    orden: 1,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 1,
    versionVigenteId: `v-${id}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: { tipo: "MONTO", monto: 0 },
    factorEscala: null,
    consumos,
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}
const grupo = (opciones: OpcionParaVender[], extra: Partial<GrupoParaVender> = {}): GrupoParaVender => ({
  grupoId: "g",
  nombre: "Grupo",
  tipo: "VARIANTE",
  activo: true,
  admitido: true,
  cantidadMinima: 0,
  cantidadMaxima: 1,
  orden: 0,
  modoPrecio: null,
  opciones,
  ...extra,
});

describe("insumosQuePuedeSumarAlgunaOpcion", () => {
  it("sin grupos, o con opciones sin consumo, no suma nada", () => {
    expect(insumosQuePuedeSumarAlgunaOpcion([])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("fanta", [])])])).toBe(0);
  });

  it("cuenta las SUMA de las opciones ofrecidas, por insumo distinto (el mismo insumo en dos opciones cuenta una vez)", () => {
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")]), opcion("fanta", [])])])).toBe(1);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")]), opcion("sprite", [suma("botella"), suma("hielo")])])])).toBe(2);
  });

  it("un REEMPLAZA no cuenta (con la base vacía no tiene qué reemplazar); la «ninguna» aporta cero; los ADICIONALES no entran", () => {
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("almendras", [reemplaza("leche", "almendras")])])])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("ninguna", [suma("botella")], { esNinguna: true })])])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("shot", [suma("grano")])], { tipo: "ADICIONAL" })])).toBe(0);
    // MEDIDA e INCLUIDA sí.
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("grande", [suma("vaso")])], { tipo: "MEDIDA" })])).toBe(1);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("azucar", [suma("sobre")])], { tipo: "INCLUIDA" })])).toBe(1);
  });

  it("lo apagado o no admitido no se ofrece (grupo o opción); el apagado temporal de la sucursal SÍ cuenta", () => {
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")])], { activo: false })])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")])], { admitido: false })])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")], { activa: false })])])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")], { admitida: false })])])).toBe(0);
    expect(insumosQuePuedeSumarAlgunaOpcion([grupo([opcion("coca", [suma("botella")], { apagadaEnSucursal: true })])])).toBe(1);
  });
});
