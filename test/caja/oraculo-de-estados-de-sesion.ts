/**
 * ORÁCULO de la caja C1b (docs/diseno-caja-c1b-en-cierre-2026-11-16.md, nivel 10): qué tiene que pasar con cada COMANDO según el ESTADO de la sesión de caja. Está escrito APARTE del código de producción, a mano y como
 * datos, desde el diseño y desde lo que hace Pedernal (iniciar-cierre, cancelar-cierre, cerrar-sesion, registrar-cobro): no se calcula con las funciones que prueba. El test `en-cierre-c1b.test.ts` lo recorre entero
 * contra Postgres real.
 *
 * DIMENSIONES que cambian dinero, permisos, visibilidad o stock (declaradas acá a propósito):
 *   - el estado de la sesión de caja (ABIERTA, EN_CIERRE, CERRADA): decide si entra plata y si se puede contar y cerrar;
 *   - el comando (los diez de abajo);
 * NO afectan el resultado en esta etapa (declarado): el actor (los permisos los pide la Server Action, que llega con el PR de permisos), la sucursal (la cruza el alcance de la base, probado aparte) y el medio de pago
 * (probado en las reglas de la base). Si aparece una dimensión nueva (un estado, un comando, un caso de uso), el guardián de `en-cierre-c1b.test.ts` falla hasta que se declare acá.
 */

export const ESTADOS = ["ABIERTA", "EN_CIERRE", "CERRADA"] as const;
export type EstadoDelOraculo = (typeof ESTADOS)[number];

export const COMANDOS = [
  "iniciarCierre",
  "cancelarCierre",
  "cerrarConElMismoConteo",
  "cerrarConOtroConteo",
  "cobrar",
  "ingresoManual",
  "egresoManual",
  "anularMovimiento",
  "ajuste",
  "abrir",
] as const;
export type ComandoDelOraculo = (typeof COMANDOS)[number];

export interface Esperado {
  /** `OK` o el código de error que tiene que devolver. */
  resultado: "OK" | string;
  /** Con `OK`: el dato booleano de «ya estaba» (`yaEstabaEnCierre`, `yaEstabaAbierta`, `yaEstabaCerrada`, `yaExistia`), o `null` si el comando no lo tiene. */
  yaEstaba: boolean | null;
  /** El estado de la sesión que se pidió tocar, DESPUÉS del comando. */
  estadoDespues: EstadoDelOraculo;
  /** Cuántas filas de movimiento de caja se agregan (los rechazos y los repetidos no agregan nada). */
  movimientosNuevos: number;
  /** Cuántas sesiones nuevas se abren. */
  sesionesNuevas: number;
  /** Cuántos registros de auditoría se agregan (un repetido no audita; el cierre sin diferencia audita uno). */
  auditoriasNuevas: number;
}

const no = (resultado: string, estadoDespues: EstadoDelOraculo): Esperado => ({ resultado, yaEstaba: null, estadoDespues, movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 0 });

