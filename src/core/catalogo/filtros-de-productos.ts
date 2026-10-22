import { LARGO_MAXIMO_TEXTO_CATALOGO, textoDeBusqueda } from "@/core/texto";

/**
 * Los FILTROS de la lista de Productos (Fase 6, bloque 3, 3b; `/catalogo/productos`): qué se puede pedir por la URL, cómo se valida y cómo se vuelve a escribir. Puro: no lee nada. Los valores son PALABRAS
 * cortas y cerradas (`?tipo=venta&falta=sin-precio`), nunca un id ni algo que el cliente decida: lo que no está en la lista cerrada se IGNORA (la lista sale sin ese filtro, nunca con un 500 ni con un valor
 * a medias). Qué ve y qué cuenta cada filtro lo decide el servidor (`server/lecturas/catalogo/filtros-de-productos.ts`), siempre dentro de la empresa y de la sucursal activa del usuario.
 *
 * El producto NO tiene un campo «activo»: lo que se enciende y se apaga es la DISPONIBILIDAD por sucursal (`disponible`: acá, no acá, o en ninguna sucursal, que es el «inactivo» de la empresa).
 */

/** De qué clase es el producto, en palabras. «Producto de venta» no incluye al producto interno de un adicional (que se ve aparte como «respaldo»). */
export const TIPOS_FILTRABLES = ["venta", "materia-prima", "se-produce", "respaldo"] as const;
export type TipoFiltrable = (typeof TIPOS_FILTRABLES)[number];

/** Cómo se vende un producto de venta: con su precio, o por opción (el precio final está en cada opción). */
export const MODOS_FILTRABLES = ["directo", "por-opcion"] as const;
export type ModoFiltrable = (typeof MODOS_FILTRABLES)[number];

/** Si se vende en la sucursal activa, en alguna sucursal de la empresa (el «activo») o en ninguna (el «inactivo»). */
export const DISPONIBILIDADES_FILTRABLES = ["aca", "no-aca", "en-alguna", "en-ninguna"] as const;
export type DisponibilidadFiltrable = (typeof DISPONIBILIDADES_FILTRABLES)[number];

/**
 * «Le falta algo»: lo mismo que marca el espacio del producto como pendiente (`pendientesDelProducto`), pedido de a uno: `sin-precio` (un producto de venta directo con precio 0), `sin-receta` (la regla «sin
 * receta no se vende» y la materia prima que se produce sin ingredientes) y `fuera-de-la-carta` (el estado «fuera»: disponible acá, sin contenido de carta ni grupo). `sin-receta` lo ve solo quien puede ver recetas y `fuera-de-la-carta` solo
 * quien puede ver la carta (con su módulo prendido): un filtro por algo que el usuario no ve revelaría justo eso, así que el servidor lo ignora y la pantalla no lo ofrece.
 */
export const FALTAS_FILTRABLES = ["sin-precio", "sin-receta", "fuera-de-la-carta"] as const;
export type FaltaFiltrable = (typeof FALTAS_FILTRABLES)[number];

/** Lo que viaja por la URL o por la acción: textos (o nada). Lo que no sea de la lista cerrada se ignora al leerlo. */
export interface EntradaDeFiltrosDeProductos {
  tipo?: string | null;
  modo?: string | null;
  disponible?: string | null;
  falta?: string | null;
}

export interface FiltrosDeProductos {
  /** La búsqueda por nombre o código ya limpia (vacía = sin búsqueda). */
  q: string;
  tipo: TipoFiltrable | null;
  modo: ModoFiltrable | null;
  disponible: DisponibilidadFiltrable | null;
  falta: FaltaFiltrable | null;
}

export const SIN_FILTROS: FiltrosDeProductos = { q: "", tipo: null, modo: null, disponible: null, falta: null };

export const ETIQUETA_DEL_TIPO: Record<TipoFiltrable, string> = {
  venta: "Producto de venta",
  "materia-prima": "Materia prima",
  "se-produce": "Materia prima que se produce",
  respaldo: "Producto de respaldo de un adicional",
};
export const ETIQUETA_DEL_MODO: Record<ModoFiltrable, string> = { directo: "Directo (tiene su precio)", "por-opcion": "Por opción (el precio está en cada opción)" };
export const ETIQUETA_DE_LA_DISPONIBILIDAD: Record<DisponibilidadFiltrable, string> = {
  aca: "Disponible en esta sucursal",
  "no-aca": "No disponible en esta sucursal",
  "en-alguna": "Activo: disponible en alguna sucursal",
  "en-ninguna": "Inactivo: no disponible en ninguna sucursal",
};
export const ETIQUETA_DE_LA_FALTA: Record<FaltaFiltrable, string> = {
  "sin-precio": "Sin precio de venta",
  "sin-receta": "Sin receta",
  "fuera-de-la-carta": "Todavía no está en la carta de esta sucursal",
};

/** El valor de una lista cerrada, o `null` si no es de la lista (o no es un texto). */
function deLaLista<T extends string>(lista: readonly T[], valor: unknown): T | null {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

/**
 * Lee los filtros de lo que llegó (los `searchParams` ya pasados por `unicosDeUrl`, o los argumentos de la acción, que vienen del cliente): cada clave se valida contra su lista cerrada y la búsqueda se
 * limpia (`textoDeBusqueda`: sin NUL, sin espacios de más) y se acota al largo máximo de un nombre de catálogo (un término más largo no puede coincidir con ninguno).
 */
export function leerFiltrosDeProductos(entrada: Partial<Record<"q" | "tipo" | "modo" | "disponible" | "falta", unknown>>): FiltrosDeProductos {
  return {
    q: typeof entrada.q === "string" ? textoDeBusqueda(entrada.q).slice(0, LARGO_MAXIMO_TEXTO_CATALOGO) : "",
    tipo: deLaLista(TIPOS_FILTRABLES, entrada.tipo),
    modo: deLaLista(MODOS_FILTRABLES, entrada.modo),
    disponible: deLaLista(DISPONIBILIDADES_FILTRABLES, entrada.disponible),
    falta: deLaLista(FALTAS_FILTRABLES, entrada.falta),
  };
}

/** ¿Hay algún filtro puesto? (para mostrar «Limpiar» y decir «que coincidan con los filtros»). */
export function hayFiltrosDeProductos(f: FiltrosDeProductos): boolean {
  return f.q !== "" || f.tipo !== null || f.modo !== null || f.disponible !== null || f.falta !== null;
}

/** Los filtros como consulta de URL (sin el `?`), para los enlaces que los conservan (la página siguiente): solo lo que está puesto, codificado. */
export function consultaDeLosFiltros(f: FiltrosDeProductos, cursor?: string): string {
  const partes: string[] = [];
  if (f.q !== "") partes.push(`q=${encodeURIComponent(f.q)}`);
  if (f.tipo) partes.push(`tipo=${f.tipo}`);
  if (f.modo) partes.push(`modo=${f.modo}`);
  if (f.disponible) partes.push(`disponible=${f.disponible}`);
  if (f.falta) partes.push(`falta=${f.falta}`);
  if (cursor) partes.push(`cursor=${encodeURIComponent(cursor)}`);
  return partes.join("&");
}

/** ¿La consulta tiene que correr con la lectura de la EMPRESA entera? Sí cuando pregunta por «alguna/ninguna sucursal»: la RLS por sucursal le escondería las filas de las demás. */
export function necesitaLaEmpresaEntera(f: FiltrosDeProductos): boolean {
  return f.disponible === "en-alguna" || f.disponible === "en-ninguna";
}

