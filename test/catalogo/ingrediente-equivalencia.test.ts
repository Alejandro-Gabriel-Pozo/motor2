import { beforeEach, describe, expect, it } from "vitest";

import { validarIngredientes, whereEsIngredienteDeReceta, whereLoConsumeUnaOpcion, type DatosParaValidarReceta } from "../../src/core/catalogo/public";
import { revisarMateriaPrima } from "../../src/core/movimientos/linea-de-venta";
import { capacidadesDelProducto } from "../../src/core/catalogo/public";
import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarCatalogoBase } from "../setup/test-db";
import { esperadoPara } from "./capacidades-del-producto-oraculo";

/**
 * E4-3b de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7, regla R7 CONFIRMADA): «qué puede ser ingrediente de una receta» y «qué consume una opción» se deciden con `capacidadesDelProducto`. Recorre TODAS las
 * combinaciones tipo × se produce × clase de uso contra el ORÁCULO escrito aparte y fija:
 *  (a) `validarIngredientes` (el guardado de la receta) admite como ingrediente exactamente donde el oráculo dice `esIngredienteDeReceta` y rechaza con el texto de siempre en el resto;
 *  (b) `revisarMateriaPrima` (la venta) lo mismo para la receta (`esIngredienteDeReceta`) y para el consumo de una opción (`loConsumeUnaOpcion`);
 *  (c) EQUIVALENCIA con lo de SIEMPRE: sin REVENTA, solo una MP es ingrediente y solo una MP la consume una opción (se produzca o no, con cualquier otra clase o sin ella);
 *  (d) los `where` espejo (`whereEsIngredienteDeReceta`, `whereLoConsumeUnaOpcion`), sobre Postgres real, traen EXACTAMENTE lo que la función dice, en cada combinación que la base admite.
 */
