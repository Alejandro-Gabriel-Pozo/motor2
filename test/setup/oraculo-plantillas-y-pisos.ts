import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dimensionesDelOraculo, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de plantillas y pisos (`docs/oraculo-combinaciones-plantillas-y-pisos-2026-11-17.md`; regla de combinaciones del 2026-10-28). Las tablas viven APARTE del código: este archivo solo las PARSEA (reutiliza el
 * lector del oráculo de «una sola compra»), no copia ningún resultado esperado.
 */
const TEXTO = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-plantillas-y-pisos-2026-11-17.md"), "utf8");

export const dimensionesDelOraculoDePlantillas = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO);
export const tablaDelOraculoDePlantillas = (prefijo: string): TablaDelOraculo => tablaDelOraculo(prefijo, TEXTO);

/** El texto crudo del oráculo (el guardián de dimensiones comprueba que cada dimensión «que no cambia» tenga motivo). */
export const textoDelOraculoDePlantillas = (): string => TEXTO;
