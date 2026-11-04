import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lector del oráculo de combinaciones del número de factura único (Compras, etapa 1): `docs/oraculo-combinaciones-compras-etapa-1-2026-11-03.md`. La tabla de reglas vive APARTE del código; este archivo solo la
 * PARSEA (no copia ningún resultado esperado). Lo usan el test que recorre las 32 combinaciones contra la base y el guardián de dimensiones declaradas.
 */
const RUTA_DEL_ORACULO = join(__dirname, "../../docs/oraculo-combinaciones-compras-etapa-1-2026-11-03.md");

export interface OraculoDeComprobante {
  /** Dimensión (la letra en negrita de la primera columna) → sus valores declarados, en orden. */
  dimensiones: Record<string, string[]>;
  /** Encabezados de la tabla de enumeración. */
  columnas: string[];
  /** Cada fila de la enumeración, por columna. */
  filas: Record<string, string>[];
  /** Primera columna de «Dimensiones que NO cambian el resultado». */
  noAfectan: string[];
}

function celdas(linea: string): string[] {
  return linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Las líneas de la primera tabla markdown que sigue al encabezado `## <prefijo>…` (sin la fila de encabezado ni la de guiones). */
function tablaBajo(lineas: string[], prefijo: string): { encabezado: string[]; filas: string[][] } {
  const inicio = lineas.findIndex((l) => l.startsWith("## ") && l.slice(3).startsWith(prefijo));
  if (inicio < 0) throw new Error(`El oráculo no tiene la sección «${prefijo}».`);
  let i = inicio + 1;
  while (i < lineas.length && !lineas[i]!.trim().startsWith("|")) i++;
  const tabla: string[][] = [];
  while (i < lineas.length && lineas[i]!.trim().startsWith("|")) tabla.push(celdas(lineas[i++]!));
  const [encabezado, , ...filas] = tabla;
  if (!encabezado) throw new Error(`La sección «${prefijo}» no trae una tabla.`);
  return { encabezado, filas };
}

export function leerOraculoDeComprobante(texto: string = readFileSync(RUTA_DEL_ORACULO, "utf8")): OraculoDeComprobante {
  const lineas = texto.split("\n");

  const dims = tablaBajo(lineas, "Dimensiones que cambian el resultado");
  const dimensiones: Record<string, string[]> = {};
  for (const fila of dims.filas) {
    const letra = /\*\*([^*]+)\*\*/.exec(fila[0] ?? "")?.[1];
    if (!letra) throw new Error(`Fila de dimensión sin letra en negrita: ${fila.join(" | ")}`);
    dimensiones[letra] = [...(fila[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  }

  const enumeracion = tablaBajo(lineas, "Enumeración");
  const filas = enumeracion.filas.map((f) => Object.fromEntries(enumeracion.encabezado.map((col, k) => [col, f[k] ?? ""])));

  const noAfectan = tablaBajo(lineas, "Dimensiones que NO cambian el resultado").filas.map((f) => f[0] ?? "");

  return { dimensiones, columnas: enumeracion.encabezado, filas, noAfectan };
}
