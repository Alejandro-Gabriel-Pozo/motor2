import type { CodigoAnularVenta } from "@/core/features/ventas/venta.schema";
import type { MotivoDeRechazoDeLaCorreccion } from "@/core/movimientos/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature Cuenta del salón (módulo POS): los comandos y
 * resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/`. Mismo criterio que `core/features/ventas/venta.schema.ts`.
 * Hoy: `cerrarCuenta` y `emitirTicketCorregido`, las dos de `src/server/actions/pos/cuenta-cierre.ts`.
 */

/**
 * Comando «cerrar la cuenta de una mesa»: lo que recibe `cerrarCuentaCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts), YA validado por `guardComandoCerrarCuenta`. Sin clave de idempotencia I3:
 * `cerrarCuenta` nunca la tuvo — es idempotente POR ESTADO (una cuenta ya cerrada responde ok sin volver a vender).
 */
export interface ComandoCerrarCuenta {
  cuentaId: string;
}

/** Solo lo que produce el caso de uso: un `cuentaId` que no es un string lo rechaza antes el guard (`guardComandoCerrarCuenta`). */
/**
 * `PRODUCTO_SIN_RECETA` (ADR-033): un producto de la cuenta perdió su receta vigente en la sucursal entre el pedido y el cobro; la cuenta sigue abierta. `PRODUCTO_REQUIERE_OPCIONES` (fila O.430): un ítem
 * sin sus opciones de un producto que ahora tiene un grupo obligatorio (el grupo se volvió obligatorio entre el pedido y el cobro); la cuenta sigue abierta.
 */
export type CodigoCerrarCuenta = "NO_ENCONTRADA" | "ITEMS_SIN_ENVIAR" | "VENTA_RECHAZADA" | "PRODUCTO_SIN_RECETA" | "PRODUCTO_REQUIERE_OPCIONES";

/**
 * Cómo terminó un cierre exitoso:
 *  - `YA_CERRADA`: la cuenta ya estaba cerrada (doble clic, o reintento de la transacción serializable) — no se escribió nada;
 *  - `SIN_VENTA`: neto cero (todo anulado) — se cerró la cuenta sin venta ni número de ticket;
 *  - `CON_VENTA`: se registró la venta (una Operacion VENTA por línea neta), se numeró el ticket y se cerró la cuenta.
 */
export type DesenlaceCierreDeCuenta = "YA_CERRADA" | "SIN_VENTA" | "CON_VENTA";

/**
 * `datos` de un cierre exitoso. `operacionIds` va en el orden de las líneas netas (vacío si no hubo venta); `numeroTicket` es el número
 * del ejemplar A (`null` si no hubo venta); `insumosEnNegativo` cuenta los avisos de stock negativo auditados (B6bis).
 */
export interface DatosCerrarCuenta {
  desenlace: DesenlaceCierreDeCuenta;
  operacionIds: string[];
  numeroTicket: number | null;
  insumosEnNegativo: number;
}

export type ResultadoCerrarCuenta = ResultadoCaso<DatosCerrarCuenta, CodigoCerrarCuenta>;

/**
 * Comando «emitir ticket corregido»: lo que recibe `emitirTicketCorregidoCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts), con el `cuentaId` ya validado por `guardComandoEmitirTicketCorregido`.
 * El `motivo` viaja CRUDO (`unknown`, tal como llegó): lo valida el caso de uso con `validarMotivoAnulacion` (core/pos/cuenta.ts) DESPUÉS
 * de las guardas de estado, igual que antes — sobre un ticket vigente, un motivo vacío sigue respondiendo «ya refleja las anulaciones».
 * Sin clave de idempotencia I3: `emitirTicketCorregido` nunca la tuvo (una segunda emisión ve el B vigente y se rechaza).
 */
export interface ComandoEmitirTicketCorregido {
  cuentaId: string;
  motivo: unknown;
}

/**
 * Solo lo que produce el caso de uso (un `cuentaId` que no es un string lo rechaza antes el guard):
 *  - `NO_ENCONTRADA`: no hay cuenta con ese id en una mesa de esta sucursal;
 *  - `CUENTA_ABIERTA`: todavía no se cerró, no tiene ticket;
 *  - `SIN_NUMERACION`: se cerró antes de la numeración de tickets (sin ejemplar A);
 *  - `VENTA_ANULADA`: la venta se anuló entera — no hay ticket que corregir;
 *  - `TICKET_VIGENTE`: el último ejemplar ya refleja las anulaciones;
 *  - `MOTIVO_INVALIDO`: motivo vacío o demasiado largo (`validarMotivoAnulacion`).
 */
export type CodigoEmitirTicketCorregido = "NO_ENCONTRADA" | "CUENTA_ABIERTA" | "SIN_NUMERACION" | "VENTA_ANULADA" | "TICKET_VIGENTE" | "MOTIVO_INVALIDO";

/**
 * `datos` de una emisión exitosa: el número del ticket (el MISMO del ejemplar A) y el ejemplar recién emitido (2 = B, 3 = C…) — lo que
 * la Server Action le devuelve a la pantalla para imprimirlo —, más los ids del ejemplar nuevo y del A que corrige (solo para el servidor:
 * la Server Action NO los serializa).
 */
