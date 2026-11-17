import { formatearMonto } from "@/core/formato-de-numero";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { prorratearPrecioPromo } from "./promo-combo";

/**
 * «Reparto del precio» de una promo (pedido del dueño 2026-11-17 vía el orquestador: «Te confirmo 3 y 4 como sí…», la 3; modelo: la maqueta de Pedernal `combos__armado.png`, «Barbacoa $ 11.408,45 (Lista $ 12.000,00)»).
 * SOLO LECTURA, detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`: no escribe nada. PURO: sin Prisma ni reloj.
 *
 * No hay un prorrateo propio: reparte `prorratearPrecioPromo` (`core/pos/promo-combo.ts`, el MISMO que congela el precio al vender: proporcional al precio de lista, mayor residuo, piso de $ 0,01 por unidad).
 * Vive en `core/pos/` (junto al prorrateo que reusa) y NO importa nada de la carta: así no forma ciclos nuevos con la fachada de la carta (test `dependencias.test.ts`, «sin-ciclos»).
 *
 * Para el ejemplo, cada parte usa su PRIMER producto disponible (el que lee `server/consultas/carta/reparto-de-las-promos.ts` con la regla del POS) y su cantidad: la exacta N, o la MÁXIMA si la parte
 * quedó cargada con rango (el peor caso, el mismo que usa el piso de la promo). Si ALGUNA parte no tiene producto disponible NO se reparte y se avisa cuáles (orquestador, 2026-11-17: «todo nace cerrado», no se estima: repartir solo entre las demás sobrestimaría la parte de cada una).
 */

/** Una parte de la promo con el producto de ejemplo ya elegido por la lectura (`null` = ninguno disponible hoy). */
export interface ParteParaRepartir {
  /** El nombre de la sección o del lugar («Entrada», «Bebidas»). */
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** El primer producto disponible de la parte y su precio de LISTA unitario (sin descuento de producto); `null` si no hay. */
  ejemplo: { nombre: string; precioLista: number } | null;
}

/** Una fila a mostrar: lo que le toca de la promo a TODAS las unidades de la parte y su precio de lista (cantidad × lista unitario). */
export interface FilaDelReparto {
  parte: string;
  producto: string;
  cantidad: number;
  /** Lo que le toca del precio de la promo (suma de sus unidades). */
  reparto: number;
  /** El precio de lista de sus unidades (cantidad × lista unitario). */
  lista: number;
}

export type RepartoDelPrecio =
  | { tipo: "ok"; filas: FilaDelReparto[]; /** Alguna parte quedó con rango y se usó su máximo. */ usaMaximo: boolean }
  | { tipo: "sin-productos" }
  /** Algunas partes (no todas) no tienen producto disponible: no se reparte, para no estimar. */
  | { tipo: "incompleto"; sinProducto: string[] }
  | { tipo: "error"; mensaje: string };

/** El texto fijo de abajo del reparto (el de la maqueta de Pedernal). */
export const TEXTO_DEL_REPARTO = "Se reparte en proporción al precio de lista. Para el ejemplo se usa el primer producto disponible de cada elección.";
export const TEXTO_SIN_PRODUCTOS = "Sin productos disponibles para el ejemplo";
/** Cuando falta producto en alguna parte: no se reparte (no se estima). */
export const TEXTO_NO_SE_REPARTE = "No se puede mostrar el reparto: no hay producto disponible para el ejemplo en";

export function repartoDelPrecioDeLaPromo(precioPromo: number, partes: readonly ParteParaRepartir[]): RepartoDelPrecio {
  const conProducto = partes.flatMap((p) => (p.ejemplo !== null && Number.isInteger(p.cantidadMaxima) && p.cantidadMaxima > 0 ? [{ p, ejemplo: p.ejemplo, cantidad: p.cantidadMaxima }] : []));
  if (!conProducto.length) return { tipo: "sin-productos" };
  if (conProducto.length < partes.length) return { tipo: "incompleto", sinProducto: partes.filter((p) => !conProducto.some((c) => c.p === p)).map((p) => p.nombre) };
  // La clave es la posición: dos partes con el mismo producto no se mezclan.
  const r = prorratearPrecioPromo(
    precioPromo,
    conProducto.map((c, i) => ({ productoId: c.ejemplo.nombre, cantidad: c.cantidad, precioCarta: c.ejemplo.precioLista, claveComponente: String(i) })),
  );
  if (!r.ok) return { tipo: "error", mensaje: r.mensaje };
  const filas = conProducto.map((c, i) => ({
    parte: c.p.nombre,
    producto: c.ejemplo.nombre,
    cantidad: c.cantidad,
    reparto: redondearMoneda(r.filas.filter((f) => f.claveComponente === String(i)).reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0)),
    lista: importeDeLinea(c.cantidad, c.ejemplo.precioLista),
  }));
  return { tipo: "ok", filas, usaMaximo: partes.some((p) => p.cantidadMinima !== p.cantidadMaxima) };
}

/** Una fila en una línea, como la maqueta: «Barbacoa $ 11.408,45 (Lista $ 12.000,00)»; con más de una unidad, «2 × Barbacoa …» (reparto y lista de las dos). */
export function textoDeLaFilaDelReparto(f: FilaDelReparto): string {
  return `${f.cantidad > 1 ? `${f.cantidad} × ` : ""}${f.producto} ${formatearMonto(f.reparto)} (Lista ${formatearMonto(f.lista)})`;
}
