import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/**
 * Lector MÍNIMO de un .xlsx para el importador del catálogo (docs/diseno-importador-de-catalogo-2026-10-28.md, §8 y E1.1). Sin librerías nuevas: un .xlsx es un zip de XML, se abre con
 * `fflate` (ya en las dependencias) y se leen SOLO las celdas con valor de cada hoja. No interpreta estilos, fechas, fórmulas ni nada que el importador no use:
 *  - texto (`inlineStr`, cadena compartida `s` y el resultado guardado de una fórmula de texto `str`) → `texto`, tal cual (sin recortar: eso lo decide el normalizador);
 *  - número (`n` o sin tipo) → `numero`, con el TEXTO exacto de `<v>` (nunca se pasa por `number`: el dinero se convierte a centavos desde el texto);
 *  - booleano (`b`) → `booleano`;
 *  - una celda con fórmula y SIN valor guardado, o un error de Excel (`e`), no se inventa: queda como PROBLEMA (hoja, celda, motivo), que el normalizador vuelve error de la fila.
 * Topes (un archivo hostil no tumba el proceso): tamaño del archivo, cantidad de entradas del zip y tamaño descomprimido declarado de lo que se lee; solo se descomprimen las
 * entradas que hacen falta (el libro, sus relaciones, las cadenas compartidas y las hojas).
 *
 * Vive en `scripts/` (no en `src/`): lo usa solo el comando de un solo uso `scripts/importar-catalogo.ts` (decisión D1 del dueño: no hay pantalla de importación).
 */

/** Tope del archivo .xlsx (el catálogo real pesa ~50 KB). */
export const TOPE_DEL_ARCHIVO_EN_BYTES = 10 * 1024 * 1024;
/** Tope de lo que se descomprime en total (el catálogo real: ~430 KB). */
export const TOPE_DESCOMPRIMIDO_EN_BYTES = 50 * 1024 * 1024;
/** Tope de entradas del zip (un libro normal tiene una docena). */
export const TOPE_DE_ENTRADAS_DEL_ZIP = 500;

export type CeldaLeida = { tipo: "texto"; valor: string } | { tipo: "numero"; valor: string } | { tipo: "booleano"; valor: boolean };

export interface FilaLeida {
  /** Número de fila de Excel (1 = la primera). */
  numero: number;
  /** Columna (0 = A) → celda con valor. Las celdas vacías no están. */
  celdas: ReadonlyMap<number, CeldaLeida>;
}

export interface HojaLeida {
  nombre: string;
  /** Solo las filas con alguna celda con valor, en orden. */
  filas: readonly FilaLeida[];
}

export interface ProblemaDeLectura {
  hoja: string;
  /** Referencia de la celda (`B7`). */
  celda: string;
  motivo: string;
}

export interface LibroLeido {
  hojas: readonly HojaLeida[];
  problemas: readonly ProblemaDeLectura[];
}

/** Un archivo que no se puede leer como libro (no es un zip, excede un tope, le falta el libro): el comando se detiene sin vista previa. */
export class ErrorDeLectura extends Error {}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Las entidades de XML (`&amp;`, `&#237;`, `&#xED;`). */
function desescapar(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (entera, cuerpo: string) => {
    if (cuerpo.startsWith("#x")) return String.fromCodePoint(Number.parseInt(cuerpo.slice(2), 16));
    if (cuerpo.startsWith("#")) return String.fromCodePoint(Number.parseInt(cuerpo.slice(1), 10));
    return ENTIDADES[cuerpo] ?? entera;
  });
}

/** Los atributos de una etiqueta de apertura (`<c r="A1" t="s">` → `{ r: "A1", t: "s" }`), con el prefijo de espacio de nombres (`r:id`) tal cual. */
function atributos(etiqueta: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const m of etiqueta.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) salida[m[1]] = desescapar(m[2]);
  return salida;
}

