import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la ANULACIÓN de lo que ya salió a cocina (feature Cuenta del salón, módulo POS; Task #41, Fase M —
 * docs/arquitectura-casos-de-uso-2026-09-27.md): comandos y resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/` que
 * vienen de `src/server/actions/pos/cuenta-anulacion.ts`. Archivo aparte de `cuenta.schema.ts` (cierre y ticket, `cuenta-cierre.ts`) por
 * el mismo corte que ya tienen las Server Actions: acá el sujeto es un ÍTEM (o una promo) de la cuenta, no la cuenta.
 * `anularItemEnviado` (M12c) y `anularPromoEnviada` (M12d): las dos funciones del archivo de acciones.
 */

/**
 * Comando «anular un ítem ya enviado a cocina» (M12c): lo que recibe `anularItemEnviadoCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/anular-item-enviado.ts), con el `cuentaItemId` ya validado por `guardComandoAnularItemEnviado`.
 * `cantidad`, `motivo` y `restanteVisto` viajan CRUDOS (`unknown`, tal como llegaron): los valida el caso de uso en el MISMO orden que
 * antes — guardas de estado → motivo (`validarMotivoAnulacion`) → guarda optimista (`restanteVisto`) → cantidad (`validarCantidadPedido`,
 * que necesita la unidad y el paso del producto) —, así cada combinación inválida sigue respondiendo el mismo mensaje.
 * Sin clave de idempotencia I3: `anularItemEnviado` nunca la tuvo — el doble clic lo frena la guarda optimista (el segundo ve que lo que
 * queda ya no es `restanteVisto`).
 */
export interface ComandoAnularItemEnviado {
  cuentaItemId: string;
  cantidad: unknown;
  motivo: unknown;
  restanteVisto: unknown;
}

/**
 * Solo lo que produce el caso de uso (un `cuentaItemId` que no es un string lo rechaza antes el guard):
 *  - `NO_ENCONTRADO`: no hay ítem con ese id en una mesa de esta sucursal;
 *  - `ES_ANULACION`: el ítem ya es una fila espejo (no se anula una anulación);
 *  - `CUENTA_CERRADA`: la cuenta ya se cerró — su venta se anula por `anularVenta`;
 *  - `SIN_ENVIAR`: todavía no salió a cocina — se quita, no se anula;
 *  - `COMPONENTE_DE_PROMO`: es parte de una promo — se anula la promo entera (Task #16, D4);
 *  - `MOTIVO_INVALIDO`: motivo vacío o demasiado largo (`validarMotivoAnulacion`);
 *  - `RESTANTE_CAMBIO`: la guarda optimista — lo que queda ya no es lo que vio el usuario;
 *  - `CANTIDAD_INVALIDA`: la cantidad no pasa `validarCantidadPedido` (no positiva, > 999, fuera del paso de venta);
 *  - `EXCEDE_RESTANTE`: se pidió anular más de lo que queda.
 */
export type CodigoAnularItemEnviado =
  | "NO_ENCONTRADO"
  | "ES_ANULACION"
  | "CUENTA_CERRADA"
  | "SIN_ENVIAR"
  | "COMPONENTE_DE_PROMO"
  | "MOTIVO_INVALIDO"
  | "RESTANTE_CAMBIO"
  | "CANTIDAD_INVALIDA"
  | "EXCEDE_RESTANTE";

/**
 * `datos` de una anulación exitosa: el id de la fila espejo recién escrita, la cantidad anulada (ya validada, en positivo) y lo que
 * quedaba del ítem antes y después (los mismos valores de la fila de auditoría, campo `cantidadVigente`). Solo para el servidor: la
 * Server Action NO los serializa (`aResultadoAccion`).
 */
export interface DatosAnularItemEnviado {
  espejoId: string;
  cantidadAnulada: number;
  restanteAntes: number;
  restanteDespues: number;
}

export type ResultadoAnularItemEnviado = ResultadoCaso<DatosAnularItemEnviado, CodigoAnularItemEnviado>;

/**
 * Comando «anular una promo ya enviada a cocina» (M12d): lo que recibe `anularPromoEnviadaCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/anular-promo-enviada.ts), con el `promoCuentaId` ya validado por `guardComandoAnularPromoEnviada`.
 * `motivo` viaja CRUDO (`unknown`): lo valida el caso de uso DESPUÉS de las guardas de estado, en el mismo orden que antes, así una
 * promo cerrada o sin enviar sigue respondiendo eso aunque el motivo esté vacío. No hay cantidad ni guarda optimista: la promo se anula
 * ENTERA (Task #16, D4). Sin clave de idempotencia I3: `anularPromoEnviada` nunca la tuvo — el doble clic lo frena «ya está anulada
 * entera» (el segundo ya no encuentra ningún componente con resto).
 */
export interface ComandoAnularPromoEnviada {
  promoCuentaId: string;
  motivo: unknown;
}

/**
 * Solo lo que produce el caso de uso (un `promoCuentaId` que no es un string lo rechaza antes el guard):
 *  - `NO_ENCONTRADA`: no hay promo con ese id en una mesa de esta sucursal;
 *  - `CUENTA_CERRADA`: la cuenta ya se cerró — su venta se anula por `anularVenta` (que también anula los hermanos);
 *  - `SIN_COMPONENTES`: la promo no tiene ningún componente original;
 *  - `SIN_ENVIAR`: algún componente todavía no salió a cocina — se quita la promo, no se anula;
 *  - `MOTIVO_INVALIDO`: motivo vacío o demasiado largo (`validarMotivoAnulacion`);
 *  - `YA_ANULADA`: a ningún componente le queda nada que anular.
 */
export type CodigoAnularPromoEnviada = "NO_ENCONTRADA" | "CUENTA_CERRADA" | "SIN_COMPONENTES" | "SIN_ENVIAR" | "MOTIVO_INVALIDO" | "YA_ANULADA";

/**
 * `datos` de una anulación exitosa: una entrada por componente anulado, en el orden en que se escribieron — el componente original, la
 * fila espejo recién escrita y lo que quedaba de él (lo que anuló, íntegro; la auditoría registra ese valor → 0). Solo para el servidor:
 * la Server Action NO los serializa (`aResultadoAccion`).
 */
export interface DatosAnularPromoEnviada {
  componentes: { cuentaItemId: string; espejoId: string; cantidadAnulada: number }[];
}

export type ResultadoAnularPromoEnviada = ResultadoCaso<DatosAnularPromoEnviada, CodigoAnularPromoEnviada>;
