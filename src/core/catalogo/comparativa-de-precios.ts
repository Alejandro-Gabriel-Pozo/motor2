/**
 * Comparativa de precios por insumo (Catálogo › Proveedores › Comparativa): equivalente de `generarComparativaPreciosPorFamilia_` (Catalogo.js:3528-3562, del proyecto viejo).
 * Una oferta con precio 0 (proveedor conocido, nunca se cargó precio real) NUNCA puede ganar el ranking de «más barato» — bugfix documentado en el propio código viejo
 * (Catalogo.js:3545-3552).
 *
 * Hito 4 de la pureza, paso A5 (O.8a): es el armado que vivía en la Server Action `obtenerComparativaPreciosPorInsumo` (`src/server/actions/catalogo/proveedor-por-producto.ts`),
 * movido TAL CUAL a una función pura (sin Prisma ni reloj) para probarlo sin base: recibe las ofertas del Kardex vigente (`cargarOfertasDeProveedores`), el insumo de cada
 * producto y el nombre de cada proveedor, ya leídos.
 */

/**
 * O.8b (Hito 4, paso A6): el rótulo de una oferta cuyo proveedor no está entre los leídos. Hoy es inalcanzable (la FK de la operación al proveedor es compuesta con la empresa y no
 * hay borrado de proveedores), pero si pasara, la fila diría esto en vez de un nombre vacío (que en la pantalla parecía un proveedor sin nombre). Se eligió rotular y no omitir la
 * oferta (`continue`): el precio sigue siendo una compra real.
 */
const PROVEEDOR_DESCONOCIDO = "(proveedor desconocido)";

/** Lo que la comparativa usa de una oferta (`OfertaDeProveedor` de `server/lecturas/catalogo/ofertas-de-proveedor.ts`, que `core` no importa). */
interface OfertaParaComparar {
  productoId: string;
  proveedorId: string;
  precioPorUnidadStock: number;
  unidadCompraNombre: string;
  ultimaCompra: Date;
}

/** El insumo de un producto, con su grupo (`null` = el producto no tiene insumo: no entra a la comparativa). */
interface InsumoParaComparar {
  id: string;
  nombre: string;
  grupo: { nombre: string } | null;
}

interface OfertaComparativa {
  proveedorNombre: string;
  precioPorUnidadStock: number;
  unidadCompraNombre: string;
  ultimaCompra: Date;
}

export interface FilaComparativaPrecios {
  insumo: string;
  grupo: string | null;
  masBarato: OfertaComparativa | null;
  todas: OfertaComparativa[];
}

/**
 * Una fila por insumo con TODAS sus ofertas (las de sus productos, de cualquier proveedor): primero las que tienen precio, de la más barata a la más cara, y después las de precio
 * 0; la más barata con precio es `masBarato` (o `null` si ninguna tiene). Las filas, por grupo (sin grupo primero) y por insumo. Un producto sin insumo (o que no está en
 * `insumoDe`) no entra (Catalogo.js:3536).
 */
export function armarComparativaDePrecios(
  ofertas: readonly OfertaParaComparar[],
  insumoDe: ReadonlyMap<string, InsumoParaComparar | null>,
  nombreDe: ReadonlyMap<string, string>,
): FilaComparativaPrecios[] {
  const porInsumo = new Map<string, { insumo: string; grupo: string | null; ofertas: OfertaComparativa[] }>();
  for (const oferta of ofertas) {
    const insumo = insumoDe.get(oferta.productoId);
    if (!insumo) continue; // sin Insumo, no entra a la comparativa (Catalogo.js:3536)

    const entrada = porInsumo.get(insumo.id) ?? { insumo: insumo.nombre, grupo: insumo.grupo?.nombre ?? null, ofertas: [] };
    entrada.ofertas.push({
      proveedorNombre: nombreDe.get(oferta.proveedorId) ?? PROVEEDOR_DESCONOCIDO,
      precioPorUnidadStock: oferta.precioPorUnidadStock,
      unidadCompraNombre: oferta.unidadCompraNombre,
      ultimaCompra: oferta.ultimaCompra,
    });
    porInsumo.set(insumo.id, entrada);
  }

  const resultado: FilaComparativaPrecios[] = Array.from(porInsumo.values()).map((entrada) => {
    const conPrecio = entrada.ofertas.filter((o) => o.precioPorUnidadStock > 0).sort((a, b) => a.precioPorUnidadStock - b.precioPorUnidadStock);
    const sinPrecio = entrada.ofertas.filter((o) => o.precioPorUnidadStock <= 0);
    return {
      insumo: entrada.insumo,
      grupo: entrada.grupo,
      masBarato: conPrecio[0] ?? null,
      todas: [...conPrecio, ...sinPrecio],
    };
  });

  resultado.sort((a, b) => (a.grupo ?? "").localeCompare(b.grupo ?? "") || a.insumo.localeCompare(b.insumo));
  return resultado;
}
