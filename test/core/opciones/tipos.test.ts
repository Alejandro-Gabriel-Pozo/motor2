import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAXIMA_DE_OPCION,
  EFECTOS_DE_CONSUMO_DE_OPCION,
  FACTOR_DE_ESCALA_MAXIMO,
  IMPORTE_MINIMO,
  MODOS_DE_PRECIO_DE_MEDIDA,
  TIPOS_DE_DIFERENCIA,
  TIPOS_DE_GRUPO_DE_OPCIONES,
  type DiferenciaDePrecio,
  type EfectoDeConsumoDeOpcion,
  type ModoDePrecioDeMedida,
  type TipoDeDiferencia,
  type TipoDeGrupoDeOpciones,
} from "../../../src/core/opciones/tipos";

/**
 * GO-0b: las listas cerradas del «elemento configurable» (espejo de lo que GO-1 va a crear en la base). La paridad con los enums y los CHECK de la base se agrega en GO-1,
 * cuando existan; acá, lo que se puede afirmar sin base: el contenido exacto, sin repetidos, en mayúsculas y sin vocabulario de un solo rubro.
 */
const LISTAS = {
  TIPOS_DE_GRUPO_DE_OPCIONES,
  MODOS_DE_PRECIO_DE_MEDIDA,
  EFECTOS_DE_CONSUMO_DE_OPCION,
  TIPOS_DE_DIFERENCIA,
} as const;

describe("listas cerradas de las opciones de venta", () => {
  it("tienen exactamente los valores del diseño, en ese orden", () => {
    expect([...TIPOS_DE_GRUPO_DE_OPCIONES]).toEqual(["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"]);
    expect([...MODOS_DE_PRECIO_DE_MEDIDA]).toEqual(["ABSOLUTO", "DIFERENCIA"]);
    expect([...EFECTOS_DE_CONSUMO_DE_OPCION]).toEqual(["SUMA", "REEMPLAZA"]);
    expect([...TIPOS_DE_DIFERENCIA]).toEqual(["MONTO", "PORCENTAJE"]);
  });

  it("no repiten ningún valor y son identificadores en mayúsculas", () => {
    for (const [nombre, lista] of Object.entries(LISTAS)) {
      expect(new Set(lista).size, nombre).toBe(lista.length);
      for (const valor of lista) expect(valor, `${nombre}.${valor}`).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it("los nombres son neutros: ningún valor habla de un solo rubro", () => {
    const todos = Object.values(LISTAS).flat().join(" ").toLowerCase();
    for (const prohibida of ["plato", "receta", "cocina", "comanda"]) expect(todos).not.toContain(prohibida);
  });

  it("los topes coinciden con los CHECK del diseño", () => {
    expect(CANTIDAD_MAXIMA_DE_OPCION).toBe(10);
    expect(FACTOR_DE_ESCALA_MAXIMO).toBe(10);
    expect(IMPORTE_MINIMO).toBe(0.01);
  });
});

describe("tipos derivados de las listas", () => {
  it("cada tipo es exactamente un elemento de su lista (un valor fuera de ella no compila)", () => {
    const tipo: TipoDeGrupoDeOpciones = "ADICIONAL";
    const modo: ModoDePrecioDeMedida = "DIFERENCIA";
    const efecto: EfectoDeConsumoDeOpcion = "REEMPLAZA";
    const diferencia: TipoDeDiferencia = "PORCENTAJE";
    expect(TIPOS_DE_GRUPO_DE_OPCIONES).toContain(tipo);
    expect(MODOS_DE_PRECIO_DE_MEDIDA).toContain(modo);
    expect(EFECTOS_DE_CONSUMO_DE_OPCION).toContain(efecto);
    expect(TIPOS_DE_DIFERENCIA).toContain(diferencia);
    // @ts-expect-error GUARNICION no es un tipo de grupo: el nombre del rubro no entra al modelo
    const fuera: TipoDeGrupoDeOpciones = "GUARNICION";
    expect(TIPOS_DE_GRUPO_DE_OPCIONES as readonly string[]).not.toContain(fuera);
  });

  it("una diferencia es un monto o un porcentaje, nunca los dos", () => {
    const monto: DiferenciaDePrecio = { tipo: "MONTO", monto: 300 };
    const porcentaje: DiferenciaDePrecio = { tipo: "PORCENTAJE", porcentaje: 8.5 };
    // @ts-expect-error un porcentaje no lleva monto: se guarda UNO solo
    const mezclada: DiferenciaDePrecio = { tipo: "PORCENTAJE", porcentaje: 8.5, monto: 300 };
    expect([monto.tipo, porcentaje.tipo, mezclada.tipo]).toEqual(["MONTO", "PORCENTAJE", "PORCENTAJE"]);
  });
});
