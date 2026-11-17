import { claveNaturalDeCupo, LARGO_MAXIMO_NOMBRE_DE_CUPO, type CupoExistente, type CupoPedido, type TipoDeCupo } from "./cupos-de-promo";

/**
 * «Llevar UNA parte de una promo al estado pedido» (E2a de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`). PURO: sin lecturas ni escrituras; lo usa el caso de uso `guardarParteDePromo` y su prueba.
 *
 * Una parte es un LUGAR de la promo: una sección de la carta, o una lista con nombre («No está en la carta»). Se guarda como un cupo:
 *  - «Toda la sección» (`TODA`, solo con una sección): cupo SECCION (regla viva);
 *  - «Solo estos platos» (`SOLO_ESTOS`): cupo LISTA con el NOMBRE de la sección (el enganche por nombre del diseño, alternativa A: sin columna nueva) y sus platos como entradas;
 *  - `NO_ENTRA`: ninguno de los dos está activo (todo nace cerrado).
 * Las dos formas de una misma sección no conviven (I10): llevar una da de baja la otra. Nunca se borra (baja lógica, como siempre).
 */

/** Los modos de una parte: el espejo del tipo de `ComandoGuardarParteDePromo`. Lo recorre el oráculo (`test/carta/parte-de-promo.oraculo.ts`): un modo nuevo obliga a declarar qué cambia. */
export const MODOS_DE_PARTE = ["NO_ENTRA", "TODA", "SOLO_ESTOS"] as const;

export interface PartePedida {
  /** Una sección de la carta (con su nombre, que es el de la lista «Solo estos platos»), o una lista con nombre propio. */
  lugar: { tipo: "SECCION"; seccionCartaId: string; nombreDeSeccion: string } | { tipo: "LISTA"; nombre: string };
  modo: (typeof MODOS_DE_PARTE)[number];
  cantidadMinima: number;
  cantidadMaxima: number;
}

/** Un cupo de la base con el nombre de su sección (un cupo SECCION activo: para impedir que «entera» y «solo estos» de la misma sección convivan). */
export type CupoExistenteConSeccion = CupoExistente & { nombreDeSeccion: string | null };

export type OperacionDeCupo =
  | { op: "BAJA"; cupo: CupoExistente }
  | { op: "CAMBIAR"; estaba: CupoExistente; queda: CupoPedido }
  | { op: "CREAR"; cupo: CupoPedido };

export type PlanDeParte =
  | {
      ok: true;
      /** Lo que hay que escribir, en este orden (primero las bajas). */
      operaciones: OperacionDeCupo[];
      /** Los cupos ACTIVOS de la promo después de la parte (todos, de todos los tipos): sirven para el piso de precio del peor caso. */
      cuposFinales: { cantidadMinima: number; cantidadMaxima: number }[];
      /** La clave natural del cupo que lleva los platos (`SOLO_ESTOS`); `null` en los otros modos. */
      claveDeLaLista: string | null;
    }
  | { ok: false; mensaje: string };

/** La clave natural de la lista de una parte: el nombre sin mayúsculas (lo que usa el índice único de la base). */
function claveDeLista(nombre: string): string {
  return claveNaturalDeCupo({ tipo: "LISTA", seccionCartaId: null, nombre });
}

/**
 * El plan de cupos para llevar la parte al estado pedido, sobre TODOS los cupos de la promo (activos y dados de baja). Repetir el pedido da un plan vacío (por estado). Rechaza: un nombre que ya usa un lugar de otro
 * tipo (aunque esté dado de baja: el índice único es por nombre); una lista con el nombre de una sección que ya entra «entera» (I10); un nombre de más de 80 caracteres.
 */
