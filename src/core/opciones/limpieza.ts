/**
 * «LIMPIAR» las opciones de venta (OPCIONES-LIMPIEZA, G2; decisión del dueño, 2026-10-14: achicar la carta sin dejar ruido). PURO: qué grupos y qué opciones EN USO son
 * candidatos a archivarse según un criterio, y a cuántos productos afecta lo elegido (la vista previa). Lo usa la pantalla `/catalogo/opciones/limpiar`, que recibe los datos ya
 * leídos por el servidor (la consulta `listarCandidatosALimpiar`, con la lectura de verificación en toda la empresa). Archivar es el caso de uso `archivarOpciones` (todo o nada);
 * acá nada escribe.
 *
 * Reglas:
 *  - «Sin productos»: un grupo que ningún producto disponible usa; dentro de un grupo usado, una opción que ningún producto admite.
 *  - «Sin ventas en N días» (30, 90 o 180): un grupo del que no se vendió NINGUNA opción en ese período (o que no tiene opciones); dentro de un grupo con ventas, una opción que no se
 *    vendió en ese período.
 *  - Si un grupo es candidato, sus opciones no se listan aparte: archivar el grupo ya las saca a todas de la venta.
 */

export const CRITERIOS_DE_LIMPIEZA = ["SIN_PRODUCTOS", "SIN_VENTAS_30", "SIN_VENTAS_90", "SIN_VENTAS_180"] as const;
export type CriterioDeLimpieza = (typeof CRITERIOS_DE_LIMPIEZA)[number];

/** Si hubo alguna venta (una línea con esa opción elegida) en los últimos 30, 90 y 180 días. */
export interface VentasRecientes {
  d30: boolean;
  d90: boolean;
  d180: boolean;
}

export interface OpcionParaLimpiar {
  id: string;
  nombre: string;
  /** Los productos (disponibles en alguna sucursal) que admiten la opción, con el grupo vinculado. */
  productoIds: readonly string[];
  ventas: VentasRecientes;
}

export interface GrupoParaLimpiar {
  id: string;
  nombre: string;
  /** Los productos (disponibles en alguna sucursal) que usan el grupo. */
  productoIds: readonly string[];
  opciones: readonly OpcionParaLimpiar[];
}

interface CandidatosDeLimpieza<G extends GrupoParaLimpiar = GrupoParaLimpiar> {
  grupos: G[];
  /** Las opciones candidatas de grupos que NO son candidatos, con su grupo. */
  opciones: { grupo: G; opcion: OpcionParaLimpiar }[];
}

const sinVentas = (v: VentasRecientes, criterio: Exclude<CriterioDeLimpieza, "SIN_PRODUCTOS">): boolean =>
  criterio === "SIN_VENTAS_30" ? !v.d30 : criterio === "SIN_VENTAS_90" ? !v.d90 : !v.d180;

/** Los candidatos a archivar según el criterio, en el orden en que llegan los grupos y sus opciones. */
export function candidatosALimpiar<G extends GrupoParaLimpiar>(grupos: readonly G[], criterio: CriterioDeLimpieza): CandidatosDeLimpieza<G> {
  const grupoEsCandidato = (g: G) => (criterio === "SIN_PRODUCTOS" ? g.productoIds.length === 0 : g.opciones.every((o) => sinVentas(o.ventas, criterio)));
  const opcionEsCandidata = (o: OpcionParaLimpiar) => (criterio === "SIN_PRODUCTOS" ? o.productoIds.length === 0 : sinVentas(o.ventas, criterio));
  const salida: CandidatosDeLimpieza<G> = { grupos: [], opciones: [] };
  for (const g of grupos) {
    if (grupoEsCandidato(g)) salida.grupos.push(g);
    else for (const o of g.opciones) if (opcionEsCandidata(o)) salida.opciones.push({ grupo: g, opcion: o });
  }
  return salida;
}

/** La vista previa: los productos (sin repetir) que dejan de ofrecer algo si se archiva lo elegido. */
export function productosAfectados(grupos: readonly GrupoParaLimpiar[], eleccion: { grupoIds: ReadonlySet<string>; opcionIds: ReadonlySet<string> }): string[] {
  const afectados = new Set<string>();
  for (const g of grupos) {
    if (eleccion.grupoIds.has(g.id)) for (const p of g.productoIds) afectados.add(p);
    for (const o of g.opciones) if (eleccion.opcionIds.has(o.id)) for (const p of o.productoIds) afectados.add(p);
  }
  return [...afectados].sort();
}
