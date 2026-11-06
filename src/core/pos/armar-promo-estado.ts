import { claveDeConfiguracion as claveDeConfiguracionFija } from "./promo-combo";
import { elegidasParaPedir, estadoInicialElegirOpciones, gruposQueFaltan, reducirElegirOpciones } from "./elegir-opciones-estado";
import type { GrupoParaVender } from "./linea-configurada";
import type { CupoDePromoSelectorCarta, EntradaDeCupoSelectorCarta, EntradaPromoSelectorCarta } from "./selector-carta";

/**
 * Reductor PURO del diálogo "Armar promo" del POS (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 11): por cada cupo,
 * cuántas unidades de cada producto elegible eligió el mozo, con los límites de D1 (mínimo/máximo por cupo) aplicados en cada
 * click — nunca se puede pasar del máximo tocando +, y el botón "Agregar promo" (`puedeConfirmarArmarPromo`) queda
 * deshabilitado hasta que TODOS los cupos cumplan su mínimo.
 *
 * GO-3b (ADR-032): también los cupos de ENTRADAS (LISTA y DEL_DIA). Cada cupo y cada elegible se nombran por su CLAVE (`claveDeCupo`, `claveDeElegible`): en un cupo de sección, la sección y el
 * producto (lo de siempre: las acciones siguen llamando a esos campos `seccionCartaId` y `productoId`); en uno de entradas, el id del cupo y el de la entrada. Un cupo FIJO arranca completo y no se
 * toca (lo completa el servidor: no viaja en la elección).
 *
 * Promo «a elegir» (diseño 2026-11-04 §7): una entrada con `grupos` se elige por UNIDAD: cada «+» suma una unidad con sus propias opciones (se elige el plato y después sus opciones, solo las permitidas), y esa unidad
 * cuenta para el máximo del cupo desde que se suma. «Agregar promo» no se habilita mientras una unidad no cumpla los mínimos y máximos de sus grupos. Es comodidad: el servidor vuelve a validar todo.
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
  /** Las unidades de entradas «a elegir», cada una con sus opciones (opcionId → cantidad). Vacío en un cupo sin entradas «a elegir». */
  unidades: readonly UnidadAElegir[];
}

/** UNA unidad de una entrada «a elegir» con lo que el mozo eligió en sus grupos. `uid` identifica la unidad en pantalla; nunca viaja. */
export interface UnidadAElegir {
  uid: number;
  entradaId: string;
  elegidas: Readonly<Record<string, number>>;
}

export interface EstadoArmarPromo {
  promoCartaId: string;
  titulo: string;
  precio: number;
  cupos: readonly CupoDePromoSelectorCarta[];
  elecciones: readonly EleccionCupoEstado[];
  /** El próximo `uid` de una unidad «a elegir» (el reductor es puro: no usa azar ni reloj). */
  proximaUnidad: number;
}

export type AccionArmarPromo =
  | { tipo: "incrementar"; seccionCartaId: string; productoId: string }
  | { tipo: "decrementar"; seccionCartaId: string; productoId: string }
  /** Elegir, sumar o restar una opción de un grupo dentro de UNA unidad «a elegir» (misma regla que «Elegir opciones»: `reducirElegirOpciones`). */
  | { tipo: "opcion"; seccionCartaId: string; uid: number; accion: "elegir" | "sumar" | "restar"; grupoId: string; opcionId: string };

/** La entrada de un cupo de entradas, si el cupo la ofrece. */
function entradaDe(cupo: CupoDePromoSelectorCarta, entradaId: string): EntradaDeCupoSelectorCarta | undefined {
  return "cupoId" in cupo ? cupo.entradas.find((e) => e.entradaId === entradaId) : undefined;
}

/** El estado inicial de armar una promo: todos los cupos en cero. */
export function estadoInicialArmarPromo(entrada: EntradaPromoSelectorCarta): EstadoArmarPromo {
  return {
    promoCartaId: entrada.promoCartaId,
    titulo: entrada.titulo,
    precio: entrada.precio,
    cupos: entrada.cupos,
    proximaUnidad: 1,
    elecciones: entrada.cupos.map((c) => ({
      seccionCartaId: claveDeCupo(c),
      unidades: [],
      // GO-3b: un fijo arranca completo con su única entrada.
      cantidades: "cupoId" in c && c.fijo && c.entradas[0] ? { [c.entradas[0].entradaId]: c.cantidadMinima } : {},
    })),
  };
}

