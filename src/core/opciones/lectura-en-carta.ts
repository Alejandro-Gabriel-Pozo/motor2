import type { TipoDeGrupoDeOpciones } from "./tipos";

/**
 * «Se lee en la carta como» (Fase 4 de la ola «precio y carta», ADR-035, DEC-34): cómo lee la CARTA una opción de un grupo que tiene prefijo (`GrupoDeOpciones.prefijoEnCarta`). Puro, sin Prisma.
 *
 * Con prefijo, la opción se lee «prefijo + opción con la PRIMERA LETRA en minúscula» («De» + «Carne» → «De carne»). La minúscula es la de la primera letra Unicode (el primer punto de código) con las
 * reglas de `es-AR`, sin excepción para siglas («BBQ» → «bBQ», decisión del dueño: si hace falta, se agrega). Sin prefijo, la opción se lee con su nombre tal cual. La opción «ninguna» se lee siempre
 * tal cual (nunca lleva el prefijo ni la minúscula). Solo la usa la carta (en esta fase, la lectura en vivo del formulario del grupo); el POS y el ticket muestran grupo y opción tal cual.
 */
export function leerOpcionEnCarta(prefijo: string | null, opcion: { nombre: string; esNinguna: boolean }): string {
  if (prefijo === null || prefijo === "" || opcion.esNinguna) return opcion.nombre;
  const [primera = "", ...resto] = Array.from(opcion.nombre);
  return `${prefijo} ${primera.toLocaleLowerCase("es-AR")}${resto.join("")}`;
}

/** El tope de «se lee en la carta como» (CHECK `GrupoDeOpciones_prefijo_en_carta_chk`). */
export const LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA = 20;

/** Solo un grupo de VARIANTES o de MEDIDA se lee con prefijo (decisión del dueño): en una INCLUIDA o un ADICIONAL la carta lleva un rótulo («Guarnición:», «Extras:»), que es otra cosa. */
export function admitePrefijoEnCarta(tipo: TipoDeGrupoDeOpciones): boolean {
  return tipo === "VARIANTE" || tipo === "MEDIDA";
}

export const MENSAJE_PREFIJO_SOLO_VARIANTE_O_MEDIDA =
  "«Se lee en la carta como» solo va en un grupo de variantes o de tamaños: en lo incluido y en los adicionales la carta usa el nombre del grupo como rótulo.";
