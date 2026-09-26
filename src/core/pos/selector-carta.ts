import type { CartaV1 } from "@/core/carta/armar-menu";

/**
 * «Agregar al pedido» del POS organizado por SECCIÓN DE CARTA (docs/plan-selector-carta-pos-2026-09-25.md) y, dentro de cada
 * sección, por GÉNERO (docs/plan-genero-carta-2026-09-26.md). Lógica PURA, sin Prisma — la lectura vive en
 * `selector-carta-consulta.ts` (mismo criterio que `armar-menu.ts` / `menu-consulta.ts`): así el componente de cliente puede
 * importar los TIPOS de acá sin arrastrar `@/lib/db` al bundle.
 *
 * OJO con el nombre: esto es la sección de CARTA (`SeccionCarta`, "Platos Principales"), no la sección de STOCK (`Seccion`,
 * "Depósito"). Todo lo de este módulo se llama `…Carta`, nunca `secciones` a secas.
 *
 * Qué decide:
 *  - la ESTRUCTURA sale de la carta pública ya armada (`CartaV1`, de `resolverMenuCarta`): orden de las secciones y de los ítems,
 *    qué producto va dentro de un ítem agrupado y cuál suelto (D3), y el orden de las opciones;
 *  - el PRECIO y el CÓDIGO salen SIEMPRE de `pedibles` (una sola fuente: el precio que se congela al agregar, `precioDeCarta`;
 *    la carta no trae código). Por eso cada opción de un agrupado muestra SU precio, no el del grupo (que es el mayor, D5);
 *  - las promos de la carta se ignoran (no son productos: no se piden). Una sección que queda vacía se descarta;
 *  - «Fuera de carta» (DP1/DP2): todo PV pedible que la carta pública no muestra (no visible, sin sección, sección apagada, dentro
 *    de un agrupado apagado), ordenado por nombre. El mozo sigue pudiendo pedir todo lo que podía pedir antes;
 *  - el GÉNERO (docs/plan-genero-carta-2026-09-26.md, G1/G2, tercer parámetro OPCIONAL `generos`): una carpeta VISUAL, GLOBAL (no
 *    depende de la sección), que agrupa dentro de una sección tanto productos sueltos como ítems agrupados que comparten género.
 *    Sin `generos` (u omitiendo el parámetro), la salida es IDÉNTICA a la de antes de que existiera el género: es aditivo puro.
 *    Dentro de una sección, las carpetas van PRIMERO (por su propio `orden`, después nombre) y los productos SIN género (o con
 *    género apagado/inexistente) van DESPUÉS, en el orden de siempre. Una carpeta sin ningún producto pedible se descarta, igual
 *    que una sección vacía. El género de una opción de un ítem agrupado no existe: hereda el de su ítem agrupado (nunca propio).
 *
 * Invariante (fijado por test/pos/selector-carta.test.ts): cada pedible aparece EXACTAMENTE una vez (en una sección de carta o en
 * «Fuera de carta», dentro o fuera de una carpeta de género), y ningún id de ítem agrupado (`ItemCartaV1.productoId` de un
 * agrupado, D6) ni ningún id de género llega nunca como `productoId`: un agrupado se resuelve a una opción concreta ANTES de
 * llamar a `agregarItems`.
 */

/** Un PV que se puede pedir en la sucursal: disponible acá, con el precio que se congelaría al agregarlo. */
export interface ProductoPedible {
  productoId: string;
  codigo: string;
  nombre: string;
  precio: number;
}

/** Un producto suelto, entrada de nivel superior o dentro de una carpeta de género. */
export interface EntradaProductoSelectorCarta {
  tipo: "producto";
  producto: ProductoPedible;
}

/** Un ítem agrupado con sus opciones, entrada de nivel superior o dentro de una carpeta de género. */
export interface EntradaAgrupadoSelectorCarta {
  tipo: "agrupado";
  /** El id del ítem agrupado de la carta: NUNCA es un `productoId` y nunca viaja a `agregarItems`. */
  itemAgrupadoCartaId: string;
  nombre: string;
  precioMinimo: number;
  precioMaximo: number;
  /** Los PV reales, en el orden de la carta, con su propio precio. Nunca vacío. */
  opciones: ProductoPedible[];
}

/** Lo que puede ir DENTRO de una carpeta de género: lo mismo que a nivel de sección, sin otra carpeta anidada (D: un solo nivel). */
export type EntradaCarpetaSelectorCarta = EntradaProductoSelectorCarta | EntradaAgrupadoSelectorCarta;

/** Una carpeta VISUAL de género (docs/plan-genero-carta-2026-09-26.md): nunca vacía (se descarta si no le queda nada pedible). */
export interface EntradaCarpetaGeneroSelectorCarta {
  tipo: "carpeta";
  generoCartaId: string;
  nombre: string;
  entradas: EntradaCarpetaSelectorCarta[];
}

export type EntradaSelectorCarta = EntradaProductoSelectorCarta | EntradaAgrupadoSelectorCarta | EntradaCarpetaGeneroSelectorCarta;

export interface SeccionSelectorCarta {
  seccionCartaId: string;
  nombre: string;
  /** Nunca vacío. Orden (G2): primero las carpetas de género (por su `orden`, después nombre), después los sueltos de siempre. */
  entradas: EntradaSelectorCarta[];
}

export interface SelectorCartaPos {
  /** Las secciones de carta, en el orden de la carta. Vacío = el POS no dibuja el navegador por secciones (DP3). */
  seccionesCarta: SeccionSelectorCarta[];
  /** Los pedibles que la carta pública no muestra, ordenados por nombre. */
  fueraDeCarta: ProductoPedible[];
}

