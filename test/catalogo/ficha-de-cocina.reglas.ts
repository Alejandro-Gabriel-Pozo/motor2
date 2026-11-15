/**
 * EL ORÁCULO de la ficha de cocina (`docs/diseno-ficha-de-cocina-2026-11-08.md`, nivel 10): la tabla de qué se ve y qué NO según las dimensiones que cambian lo que sale al papel,
 * escrita aparte del código (a mano, no derivada de `armarFichaDeCocina`). `ficha-de-cocina.test.tsx` recorre TODAS las combinaciones contra esta tabla.
 */
export type Origen = "PROPIA" | "CENTRAL";
export interface Combinacion {
  origen: Origen;
  fichaTecnica: "con" | "sin";
  sustitutos: "con" | "sin";
  pasos: "con" | "sin";
}

export const DIMENSIONES = {
  origen: ["PROPIA", "CENTRAL"],
  fichaTecnica: ["con", "sin"],
  sustitutos: ["con", "sin"],
  pasos: ["con", "sin"],
} as const;

/** Los textos fijos de la maqueta de los datos de prueba (la milanesa), que la tabla nombra tal cual. */
export const VERSION_DE = { PROPIA: 4, CENTRAL: 7 } as const;

/** Lo que el papel NUNCA lleva, sea cual sea la combinación (el dueño pidió: sin costos, precios, merma ni sustitutos; sin controles de edición). */
export const NUNCA = ["Merma", "merma", "Peceto", "Sustitut", "$", "Costo", "Precio", "Editar", "Quitar", "<a ", "<button", "<form", "<input"];

export function esperado(c: Combinacion): { presentes: string[]; ausentes: string[] } {
  const presentes = [
    "Milanesa con papas fritas",
    `Versión ${VERSION_DE[c.origen]} · ${c.origen === "PROPIA" ? "receta propia de la sucursal" : "receta central"}`,
    "Sucursal Norte · Impresa el 08/11/2026 12:10",
    "Bife de nalga",
    "0,22",
    "kg",
    "Huevo",
    "Sal fina",
    "0,005",
  ];
  const ausentes: string[] = [];

  if (c.fichaTecnica === "con") {
    presentes.push("Rendimiento", "1 unidad", "Raciones", "Tamaño de ración", "450 g", "Preparación", "25 min", "Cocción", "15 min");
    presentes.push("Comentarios", "Presentación o emplatado", "Equipamiento necesario", "Notas adicionales", "Freidora", "plancha de apanar", "bandeja gastronorm");
    ausentes.push("Ficha técnica: pendiente de completar.");
  } else {
    presentes.push("Ficha técnica: pendiente de completar.");
    ausentes.push("Rendimiento", "Raciones", "Tamaño de ración", "Preparación", "Cocción", "Comentarios", "Presentación o emplatado", "Equipamiento necesario", "Notas adicionales");
  }

  if (c.pasos === "con") {
    presentes.push("Método de preparación", "1. Apanar", "10 min", "2. Freír", "Ingredientes: Huevo, Sal fina, Pan rallado.");
    ausentes.push("Pasos: pendiente de completar.");
  } else {
    presentes.push("Método de preparación", "Pasos: pendiente de completar.");
    ausentes.push("1. Apanar", "2. Freír");
  }
  return { presentes, ausentes };
}

/**
 * Cada columna de `RecetaVersion` y de `RecetaIngrediente` (y de `RecetaPaso`), declarada: ¿afecta a lo que se imprime? Un guardián (en el test) falla si aparece una columna nueva sin
 * declarar acá: decidir si va al papel es una decisión, no un olvido.
 */
export const COLUMNAS_DE_RECETA_VERSION: Record<string, "imprime" | "no-imprime"> = {
  id: "no-imprime",
  empresaId: "no-imprime",
  productoId: "no-imprime",
  version: "imprime",
  creadoEn: "no-imprime",
  sucursalId: "no-imprime",
  basadaEnVersionId: "no-imprime",
  rendimientoCantidad: "imprime",
  rendimientoUnidadId: "imprime",
  racionesCantidad: "imprime",
  racionTamano: "imprime",
  racionUnidadId: "imprime",
  tiempoPreparacionMinutos: "imprime",
  tiempoCoccionMinutos: "imprime",
  comentarios: "imprime",
  presentacionEmplatado: "imprime",
  notasAdicionales: "imprime",
  equipamientoNecesario: "imprime",
};

export const COLUMNAS_DE_RECETA_INGREDIENTE: Record<string, "imprime" | "no-imprime"> = {
  id: "no-imprime",
  empresaId: "no-imprime",
  recetaVersionId: "no-imprime",
  insumoProductoId: "imprime",
  cantidad: "imprime",
  unidadId: "imprime",
  mermaPorcentaje: "no-imprime",
  observaciones: "no-imprime",
};

export const COLUMNAS_DE_RECETA_PASO: Record<string, "imprime" | "no-imprime"> = {
  id: "no-imprime",
  empresaId: "no-imprime",
  recetaVersionId: "no-imprime",
  orden: "imprime",
  nombre: "imprime",
  instruccion: "imprime",
  minutos: "imprime",
};
