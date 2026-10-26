import type { CartaV1, ItemCartaV1, OpcionItemCartaV1, PromoCartaV1, SeccionCartaV1 } from "./armar-menu";
import type { GrupoCartaV1, OpcionesSinCostoCartaV1 } from "./opciones-en-carta";
import type { AclaracionCartaV1, PresentacionCartaV1, TandaCartaV1 } from "./presentacion-en-carta";

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
  /** GO-2d y CARTA-B: SOLO en un PV con opciones que CAMBIAN EL PRECIO: los tamaños con su precio final y lo que suma o resta una variante o un adicional (nombre del grupo y cada opción con su precio o su recargo). */
  grupos?: GrupoCartaPublico[];
  /** CARTA-C: SOLO en un PV con opciones que no cambian el precio: el nombre del grupo y los nombres de sus opciones sin costo (pastillas). Solo textos: sin ids ni precios. */
  opcionesSinCosto?: OpcionesSinCostoCartaPublica[];
  /**
   * Fase 5 («carta pareja», `presentacion-en-carta.ts`): SOLO en un PV con opciones cuya forma la carta puede leer con el precio exacto: cómo se lee (simple, fila de una tanda, tabla o lista), con
   * cada precio ya resuelto en el servidor y las aclaraciones debajo del plato. Solo rótulos y precios: sin ids, sin el tipo interno del grupo. Sin ella, quien dibuja cae a `grupos`/`opcionesSinCosto`.
   */
  presentacion?: PresentacionCartaPublica;
}

/** Una línea debajo del plato (Fase 5). */
export type AclaracionCartaPublica = { tipo: "eleccion"; rotulo: string; opciones: string[] } | { tipo: "extras"; rotulo: string; opciones: { nombre: string; recargo: number }[] };

/** La forma de un producto con opciones (Fase 5). `null` en una celda = no se ofrece («–»). */
export type PresentacionCartaPublica =
  | { forma: "simple"; aclaraciones: AclaracionCartaPublica[] }
  | { forma: "columnas"; celdas: (number | null)[]; aclaraciones: AclaracionCartaPublica[] }
  | { forma: "tabla"; columnas: string[]; filas: { rotulo: string; celdas: (number | null)[] }[]; aclaraciones: AclaracionCartaPublica[] }
  | { forma: "lista"; encabezado: boolean; protagonista?: "nombre"; filas: { rotulo: string; precio: number }[]; aclaraciones: AclaracionCartaPublica[] };

/** Fase 5: los ítems `primero`…`ultimo` de la sección (índices en `items`) comparten los rótulos de sus columnas. */
export interface TandaCartaPublica {
  primero: number;
  ultimo: number;
  rotulos: string[];
}

export interface OpcionesSinCostoCartaPublica {
  grupo: string;
  opciones: string[];
}

/** Fase 5: la misma unión discriminada que `OpcionDeGrupoCartaV1` (un tamaño con su precio final, o un recargo). */
export type OpcionDeGrupoCartaPublica = { nombre: string } & ({ tipo: "final"; precio: number } | { tipo: "recargo"; recargo: number });

export interface GrupoCartaPublico {
  nombre: string;
  opciones: OpcionDeGrupoCartaPublica[];
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
  /** Fase 5: SOLO si la sección tiene alguna tanda de columnas compartidas. */
  tandas?: TandaCartaPublica[];
}

export interface CartaPublicaV1 {
  version: 1;
  generadoEn: string;
  sucursal: { nombre: string };
  secciones: SeccionCartaPublica[];
  /** Fase 5, paso 10b: SOLO si hoy hay algo agotado que cambia lo que se ve: la carta completa que sale en papel (las mismas claves que `secciones`). */
  seccionesImpresas?: SeccionCartaPublica[];
}

const proyectarOpcion = (o: OpcionItemCartaV1): OpcionItemCartaPublica => ({ nombre: o.nombre, precio: o.precio });

/** GO-2d: un grupo de opciones, campo por campo (Fase 5: según el `tipo`, el precio final o el recargo). */
const proyectarGrupo = (g: GrupoCartaV1): GrupoCartaPublico => ({
  nombre: g.nombre,
  opciones: g.opciones.map((o): OpcionDeGrupoCartaPublica => (o.tipo === "final" ? { nombre: o.nombre, tipo: "final", precio: o.precio } : { nombre: o.nombre, tipo: "recargo", recargo: o.recargo })),
});

