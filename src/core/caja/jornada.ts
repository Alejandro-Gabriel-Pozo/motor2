/**
 * La jornada de una sucursal y su ciclo (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, nivel 4; Pedernal `src/modulos/cierre/dominio/jornada.ts`, E3b §3.2 y §3.3). Una jornada por `(empresa, sucursal, fecha de negocio)`:
 * `ABIERTA → EN_AUDITORIA ⇄ ABIERTA` y `EN_AUDITORIA → CERRADA`; nada sale de `CERRADA`. Los nombres técnicos conservan «auditoría» (decisión 160 de Pedernal); en pantalla es «Cierre del día» / «En cierre». Puro: sin reloj ni azar.
 */
export const ESTADOS_DE_JORNADA = ["ABIERTA", "EN_AUDITORIA", "CERRADA"] as const;
export type EstadoDeJornada = (typeof ESTADOS_DE_JORNADA)[number];

/** `SIN_ACTIVIDAD`: nadie registró nada ese día, así que la jornada todavía no existe (la crea quien tiene la primera actividad). */
export type EstadoConsultado = EstadoDeJornada | "SIN_ACTIVIDAD";

/** Las transiciones que permite el dominio. La base impone EXACTAMENTE las mismas (`JornadaDeSucursal_validar_cambio`): una prueba recorre todos los pares y exige que coincidan. */
export const TRANSICIONES_DE_JORNADA: Readonly<Record<EstadoDeJornada, readonly EstadoDeJornada[]>> = {
  ABIERTA: ["EN_AUDITORIA"],
  EN_AUDITORIA: ["ABIERTA", "CERRADA"],
  CERRADA: [],
};

/** Qué hacer al pedir «empezar el cierre»: empezarlo, o ya estaba empezado (repetir no escribe ni audita). */
export function decidirIniciar(estado: EstadoDeJornada): { ok: true; valor: "INICIAR" | "YA_ESTABA" } | { ok: false; error: "JORNADA_CERRADA" } {
  if (estado === "CERRADA") return { ok: false, error: "JORNADA_CERRADA" };
  return { ok: true, valor: estado === "ABIERTA" ? "INICIAR" : "YA_ESTABA" };
}

/** Qué hacer al pedir «cancelar el cierre»: cancelarlo, o ya estaba abierta (repetir no escribe ni audita). */
export function decidirCancelar(estado: EstadoDeJornada): { ok: true; valor: "CANCELAR" | "YA_ESTABA" } | { ok: false; error: "JORNADA_CERRADA" } {
  if (estado === "CERRADA") return { ok: false, error: "JORNADA_CERRADA" };
  return { ok: true, valor: estado === "EN_AUDITORIA" ? "CANCELAR" : "YA_ESTABA" };
}