/** El texto de un `<si>` o de un `<is>`: la concatenación de sus `<t>` (con o sin `<r>` de formato), sin los `<rPh>` (la ayuda fonética de Excel no es parte del texto). */
function textoDeElemento(xml: string): string {
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let texto = "";
  for (const m of sinFonetica.matchAll(/<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) texto += desescapar(m[1] ?? "");
  return texto;
}

/** `B7` → columna 1 (A = 0), fila 7. */
function referencia(ref: string): { columna: number; fila: number } | null {
  const m = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref);
  if (!m) return null;
  let columna = 0;
  for (const letra of m[1]) columna = columna * 26 + (letra.charCodeAt(0) - 64);
  return { columna: columna - 1, fila: Number(m[2]) };
}

/** Columna (A = 0) → letras. */
export function letraDeColumna(columna: number): string {
  let n = columna + 1;
  let letras = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/** La ruta, dentro del zip, del destino de una relación del libro (`worksheets/sheet1.xml` o `/xl/worksheets/sheet1.xml`). */
function rutaDelDestino(destino: string): string {
  if (destino.startsWith("/")) return destino.slice(1);
  const partes: string[] = ["xl"];
  for (const parte of destino.split("/")) {
    if (parte === "..") partes.pop();
    else if (parte !== "." && parte !== "") partes.push(parte);
  }
  return partes.join("/");
}

/** Abre el zip descomprimiendo SOLO lo que `quiero` acepta, con los topes de entradas y de tamaño declarado. */
function abrirZip(bytes: Uint8Array, quiero: (nombre: string) => boolean): Record<string, Uint8Array> {
  let entradas = 0;
  let declarado = 0;
  let excedido: string | null = null;
  const filtro = (info: UnzipFileInfo) => {
    entradas += 1;
    if (entradas > TOPE_DE_ENTRADAS_DEL_ZIP) excedido ??= `el archivo tiene más de ${TOPE_DE_ENTRADAS_DEL_ZIP} entradas`;
    if (!quiero(info.name)) return false;
    declarado += info.originalSize;
    if (declarado > TOPE_DESCOMPRIMIDO_EN_BYTES) excedido ??= `descomprimido supera ${TOPE_DESCOMPRIMIDO_EN_BYTES} bytes`;
    return excedido === null;
  };
  let archivos: Record<string, Uint8Array>;
  try {
    archivos = unzipSync(bytes, { filter: filtro });
  } catch {
    throw new ErrorDeLectura("El archivo no es un .xlsx válido (no se pudo abrir como zip).");
  }
  if (excedido) throw new ErrorDeLectura(`El archivo excede un tope de lectura: ${excedido}.`);
  const real = Object.values(archivos).reduce((suma, a) => suma + a.length, 0);
  if (real > TOPE_DESCOMPRIMIDO_EN_BYTES) throw new ErrorDeLectura(`El archivo excede un tope de lectura: descomprimido supera ${TOPE_DESCOMPRIMIDO_EN_BYTES} bytes.`);
  return archivos;
}

/** Las celdas con valor de una hoja (y sus problemas: fórmula sin valor guardado, error de Excel, referencia ilegible). */
function leerHoja(nombre: string, xml: string, compartidas: readonly string[], problemas: ProblemaDeLectura[]): HojaLeida {
  const filas: FilaLeida[] = [];
  const datos = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
  let numeroDeFila = 0;
  for (const mf of datos.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = atributos(mf[1]).r;
    numeroDeFila = r && /^\d+$/.test(r) ? Number(r) : numeroDeFila + 1;
    const celdas = new Map<number, CeldaLeida>();
    let columna = -1;
    for (const mc of (mf[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = atributos(mc[1]);
      const ref = attr.r ? referencia(attr.r) : null;
      if (attr.r && !ref) {
        problemas.push({ hoja: nombre, celda: attr.r, motivo: "referencia de celda ilegible" });
        continue;
      }
      columna = ref ? ref.columna : columna + 1;
      const etiqueta = attr.r ?? `${letraDeColumna(columna)}${numeroDeFila}`;
      const cuerpo = mc[2] ?? "";
      const valor = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      const tieneFormula = /<f\b/.test(cuerpo);
      const tipo = attr.t ?? "n";
      if (tipo === "inlineStr") {
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cuerpo)?.[1];
        if (is !== undefined) {
          const texto = textoDeElemento(is);
          if (texto !== "") celdas.set(columna, { tipo: "texto", valor: texto });
        } else if (tieneFormula) problemas.push({ hoja: nombre, celda: etiqueta, motivo: "celda con fórmula sin valor guardado" });
        continue;
      }
      if (valor === undefined) {
        if (tieneFormula) problemas.push({ hoja: nombre, celda: etiqueta, motivo: "celda con fórmula sin valor guardado" });
        continue;
      }
      if (tipo === "s") {
        const indice = Number(valor);
        const texto = Number.isInteger(indice) ? compartidas[indice] : undefined;
        if (texto === undefined) problemas.push({ hoja: nombre, celda: etiqueta, motivo: "cadena compartida inexistente" });
        else if (texto !== "") celdas.set(columna, { tipo: "texto", valor: texto });
      } else if (tipo === "str") {
        const texto = desescapar(valor);
        if (texto !== "") celdas.set(columna, { tipo: "texto", valor: texto });
      } else if (tipo === "b") {
        if (valor === "1" || valor === "0") celdas.set(columna, { tipo: "booleano", valor: valor === "1" });
        else problemas.push({ hoja: nombre, celda: etiqueta, motivo: `booleano ilegible: ${valor}` });
      } else if (tipo === "e") {
        problemas.push({ hoja: nombre, celda: etiqueta, motivo: `error de Excel en la celda: ${desescapar(valor)}` });
      } else if (tipo === "n" || tipo === "d") {
        const texto = desescapar(valor).trim();
        if (texto !== "") celdas.set(columna, { tipo: "numero", valor: texto });
      } else {
        problemas.push({ hoja: nombre, celda: etiqueta, motivo: `tipo de celda desconocido: ${tipo}` });
      }
    }
    if (celdas.size > 0) filas.push({ numero: numeroDeFila, celdas });
  }
  return { nombre, filas };
}

/**
 * Lee un .xlsx: las hojas (en el orden del libro, por su nombre) con sus celdas con valor, y los problemas por celda. Lanza `ErrorDeLectura` si el archivo no se puede leer como libro
 * (no es un zip, excede un tope, le falta el libro o una hoja declarada).
 */
export function leerXlsx(bytes: Uint8Array): LibroLeido {
  if (bytes.length > TOPE_DEL_ARCHIVO_EN_BYTES) throw new ErrorDeLectura(`El archivo pesa más de ${TOPE_DEL_ARCHIVO_EN_BYTES} bytes.`);
  const necesarios = (nombre: string) => nombre === "xl/workbook.xml" || nombre === "xl/_rels/workbook.xml.rels" || nombre === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(nombre);
  const zip = abrirZip(bytes, necesarios);
  const libro = zip["xl/workbook.xml"];
  const relaciones = zip["xl/_rels/workbook.xml.rels"];
  if (!libro || !relaciones) throw new ErrorDeLectura("El archivo no es un .xlsx válido (le falta el libro o sus relaciones).");

  const destinos = new Map<string, string>();
  for (const m of strFromU8(relaciones).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attr = atributos(m[1]);
    if (attr.Id && attr.Target) destinos.set(attr.Id, rutaDelDestino(attr.Target));
  }
  const compartidas: string[] = [];
  const xmlCompartidas = zip["xl/sharedStrings.xml"];
  if (xmlCompartidas) for (const m of strFromU8(xmlCompartidas).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) compartidas.push(textoDeElemento(m[1] ?? ""));

  const problemas: ProblemaDeLectura[] = [];
  const hojas: HojaLeida[] = [];
  for (const m of strFromU8(libro).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attr = atributos(m[1]);
    const id = attr["r:id"] ?? Object.entries(attr).find(([k]) => k.endsWith(":id"))?.[1];
    const ruta = id ? destinos.get(id) : undefined;
    const xml = ruta ? zip[ruta] : undefined;
    if (!attr.name || !xml) throw new ErrorDeLectura(`El libro declara la hoja «${attr.name ?? "?"}» y no se encontró su contenido.`);
    hojas.push(leerHoja(attr.name, strFromU8(xml), compartidas, problemas));
  }
  return { hojas, problemas };
}
