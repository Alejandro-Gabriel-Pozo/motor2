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
  /** Decimales que acepta su unidad de stock (docs/plan-pos-agregar-varios-2026-09-26.md): la lista «Por agregar» del POS lo usa
   *  para normalizar la cantidad con la MISMA función que el servidor (`validarCantidadPedido`) ANTES de confirmar. */
  decimales: number;
  /** `Producto.pasoVenta` (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): `null` (el caso común) = una unidad entera por
   *  línea, sin cambios. Puesto, la lista «Por agregar» valida contra el paso (rechaza, nunca redondea) en vez del camino de
   *  siempre — ver `agregar-lista-estado.ts` (`normalizarCantidad`). */
  pasoVenta: number | null;
  /** `tieneStockReal(tipo, seProduce)` de este PV (siempre PV acá) — junto con `pasoVenta`, lo que necesita `validarCantidadPedido`
   *  para decidir si redondear a `decimales` (R3 ya lo garantiza sin op) o dejar la fracción tal cual (sin stock real). */
  tieneStockReal: boolean;
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

/** UN cupo de una promo ARMABLE, con sus elegibles YA resueltos (Task #16, docs/plan-promo-combo-2026-09-26.md, D1/D5). */
export interface CupoSelectorCarta {
  seccionCartaId: string;
  nombreSeccion: string;
  cantidadMinima: number;
  cantidadMaximaCupo: number;
  /** Los mismos pedibles que el selector ya ofrece en esa sección (sueltos visibles + opciones de agrupados activos) — nunca
   *  una lista propia. Vacío = esa sección no tiene nada pedible hoy (el cupo queda igual, sin opciones para elegir). */
  elegibles: ProductoPedible[];
}

/** Una promo ARMABLE, entrada de nivel de sección (Task #16) — SOLO en la sección donde vive la promo (`PromoCarta.
 *  seccionCartaId`), nunca dentro de una carpeta de género (una promo no tiene género propio). */
export interface EntradaPromoSelectorCarta {
  tipo: "promo";
  promoCartaId: string;
  titulo: string;
  /** Precio de la promo entera, ya congelado en `PromoCarta.precio` — se prorratea recién al agregarla (D3). */
  precio: number;
  /** En el orden de `PromoCartaCupo.orden`. Nunca vacío (una promo sin cupos es informativa: `armarSelectorCartaPos` nunca la
   *  recibe acá — ver `PromosSelectorCartaPos`). */
  cupos: CupoSelectorCarta[];
}

export type EntradaSelectorCarta = EntradaProductoSelectorCarta | EntradaAgrupadoSelectorCarta | EntradaCarpetaGeneroSelectorCarta | EntradaPromoSelectorCarta;

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

/** Una promo ARMABLE (con uno o más cupos) activa de la sucursal, tal como la carga la consulta (Task #16). */
export interface PromoSelectorCartaPos {
  promoCartaId: string;
  /** La sección de carta donde se UBICA la promo (`PromoCarta.seccionCartaId`) — no confundir con las secciones de sus
   *  cupos: una promo de "Menús" puede tener un cupo que elige de "Postres". */
  seccionCartaId: string;
  titulo: string;
  precio: number;
  /** Sin resolver los elegibles todavía — `armarSelectorCartaPos` los resuelve con los MISMOS pedibles que ya ubicó en cada
   *  sección (D5), no con una fuente propia. */
  cupos: readonly { seccionCartaId: string; nombreSeccion: string; cantidadMinima: number; cantidadMaximaCupo: number }[];
}

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * El cuarto parámetro OPCIONAL (Task #16, docs/plan-promo-combo-2026-09-26.md): las promos ARMABLES activas de la sucursal.
 * Sin él (u omitiendo el parámetro), la salida es IDÉNTICA a la de antes de que existieran las promos armables — mismo
 * criterio aditivo que se usó con los géneros (Task #23). Cada promo aparece como una entrada `tipo: "promo"` en la sección
 * donde vive (`seccionCartaId`), PRIMERO dentro de esa sección (antes que las carpetas de género y los sueltos) — se
 * descarta en silencio si esa sección no está en la carta pública de la sucursal (apagada, o la sucursal no tiene carta).
 */
export function armarSelectorCartaPos(
  carta: CartaV1 | null,
  pedibles: readonly ProductoPedible[],
  generos?: GenerosSelectorCartaPos,
  promos?: readonly PromoSelectorCartaPos[]
): SelectorCartaPos {
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

  // Task #16: se guarda por sección ANTES de filtrar las vacías — una promo puede vivir en una sección sin ningún producto
  // propio, y los elegibles de un cupo (D5) se leen de acá sin importar el orden de iteración entre secciones.
  const entradasPorSeccion = new Map<string, EntradaSelectorCarta[]>();
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

    entradasPorSeccion.set(seccion.id, [...carpetas, ...sueltas]);
  }

  // Task #16: cada promo se resuelve con los elegibles YA ubicados en la sección de cada uno de sus cupos (D5) — nunca una
  // fuente propia. Se agrupan por la sección donde vive CADA promo (`PromoCarta.seccionCartaId`, no la de sus cupos).
  const promoEntradasPorSeccion = new Map<string, EntradaPromoSelectorCarta[]>();
  for (const promo of promos ?? []) {
    if (!entradasPorSeccion.has(promo.seccionCartaId)) continue; // su sección no está en la carta pública: se ignora, como hoy.
    const entrada: EntradaPromoSelectorCarta = {
      tipo: "promo",
      promoCartaId: promo.promoCartaId,
      titulo: promo.titulo,
      precio: promo.precio,
      cupos: promo.cupos.map((c) => ({
        seccionCartaId: c.seccionCartaId,
        nombreSeccion: c.nombreSeccion,
        cantidadMinima: c.cantidadMinima,
        cantidadMaximaCupo: c.cantidadMaximaCupo,
        elegibles: (entradasPorSeccion.get(c.seccionCartaId) ?? []).flatMap(pediblesDeEntrada),
      })),
    };
    const lista = promoEntradasPorSeccion.get(promo.seccionCartaId) ?? [];
    lista.push(entrada);
    promoEntradasPorSeccion.set(promo.seccionCartaId, lista);
  }

  const seccionesCarta: SeccionSelectorCarta[] = [];
  for (const seccion of carta?.secciones ?? []) {
    // Las promos van PRIMERO (antes que las carpetas de género y los sueltos) dentro de su propia sección.
    const entradas = [...(promoEntradasPorSeccion.get(seccion.id) ?? []), ...(entradasPorSeccion.get(seccion.id) ?? [])];
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
  // Task #16: una promo NO es un pedible — sus componentes elegibles ya están contados en SU propia sección (D5), aparte;
  // devolver algo acá los duplicaría en el invariante "cada pedible aparece exactamente una vez".
  if (e.tipo === "promo") return [];
  return e.entradas.flatMap(pediblesDeEntrada);
}
