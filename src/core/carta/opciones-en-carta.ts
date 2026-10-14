import { redondearMoneda } from "@/core/moneda";

/**
 * GO-2d (ADR-030; decisión del dueño, 2026-10-13), CARTA-B (variante B «lista clásica», 2026-10-14) y CARTA-C (pastillas, 2026-10-14): cómo se ven en la carta las OPCIONES de un producto. Lógica PURA.
 * Recibe el resumen de precios que ya calculó la venta para mostrar (`resumenDePrecios` de `core/pos`, la misma regla que se cobra; la forma se declara acá, sin importarla, para que
 * `core/carta` no dependa de `core/pos`: este último ya usa la carta para el descuento de producto) y lo traduce a lo que la carta pública puede mostrar (GO-0 §4, aprobado por el dueño).
 *
 * LA REGLA (se decide acá, en el servidor, al armar la salida: el navegador solo recibe lo que se dibuja):
 *  - un grupo de TAMAÑOS (`MEDIDA`) con precios finales DISTINTOS sale como lista con el precio FINAL de cada tamaño (con el descuento de producto, si rige: el descuento va sobre el tamaño,
 *    nunca sobre un recargo), nunca como «+$ 300»;
 *  - en TODOS los demás grupos, las opciones disponibles SIN COSTO (diferencia 0) salen como «pastillas» bajo el nombre del grupo (`sinCosto`: «Preparación» → Solo, Flat white, Cortado;
 *    «Guarnición» → Papas fritas, Puré, Ensalada), en el orden del grupo: el cliente se entera de que existen aunque no cambien el precio (CARTA-B las ocultaba). Un grupo de tamaños
 *    con todos los precios iguales cuenta como uno de esos: sus tamaños salen como pastillas;
 *  - las que SUMAN o RESTAN algo (`recargo`) van a la línea «Adicionales: …»; un grupo mixto sale con las dos cosas;
 *  - un grupo con UNA sola opción sin costo no muestra pastillas (no hay nada que elegir); la «ninguna» («Sin guarnición», «Sin extras») nunca es una pastilla;
 *  - un grupo obligatorio (que no es adicional) ya está en el precio del producto con su opción más barata (`desde`): sus recargos se cuentan sobre ESA, así «Pollo +$ 500 / Carne +$ 800»
 *    sale como «Carne +$ 300» (y «Pollo», sin costo para el cliente, cuenta como la opción sin costo) y nunca se suma dos veces lo que el precio ya incluye;
 *  - un grupo que se queda sin nada que mostrar no sale;
 *  - lo agotado hoy en la sucursal NO llega (lo saca `resumenDePrecios`), y un producto con un grupo obligatorio sin nada para elegir sale de la carta (`vendible: false` → `null`).
 * Los grupos de tamaños los dibuja la carta como una lista con puntitos, las opciones sin costo como pastillas y los recargos de todos los demás grupos, en una sola línea «Adicionales: …».
 */

/** Lo que este módulo lee del resumen de precios (estructural: `ResumenDePrecios` de `core/pos` cumple esta forma). */
export interface ResumenDePreciosParaCarta {
  grupos: readonly {
    nombre: string;
    tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";
    cantidadMinima: number;
    opciones: readonly { nombre: string; esNinguna: boolean; precioFinal: number | null; diferencia: number }[];
  }[];
  desde: number | null;
  vendible: boolean;
}

/** Una opción en la carta: un tamaño con su `precio` final, o algo con su `recargo` (suma o resta; nunca 0). */
export interface OpcionDeGrupoCartaV1 {
  nombre: string;
  precio?: number;
  recargo?: number;
}

/** Un grupo de opciones en la carta que cambia el precio: los tamaños («Tamaño») o los recargos («Preparación», «Extras»). */
export interface GrupoCartaV1 {
  nombre: string;
  opciones: OpcionDeGrupoCartaV1[];
}

/** CARTA-C: las opciones disponibles de un grupo que NO cuestan nada más, solo sus nombres y en el orden del grupo (pastillas bajo el nombre del grupo). Sin ids ni precios. */
export interface OpcionesSinCostoCartaV1 {
  grupo: string;
  opciones: string[];
}