export const ORACULO: Readonly<Record<ComandoDelOraculo, Readonly<Record<EstadoDelOraculo, Esperado>>>> = {
  iniciarCierre: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "EN_CIERRE", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: { resultado: "OK", yaEstaba: true, estadoDespues: "EN_CIERRE", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 0 },
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  cancelarCierre: {
    ABIERTA: { resultado: "OK", yaEstaba: true, estadoDespues: "ABIERTA", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 0 },
    EN_CIERRE: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 1 },
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  // El fondo es de $100,00 y el conteo «mismo» son $100,00: sin diferencia, una sola auditoría (la del cierre).
  cerrarConElMismoConteo: {
    ABIERTA: no("SESION_NO_EN_CIERRE", "ABIERTA"),
    EN_CIERRE: { resultado: "OK", yaEstaba: false, estadoDespues: "CERRADA", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 1 },
    CERRADA: { resultado: "OK", yaEstaba: true, estadoDespues: "CERRADA", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 0 },
  },
  // Otro conteo ($150,00 contra $100,00 esperados): cerrar con diferencia se permite y audita dos veces (cierre y diferencia); sobre una cerrada ya no vale otro conteo.
  cerrarConOtroConteo: {
    ABIERTA: no("SESION_NO_EN_CIERRE", "ABIERTA"),
    EN_CIERRE: { resultado: "OK", yaEstaba: false, estadoDespues: "CERRADA", movimientosNuevos: 0, sesionesNuevas: 0, auditoriasNuevas: 2 },
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  cobrar: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 1, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: no("CAJA_EN_CIERRE", "EN_CIERRE"),
    // Sin sesión sin cerrar no hay a dónde cobrar: no es «en cierre».
    CERRADA: no("SIN_SESION_ABIERTA", "CERRADA"),
  },
  ingresoManual: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 1, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: no("CAJA_EN_CIERRE", "EN_CIERRE"),
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  egresoManual: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 1, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: no("CAJA_EN_CIERRE", "EN_CIERRE"),
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  anularMovimiento: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 1, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: no("CAJA_EN_CIERRE", "EN_CIERRE"),
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  // Ajuste (C2): corrige una jornada ANTERIOR ya cerrada (la celda la prepara); entra como movimiento de la sesión de hoy, así que sigue la misma regla que los demás movimientos.
  ajuste: {
    ABIERTA: { resultado: "OK", yaEstaba: false, estadoDespues: "ABIERTA", movimientosNuevos: 1, sesionesNuevas: 0, auditoriasNuevas: 1 },
    EN_CIERRE: no("CAJA_EN_CIERRE", "EN_CIERRE"),
    CERRADA: no("SESION_CERRADA", "CERRADA"),
  },
  // Abrir: con una sesión sin cerrar (abierta o contándose) la caja ya está abierta; solo con la anterior cerrada se abre una nueva (fondo = un movimiento, una auditoría).
  abrir: {
    ABIERTA: no("CAJA_YA_ABIERTA", "ABIERTA"),
    EN_CIERRE: no("CAJA_YA_ABIERTA", "EN_CIERRE"),
    CERRADA: { resultado: "OK", yaEstaba: false, estadoDespues: "CERRADA", movimientosNuevos: 1, sesionesNuevas: 1, auditoriasNuevas: 1 },
  },
};

/**
 * Los casos de uso de `src/server/actions/caja/casos-de-uso/` y los comandos del oráculo que cubre cada uno (o `[]` con el motivo de que no cambia nada según el estado). Un caso de uso nuevo en esa carpeta
 * que no figure acá hace fallar el guardián.
 */
export const CASOS_DE_USO_DECLARADOS: Readonly<Record<string, readonly ComandoDelOraculo[]>> = {
  "abrir-sesion.ts": ["abrir"],
  "anular-movimiento.ts": ["anularMovimiento"],
  "cancelar-cierre.ts": ["cancelarCierre"],
  "cerrar-sesion.ts": ["cerrarConElMismoConteo", "cerrarConOtroConteo"],
  "cobrar-cuenta.ts": ["cobrar"],
  "iniciar-cierre.ts": ["iniciarCierre"],
  "registrar-ajuste.ts": ["ajuste"],
  "registrar-movimiento-manual.ts": ["ingresoManual", "egresoManual"],
  // Declarados SIN comando: no leen ni cambian el estado de la sesión de caja (resultado igual con ABIERTA, EN_CIERRE o CERRADA).
  // Configuración de medios y cuentas de cobro (C3): no tocan sesiones.
  "cambiar-estado-de-cuenta-de-cobro.ts": [],
  "cambiar-estado-de-medio-de-pago.ts": [],
  "crear-cuenta-de-cobro.ts": [],
  "crear-medio-de-pago.ts": [],
  "editar-cuenta-de-cobro.ts": [],
  "editar-medio-de-pago.ts": [],
  // Jornada y conciliación (C2/C2b): trabajan sobre la jornada; sus controles cuentan como «sin cerrar» toda sesión que no esté CERRADA (EN_CIERRE incluida: `controles-del-dia.ts`), sin leer el estado para otra cosa.
  "cancelar-auditoria.ts": [],
  "cerrar-jornada.ts": [],
  "controles-de-la-jornada.ts": [],
  "corregir-medio-de-cobro.ts": [],
  "dar-conforme-general.ts": [],
  "declarar-total.ts": [],
  "iniciar-auditoria.ts": [],
};
