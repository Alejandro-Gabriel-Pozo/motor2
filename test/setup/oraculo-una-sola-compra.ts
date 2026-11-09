import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Lector del oráculo de «una sola compra» (`docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA (no copia ningún resultado esperado).
 * Lo usan el test exhaustivo de las reglas puras, el de integración por pares y el guardián de columnas declaradas.
 */
const RUTA_DEL_ORACULO = join(__dirname, "../../docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md");

export interface TablaDelOraculo {
  columnas: string[];
  filas: Record<string, string>[];
}

function celdas(linea: string): string[] {
  return linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** La primera tabla markdown que sigue al encabezado `## <prefijo>…`. */
export function tablaDelOraculo(prefijo: string, texto: string = readFileSync(RUTA_DEL_ORACULO, "utf8")): TablaDelOraculo {
  const lineas = texto.split("\n");
  const inicio = lineas.findIndex((l) => l.startsWith("## ") && l.slice(3).startsWith(prefijo));
  if (inicio < 0) throw new Error(`El oráculo no tiene la sección «${prefijo}».`);
  let i = inicio + 1;
  while (i < lineas.length && !lineas[i]!.trim().startsWith("|")) i++;
  const tabla: string[][] = [];
  while (i < lineas.length && lineas[i]!.trim().startsWith("|")) tabla.push(celdas(lineas[i++]!));
  const [columnas, , ...filas] = tabla;
  if (!columnas) throw new Error(`La sección «${prefijo}» no trae una tabla.`);
  return { columnas, filas: filas.map((f) => Object.fromEntries(columnas.map((c, k) => [c, f[k] ?? ""]))) };
}

/** Producto cartesiano de los valores declarados de cada dimensión (claves en el orden dado). */
export function productoCartesiano(dimensiones: Record<string, readonly string[]>): Record<string, string>[] {
  return Object.entries(dimensiones).reduce<Record<string, string>[]>(
    (acc, [clave, valores]) => acc.flatMap((fila) => valores.map((v) => ({ ...fila, [clave]: v }))),
    [{}],
  );
}

/** Los valores declarados de cada dimensión en «Dimensiones que cambian el resultado» (letra en negrita → lista de valores). */
export function dimensionesDelOraculo(): Record<string, string[]> {
  const tabla = tablaDelOraculo("Dimensiones que cambian el resultado");
  const salida: Record<string, string[]> = {};
  for (const f of tabla.filas) {
    const letra = /\*\*(\w+)\*\*/.exec(f["Dimensión"] ?? "")?.[1];
    if (letra) salida[letra] = (f["Valores"] ?? "").split(",").map((v) => v.trim());
  }
  return salida;
}