/** Un grupo de tamaños: solo si los precios finales NO son todos iguales (si lo fueran, el precio del producto ya lo dice todo y el tamaño lo elige el mozo). */
function grupoDeTamanos(g: ResumenDePreciosParaCarta["grupos"][number]): GrupoCartaV1 | null {
  const opciones = g.opciones.flatMap((o): OpcionDeGrupoCartaV1[] => (o.precioFinal === null ? [] : [{ nombre: o.nombre, precio: redondearMoneda(o.precioFinal) }]));
  const preciosDistintos = new Set(opciones.map((o) => o.precio));
  return preciosDistintos.size > 1 ? { nombre: g.nombre, opciones } : null;
}

/** Lo que suma o resta cada opción de un grupo que no es de tamaños, sobre lo que el precio del producto ya incluye. La «ninguna» de un adicional no es algo que el cliente pida: no entra. */
function recargosDelGrupo(g: ResumenDePreciosParaCarta["grupos"][number]): { nombre: string; esNinguna: boolean; recargo: number }[] {
  // Un grupo obligatorio ya está en el precio del producto con su opción más barata (ver `desde`): lo que suma cada una se cuenta sobre esa. Un adicional nunca entra en el «desde».
  const obligatorio = g.tipo !== "ADICIONAL" && g.cantidadMinima > 0 && g.opciones.length > 0;
  const incluido = obligatorio ? Math.min(...g.opciones.map((o) => o.diferencia)) : 0;
  return g.opciones.flatMap((o) => (g.tipo === "ADICIONAL" && o.esNinguna ? [] : [{ nombre: o.nombre, esNinguna: o.esNinguna, recargo: redondearMoneda(o.diferencia - incluido) }]));
}

/** Un grupo de recargos: solo las opciones que suman o restan algo. */
function grupoDeRecargos(g: ResumenDePreciosParaCarta["grupos"][number]): GrupoCartaV1 | null {
  const opciones = recargosDelGrupo(g).flatMap((o): OpcionDeGrupoCartaV1[] => (o.recargo === 0 ? [] : [{ nombre: o.nombre, recargo: o.recargo }]));
  return opciones.length > 0 ? { nombre: g.nombre, opciones } : null;
}

/**
 * CARTA-C: las opciones SIN COSTO de un grupo que no se muestra como lista de tamaños, para dibujarlas como pastillas bajo el nombre del grupo. Un grupo de tamaños con todos los precios
 * iguales trae sus tamaños (los que tienen precio que se componga); en los demás, las que no suman ni restan nada (nunca la «ninguna»). Con una sola no hay nada que elegir: no sale.
 */
function opcionesSinCosto(g: ResumenDePreciosParaCarta["grupos"][number]): OpcionesSinCostoCartaV1 | null {
  const nombres = g.tipo === "MEDIDA" ? g.opciones.filter((o) => o.precioFinal !== null).map((o) => o.nombre) : recargosDelGrupo(g).flatMap((o) => (o.esNinguna || o.recargo !== 0 ? [] : [o.nombre]));
  return nombres.length > 1 ? { grupo: g.nombre, opciones: nombres } : null;
}

/** Las opciones de un producto ya listas para la carta (lo que cambia el precio y, aparte, lo que se puede elegir sin costo), o `null` si el producto hoy no se puede pedir (sale de la carta). */
export function opcionesParaLaCarta(resumen: ResumenDePreciosParaCarta): { grupos: GrupoCartaV1[]; sinCosto: OpcionesSinCostoCartaV1[]; desde: number } | null {
  if (!resumen.vendible || resumen.desde === null) return null;
  const grupos: GrupoCartaV1[] = [];
  const sinCosto: OpcionesSinCostoCartaV1[] = [];
  for (const g of resumen.grupos) {
    const enLista = g.tipo === "MEDIDA" ? grupoDeTamanos(g) : grupoDeRecargos(g);
    if (enLista) grupos.push(enLista);
    // Un grupo de tamaños con precios distintos ya sale como lista; cualquier otro puede traer además opciones sin costo (un grupo mixto sale con las dos cosas).
    const enPastillas = g.tipo === "MEDIDA" && enLista ? null : opcionesSinCosto(g);
    if (enPastillas) sinCosto.push(enPastillas);
  }
  return { grupos, sinCosto, desde: resumen.desde };
}
