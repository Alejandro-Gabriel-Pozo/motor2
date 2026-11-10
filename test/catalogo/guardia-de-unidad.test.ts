import { MagnitudUnidad, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { UMBRALES_DE_CANTIDAD, esCantidadDesproporcionada, mensajeDeCantidadDesproporcionada, umbralDeCantidad } from "../../src/core/catalogo/guardia-de-unidad";
import { juzgarCantidadesDeIngredientes } from "../../src/core/catalogo/public";
import { COLUMNAS_DE_RECETA_INGREDIENTE, COLUMNAS_DE_UNIDAD, DIMENSIONES, UNIDADES, esperado, type Combinacion } from "./guardia-de-unidad.reglas";

/**
 * Guardia de unidad de las recetas (`docs/diseno-guardia-de-unidad-receta-2026-11-09.md`). Núcleo puro: umbrales, mensaje exacto y el recorrido de TODAS las combinaciones contra el oráculo escrito aparte.
 * Lo que necesita base (el caso de uso, las acciones) está en `guardia-de-unidad-servidor.test.ts`; la pantalla, en `guardia-de-unidad-pantalla.test.tsx`.
 */
describe("umbrales", () => {
  it("viven en un solo lugar y son los propuestos: PESO 5, VOLUMEN 5, CANTIDAD 50", () => {
    expect(UMBRALES_DE_CANTIDAD).toEqual({ PESO: 5, VOLUMEN: 5, CANTIDAD: 50 });
  });

  it.each(UNIDADES)("el umbral de «$nombre» ($magnitud) es $umbral", (u) => {
    expect(umbralDeCantidad({ nombre: u.nombre, magnitud: u.magnitud })).toBe(u.umbral);
  });

  it("una magnitud que no está declarada no se juzga", () => {
    expect(umbralDeCantidad({ nombre: "x", magnitud: "TIEMPO" })).toBeNull();
    expect(esCantidadDesproporcionada(1e9, { nombre: "x", magnitud: "TIEMPO" })).toBe(false);
  });

  it("justo en el umbral es desproporcionada; un poco debajo, no", () => {
    expect(esCantidadDesproporcionada(5, { nombre: "kg", magnitud: "PESO" })).toBe(true);
    expect(esCantidadDesproporcionada(4.9999, { nombre: "kg", magnitud: "PESO" })).toBe(false);
    expect(esCantidadDesproporcionada(50, { nombre: "unidad", magnitud: "CANTIDAD" })).toBe(true);
    expect(esCantidadDesproporcionada(49, { nombre: "unidad", magnitud: "CANTIDAD" })).toBe(false);
  });

  it("100 g de un insumo con stock en gramos (lo normal) NO es desproporcionado", () => {
    expect(esCantidadDesproporcionada(100, { nombre: "g", magnitud: "PESO" })).toBe(false);
    expect(esCantidadDesproporcionada(100, { nombre: "kg", magnitud: "PESO" })).toBe(true);
  });
});

describe("el mensaje", () => {
  it("kg: muestra la equivalencia y pide confirmar", () => {
    expect(mensajeDeCantidadDesproporcionada({ cantidad: 100, unidad: { nombre: "kg", magnitud: "PESO" }, insumo: "Pan rallado", producto: "Milanesa con papas fritas" })).toBe(
      "Esto descuenta 100 kg de Pan rallado por cada unidad vendida de Milanesa con papas fritas. Si querías 100 gramos, escribí 0,1 (la receta se carga en kg). Si de verdad es 100 kg, confirmalo."
    );
  });

  it("l: en mililitros", () => {
    expect(mensajeDeCantidadDesproporcionada({ cantidad: 12, unidad: { nombre: "l", magnitud: "VOLUMEN" }, insumo: "Aceite de girasol", producto: "Papas fritas" })).toBe(
      "Esto descuenta 12 l de Aceite de girasol por cada unidad vendida de Papas fritas. Si querías 12 mililitros, escribí 0,012 (la receta se carga en l). Si de verdad es 12 l, confirmalo."
    );
  });

  it("unidades (y g, ml): sin sugerencia de equivalencia, con el plural de «unidad»", () => {
    expect(mensajeDeCantidadDesproporcionada({ cantidad: 60, unidad: { nombre: "unidad", magnitud: "CANTIDAD" }, insumo: "Huevo", producto: "Milanesa" })).toBe(
      "Esto descuenta 60 unidades de Huevo por cada unidad vendida de Milanesa. Si de verdad es así, confirmalo."
    );
    expect(mensajeDeCantidadDesproporcionada({ cantidad: 20000, unidad: { nombre: "g", magnitud: "PESO" }, insumo: "Harina", producto: "Pan" })).toBe(
      "Esto descuenta 20000 g de Harina por cada unidad vendida de Pan. Si de verdad es así, confirmalo."
    );
  });

  it("una unidad con otro nombre (creada a mano) va tal cual, sin pluralizar", () => {
    expect(mensajeDeCantidadDesproporcionada({ cantidad: 80, unidad: { nombre: "feta", magnitud: "CANTIDAD" }, insumo: "Jamón", producto: "Tostado" })).toBe(
      "Esto descuenta 80 feta de Jamón por cada unidad vendida de Tostado. Si de verdad es así, confirmalo."
    );
  });
});

/** Arma el pedido de la combinación: una MP con la unidad de stock indicada, y la versión vigente con o sin ese ingrediente igual. */
function pedidoDe(c: Combinacion) {
  const u = UNIDADES.find((x) => x.nombre === c.unidad)!;
  const cantidad = u.cantidades[c.cantidad];
  return {
    items: [{ insumoProductoId: "mp1", cantidad, unidadId: "u1" }],
    producto: { nombre: "Milanesa", seProduce: c.seProduce === "se-produce" },
    vigentes: new Map(c.ingrediente === "sin-cambios" ? [["mp1", { cantidad, unidadId: "u1" }]] : []),
    productos: new Map([["mp1", { nombre: "Pan rallado", unidadStockId: "u1" }]]),
    unidades: new Map([["u1", { nombre: u.nombre, magnitud: u.magnitud }]]),
    confirmada: c.confirmacion === "con" ? true : undefined,
    omitir: false,
  };
}

const COMBINACIONES: Combinacion[] = DIMENSIONES.unidad.flatMap((unidad) =>
  DIMENSIONES.seProduce.flatMap((seProduce) =>
    DIMENSIONES.cantidad.flatMap((cantidad) =>
      DIMENSIONES.confirmacion.flatMap((confirmacion) => DIMENSIONES.ingrediente.map((ingrediente) => ({ unidad, seProduce, cantidad, confirmacion, ingrediente }))),
    ),
  ),
);

describe("todas las combinaciones contra el oráculo", () => {
  it(`recorre las ${UNIDADES.length * 2 * 3 * 2 * 2} combinaciones`, () => {
    expect(COMBINACIONES).toHaveLength(UNIDADES.length * 2 * 3 * 2 * 2);
  });

  it.each(COMBINACIONES)("%o", (c) => {
    const mensaje = juzgarCantidadesDeIngredientes(pedidoDe(c));
    expect(mensaje === null ? "ACEPTA" : "RECHAZA").toBe(esperado(c));
  });
});

describe("otras entradas de la guardia", () => {
  const base = pedidoDe({ unidad: "kg", seProduce: "se-vende", cantidad: "sobre", confirmacion: "sin", ingrediente: "nuevo" });

  it("solo un `true` estricto confirma (un «true» de texto, 1 o un objeto no)", () => {
    for (const falsa of ["true", 1, {}, "1", false, null, undefined]) {
      expect(juzgarCantidadesDeIngredientes({ ...base, confirmada: falsa })).not.toBeNull();
    }
    expect(juzgarCantidadesDeIngredientes({ ...base, confirmada: true })).toBeNull();
  });

  it("la ruta que omite la guardia (carga a ciegas, copias) no se juzga", () => {
    expect(juzgarCantidadesDeIngredientes({ ...base, omitir: true })).toBeNull();
  });

  it("un ingrediente con la unidad cambiada cuenta como cambiado aunque la cantidad sea la misma", () => {
    expect(juzgarCantidadesDeIngredientes({ ...base, vigentes: new Map([["mp1", { cantidad: 100, unidadId: "otra" }]]) })).not.toBeNull();
    expect(juzgarCantidadesDeIngredientes({ ...base, vigentes: new Map([["mp1", { cantidad: 100, unidadId: "u1" }]]) })).toBeNull();
  });

  it("un ingrediente cuya MP o unidad no se encuentra lo reportan las otras validaciones, no esta", () => {
    expect(juzgarCantidadesDeIngredientes({ ...base, productos: new Map() })).toBeNull();
    expect(juzgarCantidadesDeIngredientes({ ...base, unidades: new Map() })).toBeNull();
  });

  it("con varios ingredientes, el desproporcionado da el mensaje aunque otros estén bien", () => {
    const mensaje = juzgarCantidadesDeIngredientes({
      ...base,
      items: [
        { insumoProductoId: "mp2", cantidad: 0.2, unidadId: "u1" },
        { insumoProductoId: "mp1", cantidad: 100, unidadId: "u1" },
      ],
      productos: new Map([
        ["mp1", { nombre: "Pan rallado", unidadStockId: "u1" }],
        ["mp2", { nombre: "Bife", unidadStockId: "u1" }],
      ]),
    });
    expect(mensaje).toContain("100 kg de Pan rallado");
  });
});

describe("guardián de dimensiones: una columna o una magnitud nueva se declara si afecta o no", () => {
  const reales = (e: Record<string, string>) => Object.values(e).sort();
  const declaradas = (d: Record<string, unknown>) => Object.keys(d).sort();

  it("Unidad", () => expect(reales(Prisma.UnidadScalarFieldEnum)).toEqual(declaradas(COLUMNAS_DE_UNIDAD)));
  it("RecetaIngrediente", () => expect(reales(Prisma.RecetaIngredienteScalarFieldEnum)).toEqual(declaradas(COLUMNAS_DE_RECETA_INGREDIENTE)));
  it("MagnitudUnidad: cada valor tiene su umbral y su unidad de prueba", () => {
    const magnitudes = Object.values(MagnitudUnidad).sort();
    expect([...DIMENSIONES.magnitud].sort()).toEqual(magnitudes);
    expect(Object.keys(UMBRALES_DE_CANTIDAD).sort()).toEqual(magnitudes);
    expect([...new Set(UNIDADES.map((u) => u.magnitud))].sort()).toEqual(magnitudes);
  });
});
