import type { CartaV1, ItemCartaV1, OpcionItemCartaV1, PromoCartaV1, SeccionCartaV1 } from "./armar-menu";

/**
 * LO ÚNICO que la carta pública entrega a un anónimo (S-25 del plan de endurecimiento de seguridad, tanda T9; requisito del dueño: «la carta pública es la ÚNICA excepción
 * explícita a "un anónimo no alcanza ningún dato", y se queda en una lista cerrada de datos»).
 *
 * `CartaV1` (`armar-menu.ts`) es el armado INTERNO de la carta: lo comparten la carta pública, el selector del POS y la vista previa del admin, y por eso lleva los ids
 * de las filas (de la sucursal, de cada sección, de cada producto, ítem agrupado, opción y promo) que esos consumidores necesitan para vender o editar. Un anónimo no
 * necesita ninguno: nadie los PUBLICÓ, y con un id de producto o de promo apunta a una fila de la base que no es suya (y puede contar cuántas hay). Hasta S-25 viajaban en
 * el HTML y en el payload RSC de la página (`data-ir-a={seccion.id}`, y las `key` de cada ítem, ítem agrupado y promo, que React serializa).
 *
 * Esta proyección es la frontera: copia CAMPO POR CAMPO (nunca `{ ...x }` ni «todo menos el id»: un campo nuevo de `CartaV1` no sale solo, hay que sumarlo acá a propósito, y el
 * guardián `test/arquitectura/carta-publica-lista-cerrada.test.ts` compara esta lista con la salida real en las dos direcciones). Los componentes de `components/carta-publica/`
 * reciben `CartaPublicaV1`, que ni siquiera tiene la propiedad: no pueden dibujar un id aunque alguien se lo proponga (el compilador lo rechaza).
 */

export interface OpcionItemCartaPublica {
  nombre: string;
  precio: number;
}

export interface ItemCartaPublico {
  nombre: string;
  categoria: string;
  descripcion: string | null;
  precio: number;
  /** SOLO en un PV suelto con descuento (el precio sin descuento, para mostrarlo tachado). Un ítem sin descuento no lleva esta clave ni `descuentoPorcentaje`. */
  precioLista?: number;
  descuentoPorcentaje?: number;
  tags: string[];
  especial: boolean;
  imagenUrl: null;
  /** SOLO en un ítem agrupado: sus opciones, por nombre y precio. */
  opciones?: OpcionItemCartaPublica[];
}

export interface PromoCartaPublica {
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
}

export interface SeccionCartaPublica {
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
  items: ItemCartaPublico[];
  promos: PromoCartaPublica[];
}

export interface CartaPublicaV1 {
  version: 1;
  generadoEn: string;
  sucursal: { nombre: string };
  secciones: SeccionCartaPublica[];
}

const proyectarOpcion = (o: OpcionItemCartaV1): OpcionItemCartaPublica => ({ nombre: o.nombre, precio: o.precio });

function proyectarItem(i: ItemCartaV1): ItemCartaPublico {
  return {
    nombre: i.nombre,
    categoria: i.categoria,
    descripcion: i.descripcion,
    precio: i.precio,
    // Las claves opcionales solo si están: el JSON de un ítem sin descuento ni opciones queda igual que antes (campos aditivos de la v1).
    ...(i.precioLista !== undefined ? { precioLista: i.precioLista } : {}),
    ...(i.descuentoPorcentaje !== undefined ? { descuentoPorcentaje: i.descuentoPorcentaje } : {}),
    tags: [...i.tags],
    especial: i.especial,
    imagenUrl: i.imagenUrl,
    ...(i.opciones !== undefined ? { opciones: i.opciones.map(proyectarOpcion) } : {}),
  };
}

const proyectarPromo = (p: PromoCartaV1): PromoCartaPublica => ({ titulo: p.titulo, descripcion: p.descripcion, precio: p.precio, orden: p.orden });

const proyectarSeccion = (s: SeccionCartaV1): SeccionCartaPublica => ({
  nombre: s.nombre,
  titulo: s.titulo,
  descripcion: s.descripcion,
  imagenUrl: s.imagenUrl,
  orden: s.orden,
  items: s.items.map(proyectarItem),
  promos: s.promos.map(proyectarPromo),
});

/**
 * La etiqueta de caché de TODAS las cartas públicas de UNA empresa (S-26 del plan de endurecimiento de seguridad, tanda T9). La carta de cada sucursal se cachea 5 minutos
 * (ISR) con esta etiqueta, y toda mutación de carta de la empresa invalida SOLO esa etiqueta (`server/actions/carta/revalidar.ts`): lo de una empresa nunca saca del caché
 * lo de otra. Antes se invalidaba el patrón `/(carta-publica)/carta-publica/[empresa]/[sucursal]`, que es de todas las empresas a la vez.
 *
 * Por qué una etiqueta y no `revalidatePath` con la ruta de la empresa: Next solo engancha a cada página la etiqueta de su ruta TAL COMO ESTÁ ESCRITA en el árbol de archivos
 * (con `[empresa]`) y la de su URL exacta; `revalidatePath("/carta-publica/<empresa>", "layout")` no alcanza a las sucursales y no falla (verificado en el artefacto de producción
 * con `test/e2e/carta-publica-cache-por-empresa.spec.ts`: la carta de la propia empresa quedaba vieja).
 */
export function etiquetaDeCacheDeCartasPublicas(empresaSlug: string): string {
  return `carta-publica:${empresaSlug}`;
}

/** La carta armada, sin los ids internos: lo que la carta pública emite hacia el navegador. */
export function proyectarCartaPublica(carta: CartaV1): CartaPublicaV1 {
  return { version: carta.version, generadoEn: carta.generadoEn, sucursal: { nombre: carta.sucursal.nombre }, secciones: carta.secciones.map(proyectarSeccion) };
}
