/**
 * EL ORÁCULO de la guardia de unidad de las recetas (`docs/diseno-guardia-de-unidad-receta-2026-11-09.md`, nivel 10): la tabla de cuándo un guardado se ACEPTA o se RECHAZA según las dimensiones que lo cambian,
 * escrita aparte del código (a mano, no derivada de `juzgarCantidadesDeIngredientes`). `guardia-de-unidad.test.ts` recorre TODAS las combinaciones contra esta tabla.
 */
export type Magnitud = "PESO" | "VOLUMEN" | "CANTIDAD";
export type NivelDeCantidad = "debajo" | "en" | "sobre";

/** Las unidades de stock que el sistema siembra (`siembra-de-empresa.ts`), con su magnitud y las cantidades de prueba por nivel respecto del umbral escrito a mano en la tabla de abajo. */
export const UNIDADES: ReadonlyArray<{ nombre: string; magnitud: Magnitud; umbral: number; cantidades: Record<NivelDeCantidad, number> }> = [
  { nombre: "kg", magnitud: "PESO", umbral: 5, cantidades: { debajo: 4.9999, en: 5, sobre: 100 } },
  { nombre: "g", magnitud: "PESO", umbral: 5000, cantidades: { debajo: 4999, en: 5000, sobre: 20000 } },
  { nombre: "l", magnitud: "VOLUMEN", umbral: 5, cantidades: { debajo: 4.9999, en: 5, sobre: 100 } },
  { nombre: "ml", magnitud: "VOLUMEN", umbral: 5000, cantidades: { debajo: 4999, en: 5000, sobre: 20000 } },
  { nombre: "unidad", magnitud: "CANTIDAD", umbral: 50, cantidades: { debajo: 49, en: 50, sobre: 500 } },
];

export interface Combinacion {
  unidad: string;
  seProduce: "se-produce" | "se-vende";
  cantidad: NivelDeCantidad;
  confirmacion: "con" | "sin";
  ingrediente: "nuevo" | "sin-cambios";
}

export const DIMENSIONES = {
  magnitud: ["PESO", "VOLUMEN", "CANTIDAD"],
  unidad: UNIDADES.map((u) => u.nombre),
  seProduce: ["se-produce", "se-vende"],
  cantidad: ["debajo", "en", "sobre"],
  confirmacion: ["con", "sin"],
  ingrediente: ["nuevo", "sin-cambios"],
} as const;

/**
 * Las reglas, en palabras (cada una con quién la dijo, ver el diseño, nivel 5):
 *  - Una receta «Se produce» no se juzga nunca (R4).
 *  - Un ingrediente que ya estaba igual en la versión vigente no se re-juzga (R3).
 *  - Con la confirmación explícita se acepta (R6).
 *  - Sin confirmación: debajo del umbral se acepta; EN el umbral o sobre él se rechaza (R1: «a partir de»).
 */
export function esperado(c: Combinacion): "ACEPTA" | "RECHAZA" {
  if (c.seProduce === "se-produce") return "ACEPTA";
  if (c.ingrediente === "sin-cambios") return "ACEPTA";
  if (c.confirmacion === "con") return "ACEPTA";
  return c.cantidad === "debajo" ? "ACEPTA" : "RECHAZA";
}

/**
 * Cada columna de `Unidad` y de `RecetaIngrediente`, declarada: ¿afecta a la guardia? Un guardián (en el test) falla si aparece una columna nueva sin declarar acá: decidir si cambia el juicio es una
 * decisión, no un olvido. Lo mismo vale para un valor nuevo de `MagnitudUnidad` (`DIMENSIONES.magnitud` y `UNIDADES`).
 */
export const COLUMNAS_DE_UNIDAD: Record<string, "afecta" | "no-afecta"> = {
  id: "no-afecta",
  empresaId: "no-afecta",
  nombre: "afecta", // «g» y «ml» son las unidades menores: el umbral se multiplica por 1000; «kg», «l» y «unidad» llevan su mensaje propio.
  magnitud: "afecta", // define el umbral.
  activa: "no-afecta",
  decimales: "no-afecta",
};

export const COLUMNAS_DE_RECETA_INGREDIENTE: Record<string, "afecta" | "no-afecta"> = {
  id: "no-afecta",
  empresaId: "no-afecta",
  recetaVersionId: "no-afecta",
  insumoProductoId: "afecta", // identifica qué ingrediente cambió respecto de la versión vigente (R3).
  cantidad: "afecta", // es lo que se juzga.
  unidadId: "afecta", // un cambio de unidad cuenta como ingrediente cambiado (R3).
  mermaPorcentaje: "no-afecta",
  observaciones: "no-afecta",
};
