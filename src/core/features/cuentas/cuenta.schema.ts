import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature Cuenta del salón (módulo POS; Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md): los comandos y
 * resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/`. Mismo criterio que `core/features/ventas/venta.schema.ts`.
 * Hoy: `cerrarCuenta` (M12a) y `emitirBoletaCorregida` (M12b), las dos de `src/server/actions/pos/cuenta-cierre.ts`.
 */

/**
 * Comando «cerrar la cuenta de una mesa» (M12a): lo que recibe `cerrarCuentaCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts), YA validado por `guardComandoCerrarCuenta`. Sin clave de idempotencia I3:
 * `cerrarCuenta` nunca la tuvo — es idempotente POR ESTADO (una cuenta ya cerrada responde ok sin volver a vender).
 */
export interface ComandoCerrarCuenta {
  cuentaId: string;
}

/** Solo lo que produce el caso de uso: un `cuentaId` que no es un string lo rechaza antes el guard (`guardComandoCerrarCuenta`). */
export type CodigoCerrarCuenta = "NO_ENCONTRADA" | "ITEMS_SIN_ENVIAR" | "VENTA_RECHAZADA";

/**
 * Cómo terminó un cierre exitoso:
 *  - `YA_CERRADA`: la cuenta ya estaba cerrada (doble clic, o reintento de la transacción serializable) — no se escribió nada;
 *  - `SIN_VENTA`: neto cero (todo anulado) — se cerró la cuenta sin venta ni número de boleta;
 *  - `CON_VENTA`: se registró la venta (una Operacion VENTA por línea neta), se numeró la boleta y se cerró la cuenta.
 */
export type DesenlaceCierreDeCuenta = "YA_CERRADA" | "SIN_VENTA" | "CON_VENTA";

/**
 * `datos` de un cierre exitoso. `operacionIds` va en el orden de las líneas netas (vacío si no hubo venta); `numeroBoleta` es el número
 * del ejemplar A (`null` si no hubo venta); `insumosEnNegativo` cuenta los avisos de stock negativo auditados (B6bis).
 */
export interface DatosCerrarCuenta {
  desenlace: DesenlaceCierreDeCuenta;
  operacionIds: string[];
  numeroBoleta: number | null;
  insumosEnNegativo: number;
}

export type ResultadoCerrarCuenta = ResultadoCaso<DatosCerrarCuenta, CodigoCerrarCuenta>;

/**
 * Comando «emitir boleta corregida» (M12b): lo que recibe `emitirBoletaCorregidaCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/emitir-boleta-corregida.ts), con el `cuentaId` ya validado por `guardComandoEmitirBoletaCorregida`.
 * El `motivo` viaja CRUDO (`unknown`, tal como llegó): lo valida el caso de uso con `validarMotivoAnulacion` (core/pos/cuenta.ts) DESPUÉS
 * de las guardas de estado, igual que antes — sobre una boleta vigente, un motivo vacío sigue respondiendo «ya refleja las anulaciones».
 * Sin clave de idempotencia I3: `emitirBoletaCorregida` nunca la tuvo (una segunda emisión ve el B vigente y se rechaza).
 */
export interface ComandoEmitirBoletaCorregida {
  cuentaId: string;
  motivo: unknown;
}

/**
 * Solo lo que produce el caso de uso (un `cuentaId` que no es un string lo rechaza antes el guard):
 *  - `NO_ENCONTRADA`: no hay cuenta con ese id en una mesa de esta sucursal;
 *  - `CUENTA_ABIERTA`: todavía no se cerró, no tiene boleta;
 *  - `SIN_NUMERACION`: se cerró antes de la numeración de boletas (sin ejemplar A);
 *  - `VENTA_ANULADA`: la venta se anuló entera — no hay boleta que corregir;
 *  - `BOLETA_VIGENTE`: el último ejemplar ya refleja las anulaciones;
 *  - `MOTIVO_INVALIDO`: motivo vacío o demasiado largo (`validarMotivoAnulacion`).
 */
export type CodigoEmitirBoletaCorregida = "NO_ENCONTRADA" | "CUENTA_ABIERTA" | "SIN_NUMERACION" | "VENTA_ANULADA" | "BOLETA_VIGENTE" | "MOTIVO_INVALIDO";

/**
 * `datos` de una emisión exitosa: el número de la boleta (el MISMO del ejemplar A) y el ejemplar recién emitido (2 = B, 3 = C…) — lo que
 * la Server Action le devuelve a la pantalla para imprimirlo —, más los ids del ejemplar nuevo y del A que corrige (solo para el servidor:
 * la Server Action NO los serializa).
 */
export interface DatosEmitirBoletaCorregida {
  numero: number;
  ejemplar: number;
  ejemplarId: string;
  corrigeAId: string;
}

export type ResultadoEmitirBoletaCorregida = ResultadoCaso<DatosEmitirBoletaCorregida, CodigoEmitirBoletaCorregida>;
