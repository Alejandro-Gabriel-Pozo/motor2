import writeXlsxFile from "write-excel-file/node";
import { ENCABEZADOS, HOJA_CATALOGO, HOJA_INCONSISTENCIAS, HOJA_LEEME, HOJA_PRECIOS, HOJA_PRODUCTOS } from "../../../src/core/features/catalogo/importacion/normalizar";
import { LOCALES_DEL_IMPORTADOR, type CeldaDeEntrada, type CorreccionesDelDueno, type LibroDeEntrada, type LocalDelImportador } from "../../../src/core/features/catalogo/importacion/tipos";

/**
 * Fixtures del importador del catálogo: un catálogo chico descripto en TypeScript que se convierte en el libro que devuelve el lector (`libroDesde`, para las pruebas puras) o en un
 * .xlsx real armado con `write-excel-file` (`xlsxDesde`, para las pruebas del lector y de integración). Nunca un binario en el repositorio, nunca los precios reales del Excel del dueño.
 */
export interface ProductoDeFixtura {
  sku: string;
  categoria: string;
  base: string;
  variantes?: string[];
  marca?: string;
  /** Local → precio entero (o `null` = fila sin precio). Un local ausente no tiene fila. */
  precios: Partial<Record<LocalDelImportador, number | null>>;
  /** Local → disponible; por defecto TRUE donde hay fila. */
  disponible?: Partial<Record<LocalDelImportador, boolean>>;
  nombreEnCarta?: string;
  descripcion?: Partial<Record<LocalDelImportador, string>>;
}

type Valor = string | number | boolean | null;

/** Las filas (con encabezado) de cada hoja, como valores de celda. */
export function hojasDesde(productos: readonly ProductoDeFixtura[], inconsistencias: [string, string, string][] = []): Record<string, Valor[][]> {
  const catalogo: Valor[][] = [[...ENCABEZADOS[HOJA_CATALOGO]]];
  const precios: Valor[][] = [[...ENCABEZADOS[HOJA_PRECIOS]]];
  const pares = new Map<string, Valor[]>();
  for (const p of productos) {
    const v = p.variantes ?? [];
    const conPrecio = Object.values(p.precios).filter((x): x is number => typeof x === "number");
    catalogo.push([
      p.sku,
      p.categoria,
      p.base,
      v[0] ?? null,
      v[1] ?? null,
      v[2] ?? null,
      p.marca ?? null,
      ...LOCALES_DEL_IMPORTADOR.map((l) => p.precios[l] ?? null),
      conPrecio.length ? Math.min(...conPrecio) : null,
      conPrecio.length ? Math.max(...conPrecio) : null,
      new Set(conPrecio).size > 1 ? "TRUE" : "FALSE",
      null,
    ]);
    for (const local of LOCALES_DEL_IMPORTADOR) {
      if (!(local in p.precios)) continue;
      const disponible = p.disponible?.[local] ?? true;
      precios.push([p.sku, p.base, local, p.precios[local] ?? null, disponible ? "TRUE" : "FALSE", p.nombreEnCarta ?? null, p.descripcion?.[local] ?? null]);
    }
    pares.set(`${p.categoria}|${p.base}`, [p.categoria, p.base, v[0] ? "Eje 1" : null, v[1] ? "Eje 2" : null, v[2] ? "Eje 3" : null, 1, 1, "x"]);
  }
  return {
    [HOJA_LEEME]: [["Cómo leer este archivo"]],
    [HOJA_PRODUCTOS]: [[...ENCABEZADOS[HOJA_PRODUCTOS]], ...pares.values()],
    [HOJA_CATALOGO]: catalogo,
    [HOJA_PRECIOS]: precios,
    [HOJA_INCONSISTENCIAS]: [[...ENCABEZADOS[HOJA_INCONSISTENCIAS]], ...inconsistencias],
  };
}

function celdaDe(v: Valor): CeldaDeEntrada | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") return { tipo: "numero", valor: String(v) };
  if (typeof v === "boolean") return { tipo: "booleano", valor: v };
  return { tipo: "texto", valor: v };
}

/** El libro tal como lo devolvería el lector (filas numeradas desde 1, solo celdas con valor). */
export function libroDeHojas(hojas: Record<string, Valor[][]>): LibroDeEntrada {
  return {
    hojas: Object.entries(hojas).map(([nombre, filas]) => ({
      nombre,
      filas: filas
        .map((fila, i) => ({ numero: i + 1, celdas: new Map(fila.flatMap((v, col) => (celdaDe(v) ? [[col, celdaDe(v)!] as const] : []))) }))
        .filter((f) => f.celdas.size > 0),
    })),
    problemas: [],
  };
}

export const libroDesde = (productos: readonly ProductoDeFixtura[]) => libroDeHojas(hojasDesde(productos));

/** El mismo catálogo como un .xlsx real (con `write-excel-file`). */
export async function xlsxDesde(productos: readonly ProductoDeFixtura[]): Promise<Uint8Array> {
  const hojas = hojasDesde(productos);
  const buffer = await writeXlsxFile(Object.entries(hojas).map(([sheet, filas]) => ({ sheet, data: filas.map((fila) => fila.map((v) => (v === null ? null : v))) }))).toBuffer();
  return new Uint8Array(buffer);
}

/** El mapeo de secciones de la ADENDA A.2 (el de `scripts/importacion/correcciones.ejemplo.json`). */
export const MAPEO_DE_LA_ADENDA: Readonly<Record<string, string | null>> = {
  Entradas: "Entrada",
  "Platos Principales": "Platos principales",
  Clásicos: "Clásicos",
  "Pastas Caseras": "Pastas caseras",
  Pizzas: "Pizzas",
  Postres: "Postres",
  "Bebidas sin alcohol": "Bebidas",
  "Bebidas con alcohol": "Bebidas",
  "Vinos Neuquinos": "Bebidas",
  Tragos: "Bebidas",
  "Jugos y Licuados": "Bebidas",
  Minutas: null,
  "Menú Infantil": null,
  Viandas: null,
  Confitería: null,
};

export const REGLA_ACEPTADA: CorreccionesDelDueno["reglaDePrecioUnico"] = { regla: "MAS_FRECUENTE_Y_SI_EMPATAN_EL_MAYOR", fecha: "2026-10-28", motivo: "Decisión del dueño (fixture)" };

export function correccionesDe(parcial: Partial<CorreccionesDelDueno> = {}): CorreccionesDelDueno {
  return { reglaDePrecioUnico: REGLA_ACEPTADA, correcciones: [], mapeoDeSecciones: MAPEO_DE_LA_ADENDA, ...parcial };
}
