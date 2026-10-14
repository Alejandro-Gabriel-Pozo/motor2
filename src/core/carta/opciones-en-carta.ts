import { redondearMoneda } from "@/core/moneda";

/**
 * GO-2d (ADR-030; decisión del dueño, 2026-10-13) y CARTA-B (decisión del dueño, variante B «lista clásica», 2026-10-14): cómo se ven en la carta las OPCIONES de un producto. Lógica PURA.
 * Recibe el resumen de precios que ya calculó la venta para mostrar (`resumenDePrecios` de `core/pos`, la misma regla que se cobra; la forma se declara acá, sin importarla, para que
 * `core/carta` no dependa de `core/pos`: este último ya usa la carta para el descuento de producto) y lo traduce a lo que la carta pública puede mostrar (GO-0 §4, aprobado por el dueño).
 *
 * LA REGLA DE CARTA-B: en la carta SOLO aparece lo que CAMBIA EL PRECIO. Lo que da el mismo precio (guarnición, punto de cocción, «Solo» o «Sin guarnición» sin costo, la «ninguna») lo
 * elige el mozo en el POS y NO sale. Se decide acá, en el servidor, al armar la salida: el navegador solo recibe lo que se dibuja.
 *  - un grupo de TAMAÑOS (`MEDIDA`) sale solo si sus precios finales NO son todos iguales; entonces sale con el precio FINAL de cada tamaño (con el descuento de producto, si rige: el
 *    descuento va sobre el tamaño, nunca sobre un recargo), nunca como «+$ 300»;
 *  - una VARIANTE, una INCLUIDA o un ADICIONAL sale solo con las opciones que suman o restan algo (`recargo`, ausente si es 0: «Puré», «Sin guarnición»);
 *  - un grupo obligatorio (que no es adicional) ya está en el precio del producto con su opción más barata (`desde`): sus recargos se cuentan sobre ESA, así «Pollo +$ 500 / Carne +$ 800»
 *    sale como «Carne +$ 300» y nunca se suma dos veces lo que el precio ya incluye;
 *  - la «ninguna» de un adicional («Sin extras») no se muestra: no es algo que el cliente pida;
 *  - un grupo que se queda sin nada que mostrar no sale;
 *  - lo agotado hoy en la sucursal NO llega (lo saca `resumenDePrecios`), y un producto con un grupo obligatorio sin nada para elegir sale de la carta (`vendible: false` → `null`).
 * Los grupos de tamaños los dibuja la carta como una lista con puntitos; los recargos de todos los demás grupos, en una sola línea «Adicionales: …».
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

/** Un grupo de tamaños: solo si los precios finales NO son todos iguales (si lo fueran, el precio del producto ya lo dice todo y el tamaño lo elige el mozo). */
function grupoDeTamanos(g: ResumenDePreciosParaCarta["grupos"][number]): GrupoCartaV1 | null {
  const opciones = g.opciones.flatMap((o): OpcionDeGrupoCartaV1[] => (o.precioFinal === null ? [] : [{ nombre: o.nombre, precio: redondearMoneda(o.precioFinal) }]));
  const preciosDistintos = new Set(opciones.map((o) => o.precio));
  return preciosDistintos.size > 1 ? { nombre: g.nombre, opciones } : null;
}

/** Un grupo de recargos: solo las opciones que suman o restan algo. */
function grupoDeRecargos(g: ResumenDePreciosParaCarta["grupos"][number]): GrupoCartaV1 | null {
  // Un grupo obligatorio ya está en el precio del producto con su opción más barata (ver `desde`): lo que suma cada una se cuenta sobre esa. Un adicional nunca entra en el «desde».
  const obligatorio = g.tipo !== "ADICIONAL" && g.cantidadMinima > 0 && g.opciones.length > 0;
  const incluido = obligatorio ? Math.min(...g.opciones.map((o) => o.diferencia)) : 0;
  const opciones = g.opciones.flatMap((o): OpcionDeGrupoCartaV1[] => {
    if (g.tipo === "ADICIONAL" && o.esNinguna) return [];
    const recargo = redondearMoneda(o.diferencia - incluido);
    return recargo === 0 ? [] : [{ nombre: o.nombre, recargo }];
  });
  return opciones.length > 0 ? { nombre: g.nombre, opciones } : null;
}

/** Las opciones de un producto ya listas para la carta (solo las que cambian el precio), o `null` si el producto hoy no se puede pedir (sale de la carta). */
export function opcionesParaLaCarta(resumen: ResumenDePreciosParaCarta): { grupos: GrupoCartaV1[]; desde: number } | null {
  if (!resumen.vendible || resumen.desde === null) return null;
  const grupos = resumen.grupos.flatMap((g): GrupoCartaV1[] => {
    const enCarta = g.tipo === "MEDIDA" ? grupoDeTamanos(g) : grupoDeRecargos(g);
    return enCarta ? [enCarta] : [];
  });
  return { grupos, desde: resumen.desde };
}
