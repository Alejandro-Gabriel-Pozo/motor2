/**
 * Tipos del importador del catálogo unificado (docs/diseno-importador-de-catalogo-2026-10-28.md, con su ADENDA v2). Todo el núcleo del importador es PURO: recibe lo que leyó el
 * lector de .xlsx (`scripts/importacion/leer-xlsx.ts`, que tiene la MISMA forma por estructura) y el estado de la base que leyó el caso de uso, y devuelve datos.
 */

/** Los 5 locales del Excel, con su nombre EXACTO (el de `Sucursal.nombre`). Lista cerrada (ADR-028): nunca «todas»; Oficinas NQNTUR no vende y no recibe filas. */
export const LOCALES_DEL_IMPORTADOR = ["Huinganco", "Los Miches", "Varvarco", "Manzano Amargo", "Las Ovejas"] as const;
export type LocalDelImportador = (typeof LOCALES_DEL_IMPORTADOR)[number];

export function esLocalDelImportador(valor: string): valor is LocalDelImportador {
  return (LOCALES_DEL_IMPORTADOR as readonly string[]).includes(valor);
}

// ── Entrada: lo que leyó el lector (misma forma que `LibroLeido` de `scripts/importacion/leer-xlsx.ts`) ──

export type CeldaDeEntrada = { tipo: "texto"; valor: string } | { tipo: "numero"; valor: string } | { tipo: "booleano"; valor: boolean };

export interface LibroDeEntrada {
  hojas: readonly { nombre: string; filas: readonly { numero: number; celdas: ReadonlyMap<number, CeldaDeEntrada> }[] }[];
  problemas: readonly { hoja: string; celda: string; motivo: string }[];
}

// ── Errores y avisos ──

/** Un error bloqueante (I1): invalida toda la importación. Con hoja, fila, columna y valor cuando vienen de una celda (I8). */
export interface ErrorDeImportacion {
  hoja: string | null;
  fila: number | null;
  columna: string | null;
  valor: string | null;
  sku: string | null;
  codigo: string;
  motivo: string;
}

/** Un aviso: no bloquea (I1), se muestra en la vista previa. */
export interface AvisoDeImportacion {
  tipo: string;
  sku: string | null;
  detalle: string;
}

// ── Correcciones nominales del dueño (A.1) ──

export interface CorreccionDePrecioUnico {
  tipo: "precioUnico";
  sku: string;
  /** local → precio entero en pesos, tal como lo trae HOY el Excel (si cambia, la corrección no se aplica: es error, I12). */
  preciosEnElExcel: Readonly<Partial<Record<LocalDelImportador, number>>>;
  valorACargar: number;
  fecha: string;
  motivo: string;
}

export interface CorreccionDeNombre {
  tipo: "nombre";
  sku: string;
  valorEnElExcel: string;
  valorACargar: string;
  fecha: string;
  motivo: string;
}

export type CorreccionNominal = CorreccionDePrecioUnico | CorreccionDeNombre;

/** La única regla de precio único que existe (decisión del dueño del 2026-10-28): el precio más frecuente entre los locales y, si empatan, el mayor. */
export const REGLA_MAS_FRECUENTE_Y_EL_MAYOR = "MAS_FRECUENTE_Y_SI_EMPATAN_EL_MAYOR";

export interface CorreccionesDelDueno {
  /** Presente = el dueño aceptó la regla (con fecha y motivo); ausente = los SKU con precios distintos sin corrección son error (NO CONFIRMABLE). */
  reglaDePrecioUnico: { regla: typeof REGLA_MAS_FRECUENTE_Y_EL_MAYOR; fecha: string; motivo: string } | null;
  correcciones: readonly CorreccionNominal[];
  /** Categoría del Excel → nombre EXACTO de la `SeccionCarta`, o `null` = sin sección (no va a la carta). */
  mapeoDeSecciones: Readonly<Record<string, string | null>>;
}

// ── Salida del normalizador ──

export interface ProductoNormalizado {
  /** Número de fila del SKU en «Catálogo»: es el orden en la carta (A.2). */
  fila: number;
  sku: string;
  categoria: string;
  base: string;
  variantes: readonly string[];
  marca: string | null;
  /** Base + variantes no vacías, sin repetir la base (4.3). */
  nombreEnElExcel: string;
  /** El que se carga: el del Excel o el de una corrección `nombre`. */
  nombre: string;
  nombreCorregido: boolean;
}

export type DescripcionDeCarta = { estado: "AUSENTE" } | { estado: "VALIDA"; valor: string } | { estado: "INVALIDA"; texto: string; mensaje: string };

export interface FilaDePrecioNormalizada {
  /** Número de fila en «Precios por local». */
  fila: number;
  sku: string;
  local: LocalDelImportador;
  /** En centavos (entero → centavos desde el TEXTO de la celda, nunca por `number`); `null` = la fila no trae precio. */
  precioCentavos: bigint | null;
  disponible: boolean;
  nombreEnCarta: string | null;
  descripcion: DescripcionDeCarta;
}

export interface CatalogoNormalizado {
  productos: readonly ProductoNormalizado[];
  filas: readonly FilaDePrecioNormalizada[];
  correcciones: CorreccionesDelDueno;
  /** SKU → precio a cargar (centavos) de una corrección `precioUnico` que coincidió con el Excel. */
  preciosUnicosCorregidos: ReadonlyMap<string, { centavos: bigint; correccion: CorreccionDePrecioUnico }>;
  /** Filas de la hoja «Inconsistencias» del Excel, tal cual (se copian a los avisos). */
  inconsistenciasDelExcel: readonly { tipo: string; sku: string; detalle: string }[];
  errores: readonly ErrorDeImportacion[];
  avisos: readonly AvisoDeImportacion[];
}