export interface DatosEmitirTicketCorregido {
  numero: number;
  ejemplar: number;
  ejemplarId: string;
  corrigeAId: string;
}

export type ResultadoEmitirTicketCorregido = ResultadoCaso<DatosEmitirTicketCorregido, CodigoEmitirTicketCorregido>;

/**
 * Comando «corregir una línea de una cuenta cerrada» (E0 de la corrección por ajuste, 2026-11-06; docs/diseno-correccion-por-ajuste-2026-11-06.md): anula la línea
 * ENTERA (`operacionId` = la Operacion VENTA de esa línea; una promo se anula entera y un adicional va con su producto), guarda el motivo en la venta y emite el
 * ticket corregido, todo en UNA transacción. YA validado por `guardComandoCorregirLineaDeTicket`.
 *  - `ejemplarVisto` y `totalVisto`: lo que la persona tenía en pantalla (el último ejemplar del ticket y su total). Si no coincide con lo guardado, no se corrige
 *    («la cuenta cambió»): otra persona ya corrigió o anuló mientras tanto.
 *  - `claveIdempotencia` (I3): UUID del diálogo, reenviado tal cual en los reintentos.
 */
export interface ComandoCorregirLineaDeTicket {
  cuentaId: string;
  operacionId: string;
  motivo: string;
  ejemplarVisto: number;
  totalVisto: number;
  claveIdempotencia: string;
}

/**
 * Códigos propios de la corrección de una línea, además de los de «anular una venta» (`NO_ENCONTRADA` de la venta, `YA_ANULADA`, `ES_ADICIONAL`, `CONTEO_POSTERIOR`,
 * `PAGO_CONSIGNANTE_POSTERIOR`…) y de «emitir ticket corregido» (`CUENTA_ABIERTA`, `SIN_NUMERACION`, `VENTA_ANULADA`):
 *  - `CONFLICTO_IDEMPOTENCIA`: la misma clave con otro contenido;
 *  - `LINEA_DE_OTRA_CUENTA`: la venta pedida no es de esta cuenta;
 *  - `LA_CUENTA_CAMBIO`: lo que la persona vio ya no coincide con lo guardado (otro ejemplar o otro total);
 *  - `ULTIMA_LINEA`: es la única línea que sigue vendida: no queda ticket que emitir (para anular la venta entera está «Anular venta»).
 */
export type CodigoCorregirLineaDeTicket = CodigoAnularVenta | CodigoEmitirTicketCorregido | "CONFLICTO_IDEMPOTENCIA" | "LINEA_DE_OTRA_CUENTA" | "LA_CUENTA_CAMBIO" | "ULTIMA_LINEA";

/** `datos` de una corrección: el ejemplar emitido (para imprimirlo) y qué ventas se anularon. `repetida`: un reenvío con la misma clave devolvió el mensaje original. */
export interface DatosCorregirLineaDeTicket {
  numero: number;
  ejemplar: number;
  operacionesAnuladas: string[];
  repetida: boolean;
}

export type ResultadoCorregirLineaDeTicket = ResultadoCaso<DatosCorregirLineaDeTicket, CodigoCorregirLineaDeTicket>;

/**
 * Comando «quitar unidades de una línea de una cuenta cerrada» (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): «cobré 2 cervezas y la
 * mesa tomó 1». YA validado por `guardComandoQuitarUnidadesDeLinea`. Mismo molde que `ComandoCorregirLineaDeTicket`, más:
 *  - `unidadesAQuitar`: entero de 1 a (unidades - 1); quitar todas es anular la línea entera (`corregirLineaDeTicket`);
 *  - `unidadesVistas`: cuántas unidades vendía la línea en la pantalla de la persona (guarda optimista: si otra persona ya la corrigió, no coincide).
 * `operacionId` es la venta VIGENTE de la línea (la que devuelve la lista de líneas corregibles: la original, o la última corrección).
 */
export interface ComandoQuitarUnidadesDeLinea {
  cuentaId: string;
  operacionId: string;
  unidadesAQuitar: number;
  unidadesVistas: number;
  motivo: string;
  ejemplarVisto: number;
  totalVisto: number;
  claveIdempotencia: string;
}

/**
 * Códigos de «quitar unidades»: los de la corrección de una línea entera, más los de la decisión pura (`MotivoDeRechazoDeLaCorreccion`: promo, adicionales, unidades inválidas,
 * la venta cambió…) y `ALCANCE_TOTAL` (se pidió quitar todas las unidades: eso es anular la línea entera, otro botón).
 */
export type CodigoQuitarUnidadesDeLinea = CodigoCorregirLineaDeTicket | MotivoDeRechazoDeLaCorreccion | "ALCANCE_TOTAL";

/** `datos` de quitar unidades: el ejemplar emitido, la venta nueva que reemplaza a la anterior y cuántas unidades quedan. `repetida`: un reenvío con la misma clave devolvió el mensaje original. */
export interface DatosQuitarUnidadesDeLinea {
  numero: number;
  ejemplar: number;
  ventaNuevaId: string | null;
  unidadesQueQuedan: number;
  repetida: boolean;
}

export type ResultadoQuitarUnidadesDeLinea = ResultadoCaso<DatosQuitarUnidadesDeLinea, CodigoQuitarUnidadesDeLinea>;
