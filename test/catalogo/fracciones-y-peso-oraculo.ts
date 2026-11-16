/**
 * ORÁCULO de fracciones y peso (docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md, §12: O1 a O6, O15 a O18, O21 a O27): las
 * reglas esperadas ESCRITAS APARTE del código. NO importa la lógica de `src/core/catalogo/fracciones-y-peso.ts` ni de
 * `conversion-de-paso-libre.ts`, solo TIPOS: la aritmética de acá es con BigInt sobre el TEXTO decimal, no con los enteros del núcleo.
 */
import type { FormaDeVenta, MotivoDeCantidad } from "@/core/catalogo/fracciones-y-peso";

/** Texto decimal (hasta 4 decimales) → diezmilésimos en BigInt. Solo para los textos del oráculo (todos bien formados). */
const CIEN_MIL = BigInt(10000); // BigInt(…) y no el literal 10000n: el objetivo de TypeScript del proyecto es anterior a ES2020
const CERO = BigInt(0);
const TOPE = BigInt(9990000);

export function enDiezmilesimos(texto: string): bigint {
  const negativo = texto.startsWith("-");
  const [entera, decimales = ""] = texto.replace("-", "").split(".");
  const n = BigInt(entera!) * CIEN_MIL + BigInt(decimales.padEnd(4, "0"));
  return negativo ? -n : n;
}

/** Los pasos de las formas del recorrido, escritos como texto. */
function pasoEsperado(forma: FormaDeVenta): string | null {
  switch (forma.tipo) {
    case "UNIDAD":
      return "1";
    case "FRACCIONES":
      return { 2: "0.5", 4: "0.25", 8: "0.125" }[Math.max(...forma.porciones) as 2 | 4 | 8];
    case "PESO":
    case "PASO_LIBRE":
      return String(forma.paso / 10000);
    default:
      return null;
  }
}

/** Qué se espera al vender `cantidad` (texto) con `forma`: «permitido» o el motivo. Cada regla lleva su id del diseño. */
export function esperadoDeVender(forma: FormaDeVenta, cantidad: string, perillaEncendida: boolean): { regla: string; esperado: "permitido" | MotivoDeCantidad } {
  if (!/^\d+(\.\d{1,4})?$/.test(cantidad) && !/^-\d+(\.\d{1,4})?$/.test(cantidad)) return { regla: "R-texto", esperado: "CANTIDAD_INVALIDA" };
  const c = enDiezmilesimos(cantidad);
  if (c <= CERO || c > TOPE) return { regla: "O6", esperado: "CANTIDAD_FUERA_DE_RANGO" }; // ≤ 0 o > 999
  const paso = pasoEsperado(forma);
  if (paso === null) return { regla: "R-masa-sin-paso", esperado: "permitido" };
  if (forma.tipo === "PASO_LIBRE" && !perillaEncendida && c % CIEN_MIL !== CERO) return { regla: "I7", esperado: "SOLO_CANTIDADES_ENTERAS" };
  return c % enDiezmilesimos(paso) === CERO ? { regla: "O1/O3/O5", esperado: "permitido" } : { regla: "O2/O4/O5", esperado: "NO_ES_MULTIPLO_DEL_PASO" };
}

