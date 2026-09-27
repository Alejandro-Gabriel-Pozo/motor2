import type { CupoSelectorCarta, EntradaPromoSelectorCarta } from "./selector-carta";

/**
 * Reductor PURO del diálogo "Armar promo" del POS (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): por cada cupo,
 * cuántas unidades de cada producto elegible eligió el mozo, con los límites de D1 (mínimo/máximo por cupo) aplicados en cada
 * click — nunca se puede pasar del máximo tocando +, y el botón "Agregar promo" (`puedeConfirmarArmarPromo`) queda
 * deshabilitado hasta que TODOS los cupos cumplan su mínimo.
 */

export interface EleccionCupoEstado {
  seccionCartaId: string;
  /** productoId → cantidad elegida (entero ≥ 1; un producto en 0 no tiene entrada acá, se borra al decrementar a 0). */
  cantidades: Readonly<Record<string, number>>;
}

export interface EstadoArmarPromo {
  promoCartaId: string;
  titulo: string;
  precio: number;
  cupos: readonly CupoSelectorCarta[];
  elecciones: readonly EleccionCupoEstado[];
}

export type AccionArmarPromo = { tipo: "incrementar"; seccionCartaId: string; productoId: string } | { tipo: "decrementar"; seccionCartaId: string; productoId: string };

/** El estado inicial de armar una promo: todos los cupos en cero. */
export function estadoInicialArmarPromo(entrada: EntradaPromoSelectorCarta): EstadoArmarPromo {
  return {
    promoCartaId: entrada.promoCartaId,
    titulo: entrada.titulo,
    precio: entrada.precio,
    cupos: entrada.cupos,
    elecciones: entrada.cupos.map((c) => ({ seccionCartaId: c.seccionCartaId, cantidades: {} })),
  };
}

function totalDeEleccion(eleccion: EleccionCupoEstado): number {
  return Object.values(eleccion.cantidades).reduce((suma: number, n) => suma + n, 0);
}

/** Cuánto lleva elegido, en total, el cupo de esta sección (para mostrar "1/2" y deshabilitar + al llegar al máximo). */
export function totalElegidoDelCupo(estado: EstadoArmarPromo, seccionCartaId: string): number {
  const eleccion = estado.elecciones.find((e) => e.seccionCartaId === seccionCartaId);
  return eleccion ? totalDeEleccion(eleccion) : 0;
}

/** Cuánto de ESTE producto eligió el mozo dentro de su cupo. */
export function cantidadElegida(estado: EstadoArmarPromo, seccionCartaId: string, productoId: string): number {
  const eleccion = estado.elecciones.find((e) => e.seccionCartaId === seccionCartaId);
  return eleccion?.cantidades[productoId] ?? 0;
}

export function reducirArmarPromo(estado: EstadoArmarPromo, accion: AccionArmarPromo): EstadoArmarPromo {
  const cupo = estado.cupos.find((c) => c.seccionCartaId === accion.seccionCartaId);
  if (!cupo) return estado;

  const elecciones = estado.elecciones.map((eleccion): EleccionCupoEstado => {
    if (eleccion.seccionCartaId !== accion.seccionCartaId) return eleccion;
    const actual = eleccion.cantidades[accion.productoId] ?? 0;

    if (accion.tipo === "incrementar") {
      if (totalDeEleccion(eleccion) >= cupo.cantidadMaximaCupo) return eleccion; // D1: nunca pasa del máximo del cupo.
      return { ...eleccion, cantidades: { ...eleccion.cantidades, [accion.productoId]: actual + 1 } };
    }

    if (actual <= 0) return eleccion;
    const cantidades = { ...eleccion.cantidades };
    if (actual === 1) delete cantidades[accion.productoId];
    else cantidades[accion.productoId] = actual - 1;
    return { ...eleccion, cantidades };
  });
  return { ...estado, elecciones };
}

/** D1: habilita "Agregar promo" solo cuando TODOS los cupos están entre su mínimo y su máximo. */
export function puedeConfirmarArmarPromo(estado: EstadoArmarPromo): boolean {
  return estado.cupos.every((cupo) => {
    const total = totalElegidoDelCupo(estado, cupo.seccionCartaId);
    return total >= cupo.cantidadMinima && total <= cupo.cantidadMaximaCupo;
  });
}

/** Un cupo con nada elegido cuando su mínimo es 0 no bloquea, pero tampoco aparece en el resultado (D1: opcional). */
export interface EleccionParaAgregar {
  seccionCartaId: string;
  elegidos: { productoId: string; cantidad: number }[];
}

/** Lo elegido, en la forma que espera `agregarItems` (mismo shape que `EleccionDeCupo`, `src/core/pos/promo-combo.ts`). */
export function eleccionParaAgregar(estado: EstadoArmarPromo): EleccionParaAgregar[] {
  return estado.elecciones.map((e) => ({
    seccionCartaId: e.seccionCartaId,
    elegidos: Object.entries(e.cantidades).map(([productoId, cantidad]) => ({ productoId, cantidad })),
  }));
}