/** Fase 5: una aclaración, campo por campo. */
const proyectarAclaracion = (a: AclaracionCartaV1): AclaracionCartaPublica =>
  a.tipo === "eleccion" ? { tipo: "eleccion", rotulo: a.rotulo, opciones: [...a.opciones] } : { tipo: "extras", rotulo: a.rotulo, opciones: a.opciones.map((o) => ({ nombre: o.nombre, recargo: o.recargo })) };

/** Fase 5: la forma de un producto, campo por campo según la forma (nunca `{ ...presentacion }`: un campo interno nuevo no sale solo). */
function proyectarPresentacion(p: PresentacionCartaV1): PresentacionCartaPublica {
  const aclaraciones = p.aclaraciones.map(proyectarAclaracion);
  switch (p.forma) {
    case "simple":
      return { forma: "simple", aclaraciones };
    case "columnas":
      return { forma: "columnas", celdas: [...p.celdas], aclaraciones };
    case "tabla":
      return { forma: "tabla", columnas: [...p.columnas], filas: p.filas.map((f) => ({ rotulo: f.rotulo, celdas: [...f.celdas] })), aclaraciones };
    case "lista":
      return { forma: "lista", encabezado: p.encabezado, ...(p.protagonista !== undefined ? { protagonista: p.protagonista } : {}), filas: p.filas.map((f) => ({ rotulo: f.rotulo, precio: f.precio })), aclaraciones };
  }
}

const proyectarTanda = (t: TandaCartaV1): TandaCartaPublica => ({ primero: t.primero, ultimo: t.ultimo, rotulos: [...t.rotulos] });

/** CARTA-C: un grupo de opciones sin costo, campo por campo (solo textos). */
const proyectarSinCosto = (g: OpcionesSinCostoCartaV1): OpcionesSinCostoCartaPublica => ({ grupo: g.grupo, opciones: [...g.opciones] });

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
    ...(i.grupos !== undefined ? { grupos: i.grupos.map(proyectarGrupo) } : {}),
    ...(i.opcionesSinCosto !== undefined ? { opcionesSinCosto: i.opcionesSinCosto.map(proyectarSinCosto) } : {}),
    ...(i.presentacion !== undefined ? { presentacion: proyectarPresentacion(i.presentacion) } : {}),
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
  ...(s.tandas !== undefined ? { tandas: s.tandas.map(proyectarTanda) } : {}),
});

/**
 * La etiqueta de caché de TODAS las cartas públicas de UNA empresa (S-26 del plan de endurecimiento de seguridad, tanda T9). La carta de cada sucursal se cachea 60 segundos
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

/**
 * La VERSIÓN de la forma de la carta armada que se guarda en el caché de la carta pública (Fase 5, «carta pareja»): va en la clave de `unstable_cache` (`server/carta-publica/sin-sesion.ts`), así un
 * despliegue que cambia lo que arma el servidor (la `presentacion` de cada ítem y las `tandas` de cada sección) no sirve durante 60 s una carta guardada por el código anterior. Se cambia cada vez que
 * cambia la FORMA de `CartaV1` (no los datos). «carta-pareja-2»: suma `seccionesImpresas` (la carta completa del papel, paso 10b).
 * «carta-pareja-3»: suma `protagonista` en la lista (tanda C, jerarquía).
 */
export const VERSION_DE_LA_CARTA_EN_CACHE = "carta-pareja-3";

/** La carta armada, sin los ids internos: lo que la carta pública emite hacia el navegador. */
export function proyectarCartaPublica(carta: CartaV1): CartaPublicaV1 {
  return {
    version: carta.version,
    generadoEn: carta.generadoEn,
    sucursal: { nombre: carta.sucursal.nombre },
    secciones: carta.secciones.map(proyectarSeccion),
    ...(carta.seccionesImpresas !== undefined ? { seccionesImpresas: carta.seccionesImpresas.map(proyectarSeccion) } : {}),
  };
}