/** Casos escritos a mano con números concretos (los del diseño). */
export const CASOS_DEL_DISENO: ReadonlyArray<{ id: string; forma: FormaDeVenta; cantidad: string; perilla: boolean; esperado: "permitido" | MotivoDeCantidad }> = [
  { id: "O1", forma: { tipo: "FRACCIONES", porciones: [2] }, cantidad: "0.5", perilla: true, esperado: "permitido" },
  { id: "O1", forma: { tipo: "FRACCIONES", porciones: [2] }, cantidad: "1", perilla: true, esperado: "permitido" },
  { id: "O1", forma: { tipo: "FRACCIONES", porciones: [2] }, cantidad: "1.5", perilla: true, esperado: "permitido" },
  { id: "O2", forma: { tipo: "FRACCIONES", porciones: [2] }, cantidad: "0.25", perilla: true, esperado: "NO_ES_MULTIPLO_DEL_PASO" },
  { id: "O3", forma: { tipo: "FRACCIONES", porciones: [2, 8] }, cantidad: "0.125", perilla: true, esperado: "permitido" },
  { id: "O3", forma: { tipo: "FRACCIONES", porciones: [2, 8] }, cantidad: "0.25", perilla: true, esperado: "permitido" },
  { id: "O3", forma: { tipo: "FRACCIONES", porciones: [2, 8] }, cantidad: "0.625", perilla: true, esperado: "permitido" },
  { id: "O4", forma: { tipo: "FRACCIONES", porciones: [2, 8] }, cantidad: "0.3", perilla: true, esperado: "NO_ES_MULTIPLO_DEL_PASO" },
  { id: "O5", forma: { tipo: "PESO", paso: 10 }, cantidad: "0.35", perilla: true, esperado: "permitido" },
  { id: "O5", forma: { tipo: "PESO", paso: 10 }, cantidad: "0.3504", perilla: true, esperado: "NO_ES_MULTIPLO_DEL_PASO" },
  { id: "O6", forma: { tipo: "UNIDAD" }, cantidad: "0", perilla: true, esperado: "CANTIDAD_FUERA_DE_RANGO" },
  { id: "O6", forma: { tipo: "UNIDAD" }, cantidad: "1000", perilla: true, esperado: "CANTIDAD_FUERA_DE_RANGO" },
  { id: "O6", forma: { tipo: "FRACCIONES", porciones: [8] }, cantidad: "999.0001", perilla: true, esperado: "CANTIDAD_FUERA_DE_RANGO" },
  { id: "O16", forma: { tipo: "FRACCIONES", porciones: [2, 4] }, cantidad: "0.25", perilla: false, esperado: "permitido" },
  { id: "O16", forma: { tipo: "PESO", paso: 10 }, cantidad: "0.350", perilla: false, esperado: "permitido" },
  { id: "I7", forma: { tipo: "PASO_LIBRE", paso: 2000 }, cantidad: "0.4", perilla: false, esperado: "SOLO_CANTIDADES_ENTERAS" },
  { id: "I7", forma: { tipo: "PASO_LIBRE", paso: 2000 }, cantidad: "2", perilla: false, esperado: "permitido" },
  { id: "I7", forma: { tipo: "PASO_LIBRE", paso: 2000 }, cantidad: "0.4", perilla: true, esperado: "permitido" },
  { id: "I7", forma: { tipo: "PASO_LIBRE", paso: 2000 }, cantidad: "0.3", perilla: true, esperado: "NO_ES_MULTIPLO_DEL_PASO" },
];

/**
 * Conversión (E1b, O21 a O27), como TABLA de paso (texto) → resultado esperado para un producto de conteo sin fracciones.
 * `propuesta` es la porción; para los exactos coincide con el paso.
 */
export const CASOS_DE_CONVERSION: ReadonlyArray<{ id: string; paso: string | null; resultado: "NADA" | "AUTOMATICA" | "PENDIENTE_CON_PROPUESTA" | "PENDIENTE_SIN_PROPUESTA"; porcion?: 2 | 4 | 8 }> = [
  { id: "sin paso", paso: null, resultado: "NADA" },
  { id: "paso 1", paso: "1", resultado: "NADA" },
  { id: "O21", paso: "0.5", resultado: "AUTOMATICA", porcion: 2 },
  { id: "O21", paso: "0.25", resultado: "AUTOMATICA", porcion: 4 },
  { id: "O21", paso: "0.125", resultado: "AUTOMATICA", porcion: 8 },
  { id: "O22", paso: "0.2", resultado: "PENDIENTE_CON_PROPUESTA", porcion: 4 }, // 0,05 contra 0,075
  { id: "O23", paso: "0.1", resultado: "PENDIENTE_CON_PROPUESTA", porcion: 8 },
  { id: "O23", paso: "0.0625", resultado: "PENDIENTE_CON_PROPUESTA", porcion: 8 },
  { id: "O23", paso: "0.0001", resultado: "PENDIENTE_CON_PROPUESTA", porcion: 8 },
  { id: "O24", paso: "0.3", resultado: "PENDIENTE_SIN_PROPUESTA" },
  { id: "O24", paso: "0.6", resultado: "PENDIENTE_SIN_PROPUESTA" },
  { id: "O24", paso: "0.9999", resultado: "PENDIENTE_SIN_PROPUESTA" },
  { id: "O24", paso: "1.5", resultado: "PENDIENTE_SIN_PROPUESTA" },
  { id: "O24", paso: "0", resultado: "PENDIENTE_SIN_PROPUESTA" },
];

/** Empates de distancia (O25): un paso a mitad de camino entre dos fracciones va a la MÁS FINA. */
export const EMPATES: ReadonlyArray<{ paso: string; porcion: 4 | 8 }> = [
  { paso: "0.375", porcion: 4 }, // entre ½ y ¼
  { paso: "0.1875", porcion: 8 }, // entre ¼ y ⅛
];
