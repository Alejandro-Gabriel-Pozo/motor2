/**
 * GO-2d (ADR-030; decisión del dueño, 2026-10-13): cómo se ven en la carta las OPCIONES de un producto. Lógica PURA. Recibe el resumen de precios que ya calculó la venta para mostrar
 * (`resumenDePrecios` de `core/pos`, la misma regla que se cobra; la forma se declara acá, sin importarla, para que `core/carta` no dependa de `core/pos`: este último ya usa la
 * carta para el descuento de producto) y lo traduce a lo que la carta pública puede mostrar (GO-0 §4, aprobado por el dueño):
 *  - `obligatorio` y `maximo` del grupo, nunca su tipo interno;
 *  - un TAMAÑO con su precio final (con el descuento de producto, si rige: el descuento va sobre el tamaño, nunca sobre un recargo);
 *  - una VARIANTE, una INCLUIDA o un ADICIONAL con su `recargo` (se omite si es 0: «Puré», «Sin guarnición»);
 *  - lo agotado hoy en la sucursal NO se muestra (decisión 2 del dueño), y un producto con un grupo obligatorio sin nada para elegir sale de la carta (`vendible: false`).
 * La «ninguna» de un adicional («Sin extras») no se muestra: no es algo que el cliente pida.
 */

/** Lo que este módulo lee del resumen de precios (estructural: `ResumenDePrecios` de `core/pos` cumple esta forma). */
export interface ResumenDePreciosParaCarta {
  grupos: readonly {
    nombre: string;
    tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";
    cantidadMinima: number;
    cantidadMaxima: number;
    opciones: readonly { nombre: string; esNinguna: boolean; precioFinal: number | null; diferencia: number }[];
  }[];
  desde: number | null;
  hayVariacion: boolean;
  vendible: boolean;
}

/** Una opción en la carta: un tamaño con su `precio` final, o algo con su `recargo` (ausente si no suma nada). */
export interface OpcionDeGrupoCartaV1 {
  nombre: string;
  precio?: number;
  recargo?: number;
}

/** Un grupo de opciones en la carta («Tamaño», «Guarnición», «Extras»). */
export interface GrupoCartaV1 {
  nombre: string;
  /** Si hay que elegir algo (mínimo mayor que 0). */
  obligatorio: boolean;
  /** Hasta cuántas se eligen. */
  maximo: number;
  opciones: OpcionDeGrupoCartaV1[];
}

/** Las opciones de un producto ya listas para la carta, o `null` si el producto hoy no se puede pedir (sale de la carta). */
export function opcionesParaLaCarta(resumen: ResumenDePreciosParaCarta): { grupos: GrupoCartaV1[]; desde: number; hayVariacion: boolean } | null {
  if (!resumen.vendible || resumen.desde === null) return null;
  const grupos = resumen.grupos.flatMap((g): GrupoCartaV1[] => {
    const opciones = g.opciones.flatMap((o): OpcionDeGrupoCartaV1[] => {
      if (g.tipo === "ADICIONAL" && o.esNinguna) return [];
      if (g.tipo === "MEDIDA") return o.precioFinal === null ? [] : [{ nombre: o.nombre, precio: o.precioFinal }];
      return [o.diferencia !== 0 ? { nombre: o.nombre, recargo: o.diferencia } : { nombre: o.nombre }];
    });
    return opciones.length ? [{ nombre: g.nombre, obligatorio: g.cantidadMinima > 0, maximo: g.cantidadMaxima, opciones }] : [];
  });
  return { grupos, desde: resumen.desde, hayVariacion: resumen.hayVariacion };
}
