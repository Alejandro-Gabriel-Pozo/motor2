/**
 * CARTA-MANT (mantenimiento de la carta, prototipo aprobado «Mantenimiento / Parametrización»): cómo se ordena la pantalla de la carta de UNA sucursal. Puro: recibe lo que leyó la
 * consulta (`server/consultas/carta/mantenimiento.ts`) y decide en qué lista va cada producto de venta.
 *
 * La premisa (decisión del dueño, 2026-10-14): lo que sale en la carta pública lo ve el cliente; el MENÚ DEL DÍA y lo que se vende solo en el POS NUNCA sale en la carta (hasta que se cocina no se
 * sabe qué hay). Por eso un producto de venta disponible acá SIN contenido de carta no es un faltante: es «Fuera de carta (POS y menú del día)», un contador informativo, y no se avisa. El producto
 * de RESPALDO de un adicional (el «ancla», `OpcionDeGrupo.productoId`) se vende solo como adicional: no figura en ninguna lista de la carta.
 *
 * Cada producto cae en UNA sola lista, en este orden de prioridad:
 *  1. ancla de un adicional → en ninguna;
 *  2. dentro de un ítem agrupado de esta sucursal → `enAgrupados` (sale en la carta dentro del agrupado, su contenido propio no se usa);
 *  3. con contenido de carta con sección → esa sección (aunque hoy no esté disponible: «sin stock hoy» es otra cosa que «fuera de carta»);
 *  4. con contenido sin sección (solo un contenido oculto puede no tener sección) → `sinSeccion`;
 *  5. sin contenido y disponible acá → `fueraDeCarta`;
 *  6. sin contenido y no disponible acá → en ninguna (no se ofrece en esta sucursal).
 */

import type { GrupoCartaV1, OpcionesSinCostoCartaV1 } from "./opciones-en-carta";
import { formatearPrecioCarta } from "./precio-carta";
import type { PresentacionCartaV1 } from "./presentacion-en-carta";
import { textoDeLaAclaracion } from "./texto-de-la-carta";

export interface SeccionParaMantener {
  id: string;
  nombre: string;
  orden: number;
  /** La sección es de la EMPRESA (`SeccionCarta.activa`): apagada, no sale en la carta de ninguna sucursal. */
  activa: boolean;
}

export interface ProductoParaMantener {
  id: string;
  nombre: string;
  /** El precio que rige en esta sucursal (el local vigente o el de lista), en pesos. */
  precioAca: number;
  /** El precio de lista de la EMPRESA (`Producto.precioVenta`), en pesos. */
  precioDeLista: number;
  /** ¿Rige en esta sucursal un precio local propio (capacidad prendida y precio local habilitado)? */
  conPrecioLocal: boolean;
  /** Fase 4 (ADR-035): se vende por opción; `precioAca` y `precioDeLista` son el guardado, que no se cobra (la pantalla dice «Por opción»). Opcional: ausente = directo. */
  seVendePorOpcion?: boolean;
  disponibleAca: boolean;
  esAnclaDeAdicional: boolean;
  /** El nombre del ítem agrupado de esta sucursal que lo contiene, si hay. */
  agrupadoEn: string | null;
  contenido: { visibleEnCarta: boolean; seccionCartaId: string | null; orden: number } | null;
  /**
   * Solo para los de «Fuera de carta»: qué opciones va a mostrar la carta pública si se lo agrega (`vistaPreviaDeOpciones`, con la MISMA presentación que la carta: `opcionesParaLaCarta`).
   * `null` en los demás.
   */
  vistaPrevia?: string | null;
}

export interface SeccionConProductos extends SeccionParaMantener {
  /** Por `orden` del contenido y después por nombre. */
  productos: ProductoParaMantener[];
}