export function planDeParte(existentes: readonly CupoExistenteConSeccion[], parte: PartePedida): PlanDeParte {
  const nombreDeLista = parte.lugar.tipo === "SECCION" ? parte.lugar.nombreDeSeccion.trim() : parte.lugar.nombre.trim();
  if (parte.modo === "SOLO_ESTOS" && (nombreDeLista === "" || nombreDeLista.length > LARGO_MAXIMO_NOMBRE_DE_CUPO)) {
    return { ok: false, mensaje: `El nombre de un lugar de la promo tiene que tener de 1 a ${LARGO_MAXIMO_NOMBRE_DE_CUPO} caracteres.` };
  }
  const porClave = new Map(existentes.map((c) => [claveNaturalDeCupo(c), c]));
  const claveSeccion = parte.lugar.tipo === "SECCION" ? claveNaturalDeCupo({ tipo: "SECCION", seccionCartaId: parte.lugar.seccionCartaId, nombre: null }) : null;
  const claveLista = claveDeLista(nombreDeLista);
  // Una lista con el nombre de una sección que ya entra entera: «entera» y «solo estos» de la misma sección no conviven.
  if (parte.lugar.tipo === "LISTA" && parte.modo === "SOLO_ESTOS") {
    const entera = existentes.find((c) => c.activo && c.tipo === "SECCION" && c.nombreDeSeccion !== null && c.nombreDeSeccion.trim().toLowerCase() === nombreDeLista.toLowerCase());
    if (entera) return { ok: false, mensaje: `La sección «${entera.nombreDeSeccion}» ya entra entera en la promo: cambiala a «Solo estos platos» desde su propia fila.` };
  }
  const operaciones: OperacionDeCupo[] = [];
  let siguienteOrden = existentes.reduce((m, c) => Math.max(m, c.orden), -1) + 1;

  const llevar = (clave: string, tipo: TipoDeCupo, pedido: CupoPedido | null): string | null => {
    const estaba = porClave.get(clave);
    if (pedido === null) {
      // Un lugar de otro tipo que usa el mismo nombre (aunque esté dado de baja) no se toca nunca: ni se da de baja ni se confunde con la parte.
      if (estaba && estaba.tipo !== tipo) return `Ya hay un lugar «${estaba.nombre ?? ""}» de otro tipo en esta promo (aunque esté dado de baja): usá otro nombre.`;
      if (estaba?.activo) operaciones.push({ op: "BAJA", cupo: estaba });
      return null;
    }
    if (!estaba) {
      operaciones.push({ op: "CREAR", cupo: { ...pedido, orden: siguienteOrden++ } });
      return null;
    }
    if (estaba.tipo !== pedido.tipo) return `Ya hay un lugar «${estaba.nombre ?? ""}» de otro tipo en esta promo (aunque esté dado de baja): usá otro nombre.`;
    const queda: CupoPedido = { ...pedido, nombre: pedido.tipo === "SECCION" ? null : (estaba.nombre ?? pedido.nombre), orden: estaba.orden };
    const igual = estaba.activo && estaba.cantidadMinima === queda.cantidadMinima && estaba.cantidadMaxima === queda.cantidadMaxima;
    if (!igual) operaciones.push({ op: "CAMBIAR", estaba, queda });
    return null;
  };

  const enteraPedida: CupoPedido | null =
    parte.modo === "TODA" && parte.lugar.tipo === "SECCION"
      ? { tipo: "SECCION", seccionCartaId: parte.lugar.seccionCartaId, nombre: null, cantidadMinima: parte.cantidadMinima, cantidadMaxima: parte.cantidadMaxima, orden: 0 }
      : null;
  const listaPedida: CupoPedido | null =
    parte.modo === "SOLO_ESTOS" ? { tipo: "LISTA", seccionCartaId: null, nombre: nombreDeLista, cantidadMinima: parte.cantidadMinima, cantidadMaxima: parte.cantidadMaxima, orden: 0 } : null;
  if (parte.modo === "TODA" && claveSeccion === null) return { ok: false, mensaje: "«Toda la sección» solo se puede elegir en una sección de la carta." };

  // Primero las bajas (lo que se va), después lo que queda o se crea.
  const bajas: Array<() => string | null> = [];
  const altas: Array<() => string | null> = [];
  if (claveSeccion !== null) (enteraPedida === null ? bajas : altas).push(() => llevar(claveSeccion, "SECCION", enteraPedida));
  // Una parte de una LISTA con nombre propio con modo NO_ENTRA da de baja esa lista; con una sección, la lista de su nombre solo se toca si ya existe (no se crea una lista vacía para «quitar»).
  if (listaPedida === null) {
    if (porClave.has(claveLista) || parte.lugar.tipo === "LISTA") bajas.push(() => llevar(claveLista, "LISTA", null));
  } else {
    altas.push(() => llevar(claveLista, "LISTA", listaPedida));
  }
  for (const paso of [...bajas, ...altas]) {
    const rechazo = paso();
    if (rechazo !== null) return { ok: false, mensaje: rechazo };
  }

  // El estado final de los cupos: los de antes con las operaciones aplicadas (por id), más los nuevos; cuentan los activos.
  const finales = new Map(existentes.map((c) => [c.id, { activo: c.activo, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima }]));
  const nuevos: { cantidadMinima: number; cantidadMaxima: number }[] = [];
  for (const o of operaciones) {
    if (o.op === "BAJA") finales.set(o.cupo.id, { activo: false, cantidadMinima: o.cupo.cantidadMinima, cantidadMaxima: o.cupo.cantidadMaxima });
    else if (o.op === "CAMBIAR") finales.set(o.estaba.id, { activo: true, cantidadMinima: o.queda.cantidadMinima, cantidadMaxima: o.queda.cantidadMaxima });
    else nuevos.push({ cantidadMinima: o.cupo.cantidadMinima, cantidadMaxima: o.cupo.cantidadMaxima });
  }
  const cuposFinales = [...[...finales.values()].filter((c) => c.activo).map((c) => ({ cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima })), ...nuevos];
  return { ok: true, operaciones, cuposFinales, claveDeLaLista: parte.modo === "SOLO_ESTOS" ? claveLista : null };
}

/**
 * I12b (CONFIRMADA por el dueño el 2026-11-11, P3): una parte «Solo estos platos» sin ningún plato tildado y con mínimo mayor a 0 se bloquea al guardar (no se abre nunca a «todos»). Devuelve el motivo, o `null` si no corresponde bloquear.
 */
export function motivoDeParteSinPlatos(modo: PartePedida["modo"], cantidadMinima: number, platos: number): string | null {
  if (modo !== "SOLO_ESTOS" || platos > 0 || cantidadMinima <= 0) return null;
  return "Tildá al menos un plato: una parte «Solo estos platos» que lleva una cantidad no se puede guardar sin ninguno.";
}
