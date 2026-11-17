import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de la guarda de apagado de la recepción separada (`docs/oraculo-combinaciones-compras-guarda-de-apagado-2026-11-17.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA (no copia ningún resultado
 * esperado). Lo usan el test exhaustivo contra la base real y el guardián de dimensiones declaradas. Reutiliza el lector de `oraculo-una-sola-compra.ts`.
 */
const RUTA_DEL_ORACULO_DE_LA_GUARDA = join(__dirname, "../../docs/oraculo-combinaciones-compras-guarda-de-apagado-2026-11-17.md");
const TEXTO_DEL_ORACULO_DE_LA_GUARDA = readFileSync(RUTA_DEL_ORACULO_DE_LA_GUARDA, "utf8");

export const dimensionesDeLaGuarda = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO_DE_LA_GUARDA);
export const tablaDeLaGuarda = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO_DE_LA_GUARDA);
export { productoCartesiano };

type FilaDeApagado = { V: string; P: string; L: string; A: string; Resultado: string; Rastro: string };
type FilaDeCarga = { "Módulo de la empresa": string; "Estado de la parte que se inserta": string; Resultado: string };

export const filasDeApagado = (): FilaDeApagado[] => tablaDeLaGuarda("Qué pasa al pedir el cambio").filas as FilaDeApagado[];
export const filasDeCarga = (): FilaDeCarga[] => tablaDeLaGuarda("Cargar una parte pendiente").filas as FilaDeCarga[];