/** Un género activo (docs/plan-genero-carta-2026-09-26.md): global, como una `SeccionCarta`. */
export interface GeneroCartaPos {
  id: string;
  nombre: string;
  orden: number;
}

/**
 * El tercer parámetro OPCIONAL de `armarSelectorCartaPos`: los géneros activos y a qué género pertenece cada producto suelto (por
 * `productoId`, de `ContenidoCartaProducto.generoCartaId`) o cada ítem agrupado (por `itemAgrupadoCartaId`, de
 * `ItemAgrupadoCarta.generoCartaId`). Ausente en el mapa, o presente pero con un id que no está en `generos` (apagado o borrado
 * — nunca pasa de verdad, pero es defensivo) = sin género: el ítem sale suelto, sin error (G4).
 */
export interface GenerosSelectorCartaPos {
  /** Géneros activos. No hace falta que vengan ordenados: `armarSelectorCartaPos` los ordena (orden → nombre). */
  generos: readonly GeneroCartaPos[];
  generoPorProducto: ReadonlyMap<string, string>;
  generoPorAgrupado: ReadonlyMap<string, string>;
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

export function armarSelectorCartaPos(carta: CartaV1 | null, pedibles: readonly ProductoPedible[], generos?: GenerosSelectorCartaPos): SelectorCartaPos {
  const pediblePorId = new Map(pedibles.map((p) => [p.productoId, p]));
  const ubicados = new Set<string>();
  /** El pedible, si existe y todavía no se ubicó (un `productoId` repetido se ubica una sola vez). */
  const tomar = (productoId: string): ProductoPedible | null => {
    const p = pediblePorId.get(productoId);
    if (!p || ubicados.has(productoId)) return null;
    ubicados.add(productoId);
    return p;
  };

  const generoPorId = new Map((generos?.generos ?? []).map((g) => [g.id, g]));
  /** El género de una entidad (productoId de un suelto, o itemAgrupadoCartaId de un agrupado), si existe y está activo. */
  const generoDe = (mapa: ReadonlyMap<string, string> | undefined, entidadId: string): GeneroCartaPos | undefined => {
    const generoId = mapa?.get(entidadId);
    return generoId ? generoPorId.get(generoId) : undefined;
  };

  const seccionesCarta: SeccionSelectorCarta[] = [];
  for (const seccion of carta?.secciones ?? []) {
    const sueltas: EntradaSelectorCarta[] = [];
    const porCarpeta = new Map<string, EntradaCarpetaSelectorCarta[]>();
    const agregarACarpeta = (generoId: string, entrada: EntradaCarpetaSelectorCarta) => {
      const lista = porCarpeta.get(generoId) ?? [];
      lista.push(entrada);
      porCarpeta.set(generoId, lista);
    };

    for (const item of seccion.items) {
      if (item.opciones) {
        const opciones = item.opciones.flatMap((o) => {
          const p = tomar(o.productoId);
          return p ? [p] : [];
        });
        if (opciones.length === 0) continue;
        const precios = opciones.map((o) => o.precio);
        const entrada: EntradaAgrupadoSelectorCarta = {
          tipo: "agrupado",
          itemAgrupadoCartaId: item.productoId,
          nombre: item.nombre,
          precioMinimo: Math.min(...precios),
          precioMaximo: Math.max(...precios),
          opciones,
        };
        const genero = generoDe(generos?.generoPorAgrupado, item.productoId);
        if (genero) agregarACarpeta(genero.id, entrada);
        else sueltas.push(entrada);
        continue;
      }
      const p = tomar(item.productoId);
      if (!p) continue;
      const entrada: EntradaProductoSelectorCarta = { tipo: "producto", producto: p };
      const genero = generoDe(generos?.generoPorProducto, item.productoId);
      if (genero) agregarACarpeta(genero.id, entrada);
      else sueltas.push(entrada);
    }

    // G2: las carpetas de género van primero (por su `orden`, después nombre); los sueltos, después, en el orden de la carta.
    const carpetas: EntradaSelectorCarta[] = [...porCarpeta.entries()]
      .map(([generoId, entradas]): EntradaCarpetaGeneroSelectorCarta => ({ tipo: "carpeta", generoCartaId: generoId, nombre: generoPorId.get(generoId)!.nombre, entradas }))
      .sort((a, b) => generoPorId.get(a.generoCartaId)!.orden - generoPorId.get(b.generoCartaId)!.orden || comparar(a.nombre, b.nombre));

    const entradas = [...carpetas, ...sueltas];
    if (entradas.length > 0) seccionesCarta.push({ seccionCartaId: seccion.id, nombre: seccion.nombre, entradas });
  }

  // Lo que la carta no ubicó. `tomar` también deduplica acá: un pedible repetido en la entrada va una sola vez.
  const fueraDeCarta = [...pediblePorId.keys()].flatMap((productoId) => {
    const p = tomar(productoId);
    return p ? [p] : [];
  });
  return { seccionesCarta, fueraDeCarta: fueraDeCarta.sort((a, b) => comparar(a.nombre, b.nombre)) };
}

/**
 * Los `ProductoPedible` de una entrada de nivel de sección (suelto, agrupado, o una carpeta de género — recorre sus
 * entradas de adentro): lo usa `AgregarItems` (`agregar-items.tsx`) para armar «Elegido: …» sea cual sea el camino
 * (buscador, carta plana, o dentro de una carpeta), y `test/pos/selector-carta-consulta.test.ts` para chequear paridad de
 * precio contra todo lo que ofrece el selector.
 */
export function pediblesDeEntrada(e: EntradaSelectorCarta): ProductoPedible[] {
  if (e.tipo === "producto") return [e.producto];
  if (e.tipo === "agrupado") return e.opciones;
  return e.entradas.flatMap(pediblesDeEntrada);
}
