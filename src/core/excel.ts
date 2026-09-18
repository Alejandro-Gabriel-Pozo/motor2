import writeExcelFile from "write-excel-file/universal";

/**
 * Export a Excel (.xlsx) de las tablas de reporte. Reemplaza al export CSV:
 * un CSV depende de la configuración regional de cada PC (separador de
 * columnas y decimal), y no hay un formato que abra bien en todas — con `;` y
 * coma decimal, un Excel configurado con `,` de separador y `.` decimal abría
 * todo en una sola columna. En un .xlsx los números viajan como números y cada
 * Excel los muestra con su propia configuración.
 *
 * Es también la defensa contra inyección de fórmulas: una celda `String` se
 * guarda como texto y no se evalúa aunque empiece con `=`, `+`, `-` o `@`
 * (solo las celdas de tipo `'Formula'`, que acá nunca se generan, son fórmulas).
 * Ver docs/grounding-pendientes-2026-09-18.md §7.4.
 */
export type CeldaExcel = string | number | null | undefined;

export const TIPO_MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ANCHO_MINIMO = 8;
const ANCHO_MAXIMO = 60;

/** Máximo de caracteres por celda de Excel. La librería no lo valida: una celda más larga genera un archivo que Excel rechaza o "repara". */
const LIMITE_CELDA = 32767;

/**
 * Excel no admite `[ ] : * ? / \` en el nombre de una hoja, ni más de 31 caracteres,
 * ni un apóstrofo al principio o al final (y `'` está permitido en los nombres de catálogo).
 */
export function nombreDeHoja(nombre: string): string {
  const limpio = nombre
    .replace(/[[\]:*?/\\]/g, " ")
    .trim()
    .slice(0, 31)
    .replace(/^'+|'+$/g, "")
    .trim();
  return limpio || "Reporte";
}

/** Nombre de archivo seguro: sin los caracteres que Windows no admite (`\ / : * ? " < > |`). Los `nombreExport` incluyen datos de usuario (categoría, proveedor). */
export function nombreDeArchivo(nombre: string): string {
  const limpio = nombre.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 120);
  return limpio || "reporte";
}

function celda(valor: CeldaExcel) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? { value: valor, type: Number } : null;
  return { value: valor.length > LIMITE_CELDA ? `${valor.slice(0, LIMITE_CELDA - 1)}…` : valor, type: String };
}

function largo(valor: CeldaExcel): number {
  return valor === null || valor === undefined ? 0 : String(valor).length;
}

/** Una hoja: encabezado en negrita, un `number` como número, todo lo demás como texto, y ancho de columna según el contenido. */
export async function generarExcel(nombreHoja: string, etiquetas: string[], filas: CeldaExcel[][]): Promise<Blob> {
  const cabecera = etiquetas.map((etiqueta) => ({ value: etiqueta, type: String, fontWeight: "bold" as const }));
  const columnas = etiquetas.map((etiqueta, i) => {
    const mayor = Math.max(largo(etiqueta), ...filas.map((fila) => largo(fila[i])));
    return { width: Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, mayor + 2)) };
  });
  return writeExcelFile([cabecera, ...filas.map((fila) => fila.map(celda))], { sheet: nombreDeHoja(nombreHoja), columns: columnas }).toBlob();
}
