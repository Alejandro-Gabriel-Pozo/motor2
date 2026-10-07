import "server-only";
import { claveDeUnidadDeSustituto, type CabeceraRecetaInput, type DatosParaValidarReceta, type IngredienteInput } from "@/core/catalogo/public";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public";
import { MAXIMO_INGREDIENTES_RECETA, MAXIMO_SUSTITUTOS_POR_INGREDIENTE } from "@/core/datos/limites";
import { validarUnidadInsumo } from "@/server/lecturas/catalogo/unidad-de-insumo";
import type { Db } from "@/lib/db-tipos";

const esTexto = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Lee, EN LOTE, lo que `validarIngredientes` y `validarCabecera` (core, puras) necesitan saber del catálogo: los productos de los ingredientes, cuáles están disponibles
 * en alguna sucursal, los insumos sustitutos y las unidades de la cabecera. Cuatro consultas, sin importar cuántos ingredientes tenga la receta (antes: dos por
 * ingrediente y una por cada sustituto). Más una `validarUnidadInsumo` por cada par (sustituto, unidad), que solo corre con sustitutos declarados.
 *
 * Se acota a los topes de entrada (`MAXIMO_INGREDIENTES_RECETA`, `MAXIMO_SUSTITUTOS_POR_INGREDIENTE`): una lista más larga la rechaza la validación pura ANTES de mirar
 * estos datos, así que acá no se leen. Los ids que no son texto se ignoran (la validación los reporta como «no es una MP»). Solo lectura; sin guarda: la pone el caso de uso.
 */
export async function cargarDatosParaValidarReceta(db: Db, items: readonly IngredienteInput[], cabecera: CabeceraRecetaInput): Promise<DatosParaValidarReceta> {
  const acotados = items.slice(0, MAXIMO_INGREDIENTES_RECETA);
  const productoIds = [...new Set(acotados.map((i) => i.insumoProductoId).filter(esTexto))];
  const sustitutoIds = [...new Set(acotados.flatMap((i) => (i.insumoSustitutoIds ?? []).slice(0, MAXIMO_SUSTITUTOS_POR_INGREDIENTE)).filter(esTexto))];
  const unidadIds = [...new Set([cabecera.rendimientoUnidadId, cabecera.racionUnidadId].filter(esTexto))];

  const [productos, disponibles, insumos, unidades] = await Promise.all([
    productoIds.length ? db.producto.findMany({ where: { id: { in: productoIds } }, select: { id: true, nombre: true, tipo: true, insumoId: true, unidadStockId: true } }) : [],
    productoIds.length ? db.producto.findMany({ where: { id: { in: productoIds }, ...whereDisponibleEnAlguna() }, select: { id: true } }) : [],
    sustitutoIds.length ? db.insumo.findMany({ where: { id: { in: sustitutoIds } }, select: { id: true, nombre: true, activo: true } }) : [],
    unidadIds.length ? db.unidad.findMany({ where: { id: { in: unidadIds } }, select: { id: true, nombre: true, decimales: true } }) : [],
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));

  // El mensaje de unidad de cada par (sustituto, unidad del ingrediente): la misma regla de siempre, `validarUnidadInsumo`.
  const mensajeDeUnidadDeSustituto = new Map<string, string | null>();
  for (const item of acotados) {
    const mp = productoPorId.get(item.insumoProductoId);
    if (!mp) continue;
    for (const sustitutoId of (item.insumoSustitutoIds ?? []).slice(0, MAXIMO_SUSTITUTOS_POR_INGREDIENTE).filter(esTexto)) {
      const clave = claveDeUnidadDeSustituto(sustitutoId, mp.unidadStockId);
      if (!mensajeDeUnidadDeSustituto.has(clave)) mensajeDeUnidadDeSustituto.set(clave, await validarUnidadInsumo(sustitutoId, mp.unidadStockId, undefined, db));
    }
  }

  return {
    productos: productoPorId,
    disponiblesEnAlguna: new Set(disponibles.map((p) => p.id)),
    insumos: new Map(insumos.map((i) => [i.id, { nombre: i.nombre, activo: i.activo }])),
    mensajeDeUnidadDeSustituto,
    unidades: new Map(unidades.map((u) => [u.id, { nombre: u.nombre, decimales: u.decimales }])),
  };
}
