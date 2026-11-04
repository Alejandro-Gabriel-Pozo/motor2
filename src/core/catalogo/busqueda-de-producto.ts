/**
 * La búsqueda de un producto por texto, parte PURA (Fase 7, Catálogo, mejora M2; Compras etapa 1, paso 5): el término se parte en palabras y CADA una tiene que estar, en cualquier orden. El SQL (nombre, código y, para quien
 * ve el dato, la referencia del proveedor; sin distinguir mayúsculas NI tildes, con `%` y `_` como letras) vive en `server/lecturas/catalogo/busqueda-de-producto.ts` y lo comparten la lista de Productos y el buscador
 * de producto (las dos buscan igual). Acá: el armado de palabras y el orden de los tramos del buscador de la compra.
 */

/** Tope de palabras de una búsqueda: lo que sobra se ignora (acota el tamaño de la consulta). */
const MAXIMO_DE_PALABRAS_DE_BUSQUEDA = 8;

/** Las palabras de un término de búsqueda (separadas por espacios, sin vacías, hasta `MAXIMO_DE_PALABRAS_DE_BUSQUEDA`). PURO. */
export function palabrasDeBusqueda(termino: string): string[] {
  return termino.split(/\s+/).filter((p) => p !== "").slice(0, MAXIMO_DE_PALABRAS_DE_BUSQUEDA);
}

/** Coincidencia EXACTA de código (tramo a del orden): el término entero (sin espacios de más, sin distinguir mayúsculas) es nuestro código, o —solo con `porReferencia`— una PALABRA completa de la referencia del proveedor elegido. PURO. */
export function esCoincidenciaExactaDeCodigo(termino: string, codigo: string, referenciaDelProveedorElegido: string | null, porReferencia: boolean): boolean {
  const t = termino.trim().toLowerCase();
  if (t === "") return false;
  if (codigo.toLowerCase() === t) return true;
  return porReferencia && referenciaDelProveedorElegido !== null && referenciaDelProveedorElegido.toLowerCase().split(/\s+/).includes(t);
}

/**
 * Junta los tramos del buscador YA ORDENADOS (exactos de código, vínculo del proveedor elegido, nombre que empieza con la primera palabra, el resto por nombre), sin repetir un producto (gana
 * su primer tramo) y con tope `limite`. PURO.
 */
export function combinarTramosDeProductos<T extends { id: string }>(tramos: readonly (readonly T[])[], limite: number): T[] {
  const vistos = new Set<string>();
  const salida: T[] = [];
  for (const tramo of tramos) {
    for (const p of tramo) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      salida.push(p);
      if (salida.length >= limite) return salida;
    }
  }
  return salida;
}
