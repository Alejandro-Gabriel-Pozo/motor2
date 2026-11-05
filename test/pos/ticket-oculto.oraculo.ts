/**
 * ORÁCULO del ticket del cliente (2026-11-05; `docs/diseno-ticket-respeta-lo-oculto-2026-11-04.md`), escrito a mano y APARTE del código: una tabla legible de qué se imprime y dónde. Ningún test lo calcula
 * llamando a la regla (`seOcultaEnLaCarta`, `nombreEnTicket`): lo comparan contra lo que dicen el ticket, la comanda y el detalle reales.
 *
 * Dimensiones que cambian lo que ve el cliente (visibilidad): el grupo de opciones, el canal donde se lee y el nombre del plato. Un valor nuevo en cualquiera de las listas cambia los CONTEOS que fija el test y
 * obliga a declarar qué se imprime.
 */

/** Cómo está el grupo en la carta AL VENDER. */
export const GRUPOS = ["OCULTO_SIN_PRECIO", "OCULTO_CON_PRECIO", "VISIBLE"] as const;
export type GrupoDelTicket = (typeof GRUPOS)[number];

/** Dónde se lee la línea vendida. */
export const CANALES = ["TICKET_AL_CERRAR", "REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA", "COMANDA", "DETALLE_INTERNO"] as const;
export type CanalDelTicket = (typeof CANALES)[number];

/**
 * ¿La opción elegida de ese grupo se imprime en ese canal?
 *  - Solo el ticket del CLIENTE (al cerrar y en sus reimpresiones) omite lo que la carta ocultaba AL VENDER y no cobraba (OCULTO_SIN_PRECIO).
 *  - Lo que se cobra (OCULTO_CON_PRECIO: el grupo está oculto pero la opción elegida suma al precio) y lo visible se imprimen siempre.
 *  - La comanda de cocina y el detalle interno muestran TODO: la cocina tiene que saber qué preparar.
 *  - La reimpresión es idéntica al original aunque después se cambie el interruptor (queda congelado al vender).
 */
export const SE_IMPRIME: Record<GrupoDelTicket, Record<CanalDelTicket, boolean>> = {
  OCULTO_SIN_PRECIO: { TICKET_AL_CERRAR: false, REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: false, COMANDA: true, DETALLE_INTERNO: true },
  OCULTO_CON_PRECIO: { TICKET_AL_CERRAR: true, REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: true, COMANDA: true, DETALLE_INTERNO: true },
  VISIBLE: { TICKET_AL_CERRAR: true, REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: true, COMANDA: true, DETALLE_INTERNO: true },
};

/** El nombre del plato directo en cada canal, con «Nombre en la carta» «Flan casero» al vender y el interno «Flan». */
export const NOMBRE_DEL_PLATO: Record<CanalDelTicket, string> = {
  TICKET_AL_CERRAR: "Flan casero",
  // Congelado: aunque después el nombre de la carta pase a «Flan de la casa» o se borre.
  REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: "Flan casero",
  // La cocina y el detalle interno usan SIEMPRE el nombre interno.
  COMANDA: "Flan",
  DETALLE_INTERNO: "Flan",
};
