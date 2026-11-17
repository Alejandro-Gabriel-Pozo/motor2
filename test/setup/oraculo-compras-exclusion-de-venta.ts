import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de la exclusión de los depósitos de cuarentena y rechazo en la venta, etapa (ii-a) (`docs/oraculo-combinaciones-compras-exclusion-de-venta-2026-11-17.md`). La tabla de reglas vive APARTE del código; este archivo solo la PARSEA
 * (no copia ningún resultado esperado). Lo usan el recorrido contra la base real y el guardián de dimensiones declaradas.
 */
const TEXTO_DEL_ORACULO = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-compras-exclusion-de-venta-2026-11-17.md"), "utf8");

export const dimensionesDeExclusionDeVenta = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO);
export const tablaDeExclusionDeVenta = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO);
export { productoCartesiano };