export interface CartaParaMantener {
  /** Todas las secciones de la empresa, en su orden, cada una con sus productos de esta sucursal (puede quedar vacía). */
  secciones: SeccionConProductos[];
  sinSeccion: ProductoParaMantener[];
  enAgrupados: ProductoParaMantener[];
  /** Disponibles acá y sin contenido de carta: el POS y el menú del día. Por nombre. */
  fueraDeCarta: ProductoParaMantener[];
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");

export function organizarCartaParaMantener(secciones: readonly SeccionParaMantener[], productos: readonly ProductoParaMantener[]): CartaParaMantener {
  const porSeccion = new Map<string, ProductoParaMantener[]>(secciones.map((s) => [s.id, []]));
  const sinSeccion: ProductoParaMantener[] = [];
  const enAgrupados: ProductoParaMantener[] = [];
  const fueraDeCarta: ProductoParaMantener[] = [];
  for (const p of productos) {
    if (p.esAnclaDeAdicional) continue;
    if (p.agrupadoEn !== null) enAgrupados.push(p);
    else if (p.contenido) {
      const lista = p.contenido.seccionCartaId === null ? undefined : porSeccion.get(p.contenido.seccionCartaId);
      (lista ?? sinSeccion).push(p);
    } else if (p.disponibleAca) fueraDeCarta.push(p);
  }
  const porOrden = (a: ProductoParaMantener, b: ProductoParaMantener) => (a.contenido?.orden ?? 0) - (b.contenido?.orden ?? 0) || porNombre(a, b);
  return {
    secciones: secciones.map((s) => ({ ...s, productos: (porSeccion.get(s.id) ?? []).sort(porOrden) })),
    sinSeccion: sinSeccion.sort(porNombre),
    enAgrupados: enAgrupados.sort(porNombre),
    fueraDeCarta: fueraDeCarta.sort(porNombre),
  };
}

/** Sin mayúsculas ni acentos, para buscar por nombre («milanesa» encuentra «Milanesa NAPOLITANA», «jamon» encuentra «Jamón»). */
function normalizarParaBuscar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** ¿El nombre tiene TODAS las palabras buscadas (en cualquier orden)? Una búsqueda vacía coincide con todo. */
export function coincideConLaBusqueda(nombre: string, busqueda: string): boolean {
  const palabras = normalizarParaBuscar(busqueda).split(/\s+/).filter(Boolean);
  const enNombre = normalizarParaBuscar(nombre);
  return palabras.every((p) => enNombre.includes(p));
}

/** El tope del orden de carta (el mismo de `validarOrdenCarta`). */
const ORDEN_MAXIMO = 100_000;

/**
 * El orden que toma un producto que se AGREGA a una sección: al final, uno más que el mayor de lo que ya tiene la sección en esta sucursal (productos e ítems agrupados, que comparten la escala);
 * 0 si está vacía. Nunca pasa el tope de `validarOrdenCarta` (ahí queda empatado con el último y desempata el nombre).
 */
export function ordenAlFinalDeLaSeccion(ordenesDeLaSeccion: readonly number[]): number {
  if (ordenesDeLaSeccion.length === 0) return 0;
  return Math.min(ORDEN_MAXIMO, Math.max(0, ...ordenesDeLaSeccion) + 1);
}

/**
 * La línea «Va a mostrar: …» del paso «¿En qué sección va?» de «Agregar a la carta». Lo que recibe es la salida de `opcionesParaLaCarta` (la misma que arma la carta pública) para el producto:
 * sin grupos de opciones → «Sin opciones.»; con grupos pero sin poder pedirse hoy (un grupo obligatorio sin ninguna opción disponible) → el aviso, sin bloquear; si no, los tamaños con su precio, los
 * recargos con su signo y las opciones sin costo, grupo por grupo.
 */
export function vistaPreviaDeOpciones(tieneGrupos: boolean, enCarta: { grupos: readonly GrupoCartaV1[]; sinCosto: readonly OpcionesSinCostoCartaV1[] } | null): string {
  if (!tieneGrupos) return "Sin opciones.";
  if (enCarta === null) return "Ojo: hoy no se puede pedir, le falta una opción obligatoria disponible o configurada. Se puede agregar igual; no sale en la carta hasta que la tenga.";
  const recargo = (r: number) => `${r > 0 ? "+" : "−"}${formatearPrecioCarta(Math.abs(r))}`;
  const partes = [
    ...enCarta.grupos.map((g) => `${g.nombre}: ${g.opciones.map((o) => (o.tipo === "final" ? `${o.nombre} ${formatearPrecioCarta(o.precio)}` : `${o.nombre} ${recargo(o.recargo)}`)).join(", ")}`),
    ...enCarta.sinCosto.map((g) => `${g.grupo}: ${g.opciones.join(", ")}`),
  ];
  return partes.length ? `Va a mostrar: ${partes.join(" · ")}.` : "Sin opciones para elegir (las que tiene no cambian nada en la carta).";
}

/**
 * Fase 5, paso 9 («carta pareja», ADR-035): la línea «Va a mostrar: …» con la FORMA que la carta pública le va a dar al producto (la misma proyección del servidor: `presentacionDeUnProductoSolo`),
 * en vez de las listas de antes: la tabla (con sus columnas y filas) o cada opción como un plato, y lo que se lee debajo, con sus precios.
 */
export function vistaPreviaDeLaForma(nombre: string, p: PresentacionCartaV1): string {
  const precio = (x: number | null) => (x === null ? "–" : formatearPrecioCarta(x));
  const filas = (p.forma === "tabla" ? p.filas : []).map((f) => [f.rotulo, f.celdas.map(precio).join(" / ")].filter(Boolean).join(" "));
  const cuerpo =
    p.forma === "simple"
      ? `«${nombre}» con su precio`
      : !p.titulo
        ? `cada opción como un plato: ${filas.join(", ")}`
        : p.columnas.length === 0
          ? `«${nombre}» y debajo: ${filas.join(", ")}`
          : `una tabla «${nombre}» (${p.columnas.join(" / ")}): ${filas.join("; ")}`;
  const debajo = p.aclaraciones.map((a) => `${a.rotulo}: ${textoDeLaAclaracion(a)}`);
  return `Va a mostrar ${[cuerpo, ...debajo].join(" · ")}.`;
}

/**
 * CARTA-MANT F3 «Ordenar» (prototipo aprobado: se toca lo que se quiere mover y después dónde va, sin arrastrar ni flechas fila por fila). Los lugares donde se puede «Poner» lo elegido: los huecos
 * 0…n de la lista (antes del primero, entre dos, al final), menos los dos que lo dejarían donde está (justo antes y justo después de sí mismo). Sin nada elegido, ninguno.
 */
export function lugaresParaPoner(cantidad: number, elegido: number | null): number[] {
  if (elegido === null || elegido < 0 || elegido >= cantidad) return [];
  return Array.from({ length: cantidad + 1 }, (_, i) => i).filter((i) => i !== elegido && i !== elegido + 1);
}

/** La lista con el elemento `elegido` puesto en el hueco `destino` (0…n, como en `lugaresParaPoner`); los demás, en el mismo orden. Un índice fuera de rango deja la lista igual. */
export function ponerEnElLugar<T>(lista: readonly T[], elegido: number, destino: number): T[] {
  if (elegido < 0 || elegido >= lista.length || destino < 0 || destino > lista.length) return [...lista];
  const sin = lista.filter((_, i) => i !== elegido);
  const hueco = destino > elegido ? destino - 1 : destino;
  return [...sin.slice(0, hueco), lista[elegido]!, ...sin.slice(hueco)];
}