const TIPOS = ["MP", "PV", "mp", "", "SERVICIO"] as const;
const SE_PRODUCE = [true, false] as const;
const CLASES: ReadonlyArray<string | null> = [null, "", "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "REVENTA", "reventa", "foo"];
const COMBINACIONES = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

const datosCon = (p: { tipo: string; seProduce: boolean; claseDeUso: string | null }): DatosParaValidarReceta => ({
  productos: new Map([["p1", { id: "p1", nombre: "Gaseosa", insumoId: null, unidadStockId: "u1", ...p }]]),
  disponiblesEnAlguna: new Set(["p1"]),
  insumos: new Map(),
  mensajeDeUnidadDeSustituto: new Map(),
  unidades: new Map(),
});
const ingrediente = [{ insumoProductoId: "p1", cantidad: 1, unidadId: "u1" }];
const RECHAZO = "Cada ingrediente tiene que ser una materia prima (MP) (Gaseosa no lo es).";

describe("ingrediente de receta y consumo de opción contra el oráculo", () => {
  it("recorre todas las combinaciones (sanidad: no pasa en vacío)", () => {
    expect(COMBINACIONES).toHaveLength(TIPOS.length * SE_PRODUCE.length * CLASES.length);
  });

  it.each(COMBINACIONES)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso»", ({ tipo, seProduce, claseDeUso }) => {
    const esperado = esperadoPara(tipo, seProduce, claseDeUso);
    const p = { tipo, seProduce, claseDeUso };
    expect(validarIngredientes(ingrediente, { seProduce: false }, datosCon(p))).toBe(esperado.esIngredienteDeReceta ? null : RECHAZO);
    expect(revisarMateriaPrima({ ...p, nombre: "Gaseosa" }, "Plato", "receta").ok).toBe(esperado.esIngredienteDeReceta);
    expect(revisarMateriaPrima({ ...p, nombre: "Gaseosa" }, "Plato", "opcion").ok).toBe(esperado.loConsumeUnaOpcion);
  });

  it("equivalencia con lo de siempre: sin REVENTA, solo una MP es ingrediente y solo una MP la consume una opción", () => {
    for (const claseDeUso of [null, "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "reventa", ""]) {
      for (const seProduce of SE_PRODUCE) {
        for (const tipo of ["MP", "PV"] as const) {
          const c = capacidadesDelProducto({ tipo, seProduce, claseDeUso });
          expect(c.esIngredienteDeReceta, `${tipo}/${seProduce}/${claseDeUso}`).toBe(tipo === "MP");
          expect(c.loConsumeUnaOpcion, `${tipo}/${seProduce}/${claseDeUso}`).toBe(tipo === "MP");
        }
      }
    }
  });

  it("una REVENTA coherente es ingrediente y la consume una opción; incoherente (MP o se produce) y un tipo desconocido, no (todo nace cerrado); el rechazo conserva el texto de siempre", () => {
    expect(validarIngredientes(ingrediente, { seProduce: false }, datosCon({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA" }))).toBeNull();
    for (const p of [{ tipo: "MP", seProduce: false, claseDeUso: "REVENTA" }, { tipo: "PV", seProduce: true, claseDeUso: "REVENTA" }, { tipo: "SERVICIO", seProduce: false, claseDeUso: "REVENTA" }, { tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE" }]) {
      expect(validarIngredientes(ingrediente, { seProduce: false }, datosCon(p)), JSON.stringify(p)).toBe(RECHAZO);
    }
    expect(revisarMateriaPrima({ tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE", nombre: "Pan" }, "Plato", "opcion")).toEqual({ ok: false, mensaje: 'La materia prima de la receta de "Plato" no está marcada como MP.' });
    expect(revisarMateriaPrima(null, "Plato", "opcion").ok).toBe(false);
  });
});

describe("los where espejo (ingrediente de receta y consumo de opción) contra la función, sobre Postgres real", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("traen exactamente los productos que `capacidadesDelProducto` dice, en cada combinación que la base admite", async () => {
    const { kg } = await sembrarCatalogoBase();
    // Lo que los CHECK de la base dejan guardar: MP (sin clase, MATERIA_PRIMA, INSUMO; ELABORADO solo si se produce) y PV (sin clase, VENDIBLE; REVENTA solo si no se produce).
    const forma: Array<{ tipo: "MP" | "PV"; seProduce: boolean; claseDeUso: string | null }> = [
      { tipo: "MP", seProduce: false, claseDeUso: null },
      { tipo: "MP", seProduce: false, claseDeUso: "MATERIA_PRIMA" },
      { tipo: "MP", seProduce: false, claseDeUso: "INSUMO" },
      { tipo: "MP", seProduce: true, claseDeUso: null },
      { tipo: "MP", seProduce: true, claseDeUso: "ELABORADO" },
      { tipo: "PV", seProduce: false, claseDeUso: null },
      { tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE" },
      { tipo: "PV", seProduce: false, claseDeUso: "REVENTA" },
      { tipo: "PV", seProduce: true, claseDeUso: null },
      { tipo: "PV", seProduce: true, claseDeUso: "VENDIBLE" },
    ];
    for (const [i, f] of forma.entries()) {
      await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: `X${i}`, nombre: `Producto ${i}`, tipo: f.tipo, seProduce: f.seProduce, claseDeUso: f.claseDeUso, unidadStockId: kg.id } });
    }
    const codigos = async (where: object) => (await prismaAdmin.producto.findMany({ where: { empresaId: EMPRESA_POR_DEFECTO_ID, AND: [where] }, select: { codigo: true } })).map((p) => p.codigo).sort();
    const esperados = (cual: "esIngredienteDeReceta" | "loConsumeUnaOpcion") => forma.flatMap((f, i) => (capacidadesDelProducto(f)[cual] ? [`X${i}`] : [])).sort();
    expect(await codigos(whereEsIngredienteDeReceta())).toEqual(esperados("esIngredienteDeReceta"));
    expect(await codigos(whereLoConsumeUnaOpcion())).toEqual(esperados("loConsumeUnaOpcion"));
    expect(esperados("esIngredienteDeReceta")).toContain("X7"); // la REVENTA entra al selector de ingredientes
    expect(esperados("loConsumeUnaOpcion")).toContain("X7"); // y a las opciones
    expect(esperados("esIngredienteDeReceta")).not.toContain("X5"); // un PV común no
  });
});