function totalDeEleccion(eleccion: EleccionCupoEstado): number {
  return Object.values(eleccion.cantidades).reduce((suma: number, n) => suma + n, 0) + eleccion.unidades.length;
}

/** Cuánto lleva elegido, en total, el cupo de esta sección (para mostrar "1/2" y deshabilitar + al llegar al máximo). */
export function totalElegidoDelCupo(estado: EstadoArmarPromo, seccionCartaId: string): number {
  const eleccion = estado.elecciones.find((e) => e.seccionCartaId === seccionCartaId);
  return eleccion ? totalDeEleccion(eleccion) : 0;
}

/** Cuánto de ESTE producto eligió el mozo dentro de su cupo. */
export function cantidadElegida(estado: EstadoArmarPromo, seccionCartaId: string, productoId: string): number {
  const eleccion = estado.elecciones.find((e) => e.seccionCartaId === seccionCartaId);
  return (eleccion?.cantidades[productoId] ?? 0) + (eleccion?.unidades.filter((u) => u.entradaId === productoId).length ?? 0);
}

/** Las unidades «a elegir» de una entrada de un cupo, en el orden en que se sumaron. */
export function unidadesDeEntrada(estado: EstadoArmarPromo, seccionCartaId: string, entradaId: string): readonly UnidadAElegir[] {
  return estado.elecciones.find((e) => e.seccionCartaId === seccionCartaId)?.unidades.filter((u) => u.entradaId === entradaId) ?? [];
}

/** Los grupos de una unidad que todavía no llegan a su mínimo («Falta elegir: Proteína»). Sin grupos (no es «a elegir») no falta nada. */
export function gruposQueFaltanDeUnidad(grupos: readonly GrupoParaVender[], unidad: UnidadAElegir): GrupoParaVender[] {
  return gruposQueFaltan({ ...estadoInicialElegirOpciones(), elegidas: unidad.elegidas }, grupos);
}

