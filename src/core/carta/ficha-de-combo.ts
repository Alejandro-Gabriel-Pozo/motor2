import type { ProductoParaEntrada } from "./admin-tipos";
import { productosDelOrigen } from "./armar-lugar-de-lista";
import { esCantidadExacta, textoDeLaParte, type ParteDeLaPromoParaLeer } from "./armado-de-promo-como-pedernal";
import type { FilaDeParte, FilasDeLaPromo } from "./partes-de-promo";

/**
 * La ficha de un combo «como la maqueta» (`combos.html` de Pedernal; `docs/combos-como-la-maqueta-diferencias-2026-11-17.md`). PURO: sin lecturas ni escrituras. Convierte las filas de partes de la promo
 * (`armarFilasDeLaPromo`) en los COMPONENTES que la maqueta muestra como tarjetas: lo que lleva el combo, de qué tipo es y, si se elige, entre qué.
 *
 * Tipos (los dos de la maqueta que Motor2 tiene): «Un producto fijo» = una lista «Solo estos platos» con UN plato, de opciones fijas y cantidad exacta; «A elegir en una sección de la carta» = todo lo demás.
 */
export type TipoDeComponente = "fijo" | "seccion";

export interface ComponenteDeLaFicha {
  /** La clave estable de la fila (`S:<id>` o `L:<nombre>`). */
  clave: string;
  /** Lo que lleva, escrito como en «Cómo lo ve el cliente»: «2 × Hamburguesa» o «1 de Bebidas». */
  nombre: string;
  tipo: TipoDeComponente;
  /** Los platos entre los que se puede elegir (vacío si es fijo). */
  elegibles: string[];
  fila: FilaDeParte;
  /** La parte tal como la leen «Cómo lo ve el cliente» y la lista. */
  parte: ParteDeLaPromoParaLeer;
}

/** ¿La fila viene FIJA? Un solo plato, de opciones fijas, con cantidad exacta de 1 o más. */
function esFilaFija(f: FilaDeParte): boolean {
  return f.modo === "SOLO_ESTOS" && f.entradas.length === 1 && f.entradas[0]!.modoDeOpciones === "FIJAS" && esCantidadExacta(f.cantidadMinima, f.cantidadMaxima) && f.cantidadMinima >= 1;
}

/**
 * Los componentes que el combo lleva hoy, en el orden de las filas (secciones, «No está en la carta», otras partes). Las filas que no entran no figuran. «Lo que el cliente puede elegir» sale de los platos
 * tildados («Solo estos platos») o, en «Toda la sección», de los platos de venta de esa sección (los mismos que ofrece la pantalla para tildar: NO se filtran por disponibilidad hoy).
 */
export function componentesDeLaFicha(filas: FilasDeLaPromo, productos: readonly ProductoParaEntrada[]): ComponenteDeLaFicha[] {
  return [...filas.deSecciones, filas.fueraDeLaCarta, ...filas.otras]
    .filter((f) => f.modo !== "NO_ENTRA")
    .map((fila) => {
      const fijo = esFilaFija(fila);
      const elegibles = fijo ? [] : fila.modo === "SOLO_ESTOS" ? fila.entradas.map((e) => e.nombre) : productosDelOrigen(productos, fila.origen).map((p) => p.nombreParaMostrar);
      const parte: ParteDeLaPromoParaLeer = { nombre: fila.nombre, cantidadMinima: fila.cantidadMinima, cantidadMaxima: fila.cantidadMaxima, productoFijo: fijo ? fila.entradas[0]!.nombre : null };
      return { clave: fila.clave, nombre: textoDeLaParte(parte), tipo: fijo ? ("fijo" as const) : ("seccion" as const), elegibles, fila, parte };
    });
}

/** Las filas que todavía no entran (las que se ofrecen en «Agregar componente»): las secciones y «No está en la carta». */
export function filasParaAgregar(filas: FilasDeLaPromo): FilaDeParte[] {
  return [...filas.deSecciones, filas.fueraDeLaCarta].filter((f) => f.modo === "NO_ENTRA");
}
