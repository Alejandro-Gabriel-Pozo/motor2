import type { ProductoParaEntrada } from "./admin-tipos";

/**
 * Armar el LUGAR de una promo en la administración (etapa N1, PR B, docs/diseno-promo-subconjunto-2026-11-04.md §11 nivel 8 y decisión 5): cada lugar LISTA elige su ORIGEN (una sección de la carta o «no
 * está en la carta»), la pantalla muestra los productos de venta de ese origen para TILDAR y de cada uno tildado se define su configuración fija o «el mozo elige» (casillas de opciones permitidas por
 * grupo). PURO: sin lecturas ni escrituras; la pantalla arma con esto el comando de `agregarEntradaDeCupo` (que valida todo de nuevo en el servidor).
 *
 * El origen es solo la FUENTE para tildar, no una regla viva: no se guarda en ningún lado (el lugar sigue siendo una LISTA con sus entradas) y un producto nuevo del origen no entra solo.
 */

/** El origen «no está en la carta» (los demás orígenes son el id de una sección). El vacío es «todavía no elegí el origen». */
export const ORIGEN_FUERA_DE_LA_CARTA = "FUERA";

/** El tope de unidades por opción que manda la entrada «a elegir»: el máximo que admite la base (1 a 10). La promo no pone un número propio: mandan los límites del grupo y del producto. */
const TOPE_DE_UNIDADES_POR_OPCION_PERMITIDA = 10;

/** Qué se define de un producto tildado: configuración fija (una opción por grupo de una sola elección) o «el mozo elige» (las opciones permitidas). */
export interface BorradorDeProducto {
  modo: "FIJAS" | "A_ELEGIR";
  /** Modo `FIJAS`: grupo → opción elegida. */
  fijas: Record<string, string>;
  /** Modo `A_ELEGIR`: las opciones tildadas (id → true). */
  permitidas: Record<string, boolean>;
}

/** El origen de un producto: el id de su sección o `ORIGEN_FUERA_DE_LA_CARTA`. */
function origenDeProducto(p: Pick<ProductoParaEntrada, "seccionCartaId">): string {
  return p.seccionCartaId ?? ORIGEN_FUERA_DE_LA_CARTA;
}

/** Los productos de un origen (vacío = ninguno: primero se elige el origen). */
export function productosDelOrigen(productos: readonly ProductoParaEntrada[], origen: string): ProductoParaEntrada[] {
  if (origen === "") return [];
  return productos.filter((p) => origenDeProducto(p) === origen);
}

/**
 * El origen con el que abre un lugar que ya tiene opciones: el de TODOS sus productos si coinciden; si no hay ninguno, o vienen de orígenes distintos, queda sin elegir (no se inventa un origen).
 */
export function origenInferido(productoIdsEnLaLista: readonly string[], productos: readonly ProductoParaEntrada[]): string {
  const porId = new Map(productos.map((p) => [p.productoId, p] as const));
  const origenes = new Set(productoIdsEnLaLista.flatMap((id) => (porId.has(id) ? [origenDeProducto(porId.get(id)!)] : [])));
  return origenes.size === 1 ? [...origenes][0]! : "";
}

/** Las opciones tildables de «el mozo elige»: las de los grupos que no son adicionales (un adicional recarga y rompe el precio fijo de la promo). */
function gruposTildables(p: ProductoParaEntrada) {
  return p.gruposAElegir.filter((g) => !g.adicional && g.opciones.length > 0);
}

/** ¿Tiene algo para configurar? (grupos de una sola elección para la configuración fija, o grupos para «el mozo elige»). */
export function tieneOpciones(p: ProductoParaEntrada): boolean {
  return p.grupos.length > 0 || gruposTildables(p).length > 0;
}

/**
 * El borrador con el que se abre un producto recién tildado: si tiene un grupo OBLIGATORIO (no adicional) abre en «el mozo elige» con todas sus opciones tildadas (hay que mirarlas y destildar lo que no
 * va: nada entra sin que se vea); si no, abre fijo y sin opciones (lo de siempre).
 */
export function borradorInicial(p: ProductoParaEntrada): BorradorDeProducto {
  const hayObligatorio = gruposTildables(p).some((g) => g.cantidadMinima > 0);
  const permitidas: Record<string, boolean> = {};
  for (const g of gruposTildables(p)) for (const o of g.opciones) permitidas[o.opcionId] = true;
  return { modo: hayObligatorio ? "A_ELEGIR" : "FIJAS", fijas: {}, permitidas };
}

type ComandoDeProductoTildado = { ok: true; modoDeOpciones: "FIJAS" | "A_ELEGIR"; opciones: { opcionId: string; cantidad: number }[] } | { ok: false; motivo: string };

/**
 * Lo que se manda al servidor por un producto tildado. Fijo: una opción por grupo (los obligatorios no pueden faltar). «El mozo elige»: las opciones tildadas, nunca de un adicional, con al menos una
 * por cada grupo obligatorio (si no, el producto no se podría armar). Es un adelanto de la comodidad: el servidor lo vuelve a validar y manda.
 */
export function comandoDeProducto(p: ProductoParaEntrada, b: BorradorDeProducto): ComandoDeProductoTildado {
  if (b.modo === "FIJAS") {
    const faltan = p.grupos.filter((g) => g.obligatorio && !b.fijas[g.grupoId]);
    if (faltan.length > 0) return { ok: false, motivo: `Falta elegir: ${faltan.map((g) => g.nombre).join(", ")}.` };
    const opciones = p.grupos.flatMap((g) => (b.fijas[g.grupoId] ? [{ opcionId: b.fijas[g.grupoId]!, cantidad: 1 }] : []));
    return { ok: true, modoDeOpciones: "FIJAS", opciones };
  }
  const grupos = gruposTildables(p);
  const opciones = grupos.flatMap((g) => g.opciones.filter((o) => b.permitidas[o.opcionId]).map((o) => ({ opcionId: o.opcionId, cantidad: TOPE_DE_UNIDADES_POR_OPCION_PERMITIDA })));
  if (opciones.length === 0) return { ok: false, motivo: "Tildá al menos una opción que pueda elegir el mozo." };
  const sinNada = grupos.filter((g) => g.cantidadMinima > 0 && !g.opciones.some((o) => b.permitidas[o.opcionId]));
  if (sinNada.length > 0) return { ok: false, motivo: `Falta tildar al menos una opción de: ${sinNada.map((g) => g.nombre).join(", ")}.` };
  return { ok: true, modoDeOpciones: "A_ELEGIR", opciones };
}

/** Las categorías que hay entre los productos dados, con cuántos son (para el atajo «tildar todos los de la categoría»), por nombre. */
export function categoriasDe(productos: readonly ProductoParaEntrada[]): { id: string; nombre: string; cantidad: number }[] {
  const cuenta = new Map<string, { id: string; nombre: string; cantidad: number }>();
  for (const p of productos) {
    if (!p.categoria) continue;
    const previa = cuenta.get(p.categoria.id);
    cuenta.set(p.categoria.id, { id: p.categoria.id, nombre: p.categoria.nombre, cantidad: (previa?.cantidad ?? 0) + 1 });
  }
  return [...cuenta.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