export function reducirArmarPromo(estado: EstadoArmarPromo, accion: AccionArmarPromo): EstadoArmarPromo {
  const cupo = estado.cupos.find((c) => claveDeCupo(c) === accion.seccionCartaId);
  if (!cupo || ("cupoId" in cupo && cupo.fijo)) return estado;

  if (accion.tipo === "opcion") {
    const eleccion = estado.elecciones.find((e) => e.seccionCartaId === accion.seccionCartaId);
    const unidad = eleccion?.unidades.find((u) => u.uid === accion.uid);
    const grupo = unidad ? entradaDe(cupo, unidad.entradaId)?.grupos?.find((g) => g.grupoId === accion.grupoId) : undefined;
    if (!eleccion || !unidad || !grupo) return estado;
    const antes = { ...estadoInicialElegirOpciones(), elegidas: unidad.elegidas };
    const despues = accion.accion === "restar" ? reducirElegirOpciones(antes, { tipo: "restar", opcionId: accion.opcionId }) : reducirElegirOpciones(antes, { tipo: accion.accion, grupo, opcionId: accion.opcionId });
    if (despues === antes) return estado;
    return {
      ...estado,
      elecciones: estado.elecciones.map((e) => (e === eleccion ? { ...e, unidades: e.unidades.map((u) => (u === unidad ? { ...u, elegidas: despues.elegidas } : u)) } : e)),
    };
  }

  // GO-3b: solo se suma algo que el cupo ofrece (una entrada que se quitó del día, o un producto que ya no es elegible, no entra a la elección).
  const ofrece = "cupoId" in cupo ? cupo.entradas.some((e) => e.entradaId === accion.productoId) : cupo.elegibles.some((p) => p.productoId === accion.productoId);
  if (accion.tipo === "incrementar" && !ofrece) return estado;
  const aElegir = entradaDe(cupo, accion.productoId)?.grupos !== undefined;

  const elecciones = estado.elecciones.map((eleccion): EleccionCupoEstado => {
    if (eleccion.seccionCartaId !== accion.seccionCartaId) return eleccion;

    if (aElegir) {
      // «A elegir»: cada «+» es una unidad nueva (con sus opciones por elegir); cada «−» saca la última de esa entrada.
      if (accion.tipo === "incrementar") {
        if (totalDeEleccion(eleccion) >= cupo.cantidadMaximaCupo) return eleccion;
        return { ...eleccion, unidades: [...eleccion.unidades, { uid: estado.proximaUnidad, entradaId: accion.productoId, elegidas: {} }] };
      }
      const ultima = [...eleccion.unidades].reverse().find((u) => u.entradaId === accion.productoId);
      return ultima ? { ...eleccion, unidades: eleccion.unidades.filter((u) => u !== ultima) } : eleccion;
    }

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
  const sumo = aElegir && accion.tipo === "incrementar" && elecciones.some((e, i) => e.unidades.length > (estado.elecciones[i]?.unidades.length ?? 0));
  return { ...estado, elecciones, proximaUnidad: sumo ? estado.proximaUnidad + 1 : estado.proximaUnidad };
}

/** D1: habilita "Agregar promo" solo cuando TODOS los cupos están entre su mínimo y su máximo. */
export function puedeConfirmarArmarPromo(estado: EstadoArmarPromo): boolean {
  return estado.cupos.every((cupo) => {
    const total = totalElegidoDelCupo(estado, claveDeCupo(cupo));
    if (total < cupo.cantidadMinima || total > cupo.cantidadMaximaCupo) return false;
    // «A elegir»: cada unidad tiene que cumplir los mínimos de sus grupos (los máximos ya los impide el reductor).
    const unidades = estado.elecciones.find((e) => e.seccionCartaId === claveDeCupo(cupo))?.unidades ?? [];
    return unidades.every((u) => gruposQueFaltanDeUnidad(entradaDe(cupo, u.entradaId)?.grupos ?? [], u).length === 0);
  });
}

/** Un cupo con nada elegido cuando su mínimo es 0 no bloquea, pero tampoco aparece en el resultado (D1: opcional). GO-3b: o la de un cupo de entradas, por su id. */
export type EleccionParaAgregar =
  | { seccionCartaId: string; elegidos: { productoId: string; cantidad: number }[] }
  | { cupoId: string; elegidos: { entradaId: string; cantidad: number; opciones?: { opcionId: string; cantidad: number; versionDeOpcionId: string }[] }[] };

/** Lo elegido, en la forma que espera `agregarItems` (mismo shape que `EleccionDePromo`, `src/core/pos/promo-combo.ts`). Un cupo FIJO no viaja: lo completa el servidor. */
export function eleccionParaAgregar(estado: EstadoArmarPromo): EleccionParaAgregar[] {
  return estado.cupos.flatMap((c): EleccionParaAgregar[] => {
    const e = estado.elecciones.find((x) => x.seccionCartaId === claveDeCupo(c));
    const pares = Object.entries(e?.cantidades ?? {});
    if (!("cupoId" in c)) return [{ seccionCartaId: c.seccionCartaId, elegidos: pares.map(([productoId, cantidad]) => ({ productoId, cantidad })) }];
    if (c.fijo) return [];
    // «A elegir»: las unidades con la MISMA configuración se juntan en una fila con sus unidades (el servidor rechaza dos filas iguales); la versión de la opción es la que el mozo vio.
    const filas = new Map<string, { entradaId: string; cantidad: number; opciones: { opcionId: string; cantidad: number; versionDeOpcionId: string }[] }>();
    for (const u of e?.unidades ?? []) {
      const grupos = c.entradas.find((x) => x.entradaId === u.entradaId)?.grupos ?? [];
      const opciones = elegidasParaPedir({ ...estadoInicialElegirOpciones(), elegidas: u.elegidas }, grupos);
      const clave = `${u.entradaId}|${claveDeConfiguracionFija(opciones) ?? JSON.stringify(opciones)}`;
      const fila = filas.get(clave);
      if (fila) fila.cantidad += 1;
      else filas.set(clave, { entradaId: u.entradaId, cantidad: 1, opciones });
    }
    return [{ cupoId: c.cupoId, elegidos: [...pares.map(([entradaId, cantidad]) => ({ entradaId, cantidad })), ...filas.values()] }];
  });
}
