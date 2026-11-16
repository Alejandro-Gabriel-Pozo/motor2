/**
 * Clases de movimiento de la caja y su signo (docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, I-5 e I-6) y el ciclo de la sesión (docs/diseno-caja-c1b-en-cierre-2026-11-16.md): ABIERTA → EN_CIERRE → CERRADA,
 * con la vuelta EN_CIERRE → ABIERTA al cancelar el cierre; una cerrada no se reabre. Esas transiciones las hace cumplir la base (`SesionCaja_validar`); acá solo viven las DECISIONES por estado de los casos de uso.
 * La jornada llega con la etapa C2.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */
/** Los estados de la sesión de caja (CHECK `SesionCaja_estado_chk`). */
const ESTADOS_DE_SESION = ["ABIERTA", "EN_CIERRE", "CERRADA"] as const;
type EstadoDeSesion = (typeof ESTADOS_DE_SESION)[number];

/** El estado guardado como tipo cerrado; un valor que no es de la lista (la base no lo permite) es un error, nunca un «supongo». */
export function estadoDeSesion(guardado: string): EstadoDeSesion {
  const e = ESTADOS_DE_SESION.find((x) => x === guardado);
  if (e === undefined) throw new Error(`estadoDeSesion: estado desconocido «${guardado}».`);
  return e;
}

/** Iniciar el cierre: desde ABIERTA se inicia; ya en cierre es un repetido (no escribe ni audita); cerrada no se toca. */
export function decidirIniciarCierre(estado: EstadoDeSesion): "INICIAR" | "YA_ESTABA" | "SESION_CERRADA" {
  if (estado === "ABIERTA") return "INICIAR";
  return estado === "EN_CIERRE" ? "YA_ESTABA" : "SESION_CERRADA";
}

/** Cancelar el cierre: desde EN_CIERRE vuelve a ABIERTA; ya abierta es un repetido; cerrada no se reabre. */
export function decidirCancelarCierre(estado: EstadoDeSesion): "CANCELAR" | "YA_ESTABA" | "SESION_CERRADA" {
  if (estado === "EN_CIERRE") return "CANCELAR";
  return estado === "ABIERTA" ? "YA_ESTABA" : "SESION_CERRADA";
}

/** ¿Entra plata (un cobro, un ingreso, un egreso o una anulación)? Solo con la sesión ABIERTA: en cierre se está contando y una cerrada está congelada. */
export function decidirMovimiento(estado: EstadoDeSesion): "ENTRA" | "CAJA_EN_CIERRE" | "SESION_CERRADA" {
  if (estado === "ABIERTA") return "ENTRA";
  return estado === "EN_CIERRE" ? "CAJA_EN_CIERRE" : "SESION_CERRADA";
}

/** Cerrar con el conteo: solo desde EN_CIERRE; una cerrada se compara con el conteo (repetido o distinto); una abierta primero tiene que iniciar el cierre. */
export function decidirCerrar(estado: EstadoDeSesion): "CERRAR" | "COMPARAR_CON_LO_CERRADO" | "SESION_NO_EN_CIERRE" {
  if (estado === "EN_CIERRE") return "CERRAR";
  return estado === "CERRADA" ? "COMPARAR_CON_LO_CERRADO" : "SESION_NO_EN_CIERRE";
}

/** Las clases de movimiento de caja de C1 y su signo (igual que Pedernal, sin `AJUSTE`, que llega con C2). */
export const CLASES_DE_MOVIMIENTO = ["FONDO_INICIAL", "COBRO", "INGRESO_MANUAL", "EGRESO_MANUAL", "ANULACION"] as const;
export type ClaseDeMovimiento = (typeof CLASES_DE_MOVIMIENTO)[number];

/** El signo que tiene que tener el importe de cada clase (+1 entra plata, -1 sale, 0 = cualquiera distinto de cero: una anulación es el espejo de lo que anula). */
export function signoDeClase(clase: ClaseDeMovimiento): 1 | -1 | 0 {
  switch (clase) {
    case "FONDO_INICIAL":
    case "COBRO":
    case "INGRESO_MANUAL":
      return 1;
    case "EGRESO_MANUAL":
      return -1;
    case "ANULACION":
      return 0;
  }
}

/** ¿El importe con signo (en centavos) es válido para su clase? El fondo inicial admite 0; todo lo demás es distinto de cero. */
export function importeValidoParaClase(clase: ClaseDeMovimiento, centavosConSigno: bigint): boolean {
  const signo = signoDeClase(clase);
  if (clase === "FONDO_INICIAL") return centavosConSigno >= BigInt(0);
  if (signo === 1) return centavosConSigno > BigInt(0);
  if (signo === -1) return centavosConSigno < BigInt(0);
  return centavosConSigno !== BigInt(0);
}
