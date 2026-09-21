/**
 * E4 — memoria por usuario de los últimos valores usados en el ALTA de un producto (docs/planes-implementacion-pendientes-2026-09-21.md §2).
 *
 * Este módulo es PURO: sin base de datos, sin `server-only`, sin React. Define la forma de lo que se recuerda, cómo se lee de un valor no
 * confiable y cómo se sanea contra las listas que el formulario le muestra al usuario. Dónde se guarda vive aparte
 * (`memoria-alta-producto-almacen.ts`), que es el único archivo que sabe de la base.
 *
 * QUÉ se recuerda: tipo, categoría, unidad de stock, unidad de compra y factor de conversión.
 * QUÉ NO, a propósito:
 *  - nombre y código (identifican a UN producto: repetirlos choca con «ya existe» y con la unicidad del código);
 *  - precios (dinero: arrastrar el de otro producto es un error caro y silencioso);
 *  - observaciones, consignación y «se produce» (cambian el modelo de negocio del producto);
 *  - insumo: es la clave de agrupación (comparte stock y precios entre productos), así que arrastrarlo agruparía en silencio productos sin
 *    relación, y es el campo que va a proponer la sugerencia por nombre (E3);
 *  - «Uso»: se eliminó a propósito, se deriva del tipo (`usoDeTipo`).
 */

export const CLAVE_MEMORIA_ALTA_PRODUCTO = "alta_producto";

export type TipoRecordado = "MP" | "PV";

export interface MemoriaAltaProducto {
  /** Versión de la forma. Una versión desconocida se descarta como si no existiera memoria. */
  v: 1;
  tipo: TipoRecordado;
  categoriaId: string | null;
  unidadStockId: string | null;
  unidadCompraId: string | null;
  factorConversion: number | null;
}

/** Lo mínimo que hace falta de lo que se acaba de dar de alta (estructural: no depende de la Server Action). */
export interface AltaRecordable {
  tipo: TipoRecordado;
  categoriaId?: string | null;
  unidadStockId: string;
  unidadCompraId?: string | null;
  factorConversion: number;
}

/** Las listas que el formulario le dibuja al usuario: la memoria nunca propone algo que no podría elegir a mano. */
export interface OpcionesValidas {
  unidades: ReadonlyArray<{ id: string }>;
  categorias: ReadonlyArray<{ id: string }>;
}

const LARGO_MAXIMO_ID = 64;

export function memoriaDesdeAlta(datos: AltaRecordable): MemoriaAltaProducto {
  return {
    v: 1,
    tipo: datos.tipo,
    categoriaId: datos.categoriaId || null,
    unidadStockId: datos.unidadStockId || null,
    unidadCompraId: datos.unidadCompraId || null,
    factorConversion: Number.isFinite(datos.factorConversion) && datos.factorConversion > 0 ? datos.factorConversion : null,
  };
}

function idOpcional(crudo: unknown): string | null | undefined {
  if (crudo === null || crudo === undefined) return null;
  if (typeof crudo !== "string" || crudo.length === 0 || crudo.length > LARGO_MAXIMO_ID) return undefined;
  return crudo;
}

/**
 * Lee una memoria de un valor no confiable (JSON de la base, o una cookie manipulada a mano). NUNCA lanza: cualquier cosa que no tenga la forma
 * exacta devuelve `null`, y la pantalla de alta abre como si no hubiera memoria.
 */
export function parsearMemoria(crudo: unknown): MemoriaAltaProducto | null {
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) return null;
  const o = crudo as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.tipo !== "MP" && o.tipo !== "PV") return null;

  const categoriaId = idOpcional(o.categoriaId);
  const unidadStockId = idOpcional(o.unidadStockId);
  const unidadCompraId = idOpcional(o.unidadCompraId);
  if (categoriaId === undefined || unidadStockId === undefined || unidadCompraId === undefined) return null;

  let factorConversion: number | null = null;
  if (o.factorConversion !== null && o.factorConversion !== undefined) {
    if (typeof o.factorConversion !== "number" || !Number.isFinite(o.factorConversion) || o.factorConversion <= 0) return null;
    factorConversion = o.factorConversion;
  }

  return { v: 1, tipo: o.tipo, categoriaId, unidadStockId, unidadCompraId, factorConversion };
}

/**
 * Deja solo lo que hoy se podría elegir a mano. Una categoría o unidad que ya no está en las listas (borrada, desactivada) queda vacía y el
 * resto de la memoria SÍ se aplica.
 *
 * El factor de conversión no significa nada suelto («unidades de stock por unidad de compra»): solo sobrevive junto con SU par de unidades. Si
 * alguna de las dos ya no existe, se descarta (el formulario cae al 1 de siempre); si no, «25» (una bolsa de 25 kg) se colaría en un alta con
 * otras unidades.
 *
 * Devuelve `null` si no queda nada que valga la pena precargar (para no dibujar el aviso «Precargado…» ni el botón «Olvidar» sin motivo).
 */
export function sanearMemoria(memoria: MemoriaAltaProducto, opciones: OpcionesValidas): MemoriaAltaProducto | null {
  const unidades = new Set(opciones.unidades.map((u) => u.id));
  const categorias = new Set(opciones.categorias.map((c) => c.id));

  const categoriaId = memoria.categoriaId && categorias.has(memoria.categoriaId) ? memoria.categoriaId : null;
  const unidadStockId = memoria.unidadStockId && unidades.has(memoria.unidadStockId) ? memoria.unidadStockId : null;
  const unidadCompraId = memoria.unidadCompraId && unidades.has(memoria.unidadCompraId) ? memoria.unidadCompraId : null;
  const factorConversion = unidadStockId && unidadCompraId ? memoria.factorConversion : null;

  const sanea: MemoriaAltaProducto = { v: 1, tipo: memoria.tipo, categoriaId, unidadStockId, unidadCompraId, factorConversion };

  // El tipo solo no es memoria si es el de siempre (MP): no hay nada distinto que precargar.
  const hayAlgo = categoriaId || unidadStockId || unidadCompraId || factorConversion !== null || memoria.tipo !== "MP";
  return hayAlgo ? sanea : null;
}
