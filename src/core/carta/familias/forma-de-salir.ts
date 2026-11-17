import { claveDeNombreDeCarta } from "../nombre-en-carta";

/**
 * «Forma de salir» de una familia de productos en la carta (docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md, §9; Pedernal, maqueta aprobada `familias.html`). PURA: sin base, sin reloj, sin Prisma ni React.
 * La forma es DERIVADA, no se guarda: se calcula cada vez con lo que hay. Rige la carta (etapa F4) y la ficha de gestión; el servidor NO decide cómo se ve una familia en pantalla.
 *
 * Cuatro formas (lista CERRADA):
 *  - `SUELTOS`: cada producto en su línea (la familia no se agrupa).
 *  - `UNA_LINEA`: una línea con el nombre de la familia y el precio (productos sin medidas y todos al mismo precio).
 *  - `TABLA`: filas = productos, columnas = medidas (hasta {@link MAXIMO_DE_COLUMNAS_DE_TABLA} medidas distintas).
 *  - `LISTA`: uno por línea con sus precios (más de {@link MAXIMO_DE_COLUMNAS_DE_TABLA} medidas distintas).
 *
 * Las reglas, en orden (la primera que se cumple decide; TODO NACE CERRADO: ante lo que no es exactamente lo permitido, `SUELTOS`):
 *  1. «Agrupar en la carta» apagado, o la familia desactivada → `SUELTOS` (los interruptores nacen apagados: nada se agrupa si no se declara).
 *  2. Un producto oculto, desactivado o sin precio queda FUERA de la fila; si quedan menos de dos → `SUELTOS` (una familia con un solo producto no se agrupa).
 *  3. D7 (sin sección propia): si los productos que quedan no están todos en la misma sección → `SUELTOS`.
 *  4. Ningún producto con medidas: todos al mismo precio → `UNA_LINEA`; con precios distintos → `SUELTOS`.
 *  5. Algunos con medidas y otros sin → `SUELTOS` (un producto sin medidas en una familia con medidas).
 *  6. Todos con medidas pero ninguna en común (se comparan POR NOMBRE, sin distinguir mayúsculas ni tildes) → `SUELTOS`.
 *  7. Hasta 3 medidas distintas en total → `TABLA`; más de 3 → `LISTA`.
 *
 * SUPUESTO declarado (el dueño lo corrige): «con precio» es un número finito MAYOR que cero (el precio de venta de Motor2 nace en 0: cero es «todavía sin precio» y no se muestra ni se inventa). Esta
 * función no mira cuánto vale cada celda de la tabla: eso es el precio por medida de cada producto (etapa F4).
 */

/** Las formas de salir permitidas, en la lista cerrada. */
export const FORMAS_DE_SALIR = ["SUELTOS", "UNA_LINEA", "TABLA", "LISTA"] as const;
export type FormaDeSalir = (typeof FORMAS_DE_SALIR)[number];

/** Hasta cuántas medidas distintas entran en una tabla (en un celular, más columnas de precios no caben en una fila). */
export const MAXIMO_DE_COLUMNAS_DE_TABLA = 3;

/** Un miembro VIGENTE de la familia, tal como lo ve la carta de UNA sucursal. */
export interface MiembroParaLaForma {
  /** El precio del producto en la sucursal; `null` = sin precio. */
  precio: number | null;
  /** Oculto en la sucursal (la regla única `ocultoPor`). */
  oculto: boolean;
  /** Desactivado en la sucursal (no disponible). */
  desactivado: boolean;
  /** La sección de la carta de la sucursal en la que está el producto. */
  seccionCartaId: string;
  /** Los nombres de las medidas que ofrece (grupo de tipo MEDIDA); vacío = sin medidas. */
  medidas: readonly string[];
}

export interface EntradaDeLaForma {
  agruparEnCarta: boolean;
  activa: boolean;
  miembros: readonly MiembroParaLaForma[];
}

const conPrecio = (precio: unknown): boolean => typeof precio === "number" && Number.isFinite(precio) && precio > 0;

/** La forma en que sale la familia en la carta de una sucursal. Una sola regla, un solo lugar: la carta y la ficha no vuelven a escribirla. */
export function formaDeSalir(entrada: EntradaDeLaForma): FormaDeSalir {
  if (entrada.agruparEnCarta !== true || entrada.activa !== true) return "SUELTOS";
  const enLaFila = entrada.miembros.filter((m) => m.oculto === false && m.desactivado === false && conPrecio(m.precio));
  if (enLaFila.length < 2) return "SUELTOS";
  if (new Set(enLaFila.map((m) => m.seccionCartaId)).size > 1) return "SUELTOS";

  const medidasDe = enLaFila.map((m) => new Set(m.medidas.map(claveDeNombreDeCarta).filter((nombre) => nombre !== "")));
  const conMedidas = medidasDe.filter((s) => s.size > 0).length;
  if (conMedidas === 0) return new Set(enLaFila.map((m) => m.precio)).size === 1 ? "UNA_LINEA" : "SUELTOS";
  if (conMedidas < enLaFila.length) return "SUELTOS";

  const enComun = [...medidasDe[0]].filter((nombre) => medidasDe.every((s) => s.has(nombre)));
  if (enComun.length === 0) return "SUELTOS";
  return new Set(medidasDe.flatMap((s) => [...s])).size <= MAXIMO_DE_COLUMNAS_DE_TABLA ? "TABLA" : "LISTA";
}
