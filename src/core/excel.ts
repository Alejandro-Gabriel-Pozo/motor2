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

/**
 * Columna cuyo valor es una fecha en formato ISO y debe exportarse como fecha real de Excel (no como texto):
 * - "dia": `YYYY-MM-DD` (el día tal como lo muestra la pantalla, en UTC).
 * - "fechaHora": un instante ISO (`toISOString()`), que se exporta con la hora LOCAL del navegador, igual que `toLocaleString`.
 */
export type TipoFecha = "dia" | "fechaHora";

const FORMATO_DIA = "dd/mm/yyyy";
const FORMATO_FECHA_HORA = "dd/mm/yyyy hh:mm";
const ANCHO_DIA = 12;
const ANCHO_FECHA_HORA = 18;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La librería convierte una `Date` al número de serie de Excel con el instante en UTC. Un "dia" ya es medianoche UTC, así
 * que el número es entero. Un "fechaHora" se corre por el huso local para que el Excel diga la misma hora que la pantalla.
 * `null` si el texto no es una fecha válida (entonces se exporta como texto).
 */
function comoFecha(valor: string, tipo: TipoFecha): Date | null {
  if (tipo === "dia") {
    if (!RE_DIA.test(valor)) return null;
    const dia = new Date(`${valor}T00:00:00Z`);
    return Number.isNaN(dia.getTime()) ? null : dia;
  }
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return null;
  return new Date(instante.getTime() - instante.getTimezoneOffset() * 60_000);
}

function celda(valor: CeldaExcel, tipoFecha?: TipoFecha) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? { value: valor, type: Number } : null;
  if (tipoFecha) {
    const fecha = comoFecha(valor, tipoFecha);
    if (fecha) return { value: fecha, type: Date, format: tipoFecha === "dia" ? FORMATO_DIA : FORMATO_FECHA_HORA };
  }
  return { value: valor.length > LIMITE_CELDA ? `${valor.slice(0, LIMITE_CELDA - 1)}…` : valor, type: String };
}

function largo(valor: CeldaExcel): number {
  return valor === null || valor === undefined ? 0 : String(valor).length;
}

/**
 * Una hoja: encabezado en negrita, un `number` como número, todo lo demás como texto, y ancho de columna según el contenido.
 * `tiposFecha[i]` marca la columna i como fecha (ver `TipoFecha`): su texto ISO se exporta como fecha real de Excel.
 */
export async function generarExcel(nombreHoja: string, etiquetas: string[], filas: CeldaExcel[][], tiposFecha: (TipoFecha | undefined)[] = []): Promise<Blob> {
  const cabecera = etiquetas.map((etiqueta) => ({ value: etiqueta, type: String, fontWeight: "bold" as const }));
  const columnas = etiquetas.map((etiqueta, i) => {
    if (tiposFecha[i]) return { width: Math.max(ANCHO_MINIMO, largo(etiqueta) + 2, tiposFecha[i] === "dia" ? ANCHO_DIA : ANCHO_FECHA_HORA) };
    const mayor = Math.max(largo(etiqueta), ...filas.map((fila) => largo(fila[i])));
    return { width: Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, mayor + 2)) };
  });
  const cuerpo = filas.map((fila) => fila.map((valor, i) => celda(valor, tiposFecha[i])));
  return writeExcelFile([cabecera, ...cuerpo], { sheet: nombreDeHoja(nombreHoja), columns: columnas }).toBlob();
}
