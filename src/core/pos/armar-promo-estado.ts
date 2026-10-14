import type { CupoDePromoSelectorCarta, EntradaPromoSelectorCarta } from "./selector-carta";

/**
 * Reductor PURO del diálogo "Armar promo" del POS (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): por cada cupo,
 * cuántas unidades de cada producto elegible eligió el mozo, con los límites de D1 (mínimo/máximo por cupo) aplicados en cada
 * click — nunca se puede pasar del máximo tocando +, y el botón "Agregar promo" (`puedeConfirmarArmarPromo`) queda
 * deshabilitado hasta que TODOS los cupos cumplan su mínimo.
 *
 * GO-3b (ADR-032): también los cupos de ENTRADAS (LISTA y DEL_DIA). Cada cupo y cada elegible se nombran por su CLAVE (`claveDeCupo`, `claveDeElegible`): en un cupo de sección, la sección y el
 * producto (lo de siempre: las acciones siguen llamando a esos campos `seccionCartaId` y `productoId`); en uno de entradas, el id del cupo y el de la entrada. Un cupo FIJO arranca completo y no se
 * toca (lo completa el servidor: no viaja en la elección).
 */

/** La clave de un cupo en el estado: su sección, o (GO-3b) el id del cupo de entradas. */
export function claveDeCupo(c: CupoDePromoSelectorCarta): string {
  return "cupoId" in c ? c.cupoId : c.seccionCartaId;
}

export interface EleccionCupoEstado {
  /** La clave del cupo (`claveDeCupo`). */
  seccionCartaId: string;
  /** productoId → cantidad elegida (entero ≥ 1; un producto en 0 no tiene entrada acá, se borra al decrementar a 0). */
  cantidades: Readonly<Record<string, number>>;
}

export interface EstadoArmarPromo {
  promoCartaId: string;
  titulo: string;
  precio: number;
  cupos: readonly CupoDePromoSelectorCarta[];
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
    elecciones: entrada.cupos.map((c) => ({
      seccionCartaId: claveDeCupo(c),
      // GO-3b: un fijo arranca completo con su única entrada.
      cantidades: "cupoId" in c && c.fijo && c.entradas[0] ? { [c.entradas[0].entradaId]: c.cantidadMinima } : {},
    })),
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
  const cupo = estado.cupos.find((c) => claveDeCupo(c) === accion.seccionCartaId);
  if (!cupo || ("cupoId" in cupo && cupo.fijo)) return estado;
  // GO-3b: solo se suma algo que el cupo ofrece (una entrada que se quitó del día, o un producto que ya no es elegible, no entra a la elección).
  const ofrece = "cupoId" in cupo ? cupo.entradas.some((e) => e.entradaId === accion.productoId) : cupo.elegibles.some((p) => p.productoId === accion.productoId);
  if (accion.tipo === "incrementar" && !ofrece) return estado;

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
    const total = totalElegidoDelCupo(estado, claveDeCupo(cupo));
    return total >= cupo.cantidadMinima && total <= cupo.cantidadMaximaCupo;
  });
}

/** Un cupo con nada elegido cuando su mínimo es 0 no bloquea, pero tampoco aparece en el resultado (D1: opcional). GO-3b: o la de un cupo de entradas, por su id. */
export type EleccionParaAgregar = { seccionCartaId: string; elegidos: { productoId: string; cantidad: number }[] } | { cupoId: string; elegidos: { entradaId: string; cantidad: number }[] };

/** Lo elegido, en la forma que espera `agregarItems` (mismo shape que `EleccionDePromo`, `src/core/pos/promo-combo.ts`). Un cupo FIJO no viaja: lo completa el servidor. */
export function eleccionParaAgregar(estado: EstadoArmarPromo): EleccionParaAgregar[] {
  return estado.cupos.flatMap((c): EleccionParaAgregar[] => {
    const e = estado.elecciones.find((x) => x.seccionCartaId === claveDeCupo(c));
    const pares = Object.entries(e?.cantidades ?? {});
    if (!("cupoId" in c)) return [{ seccionCartaId: c.seccionCartaId, elegidos: pares.map(([productoId, cantidad]) => ({ productoId, cantidad })) }];
    if (c.fijo) return [];
    return [{ cupoId: c.cupoId, elegidos: pares.map(([entradaId, cantidad]) => ({ entradaId, cantidad })) }];
  });
}
