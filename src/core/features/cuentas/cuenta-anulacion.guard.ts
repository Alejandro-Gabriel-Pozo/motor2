import { guardDeId } from "./guard-de-id";
import type { ComandoAnularItemEnviado, ComandoAnularPromoEnviada } from "./cuenta-anulacion.schema";

/**
 * Guard de la ANULACIÓN de lo que ya salió a cocina (feature Cuenta del salón; convención "guard por feature", 2026-09-25; Task #41,
 * Fase M). Formato del comando, ANTES de abrir la transacción. Puro: sin Prisma ni permisos. Archivo aparte de `cuenta.guard.ts` por el
 * mismo motivo que `cuenta-anulacion.schema.ts`.
 */

/** El texto que ya usaba `anularItemEnviado` para un ítem que no es de la sucursal activa (o no existe). */
export const MENSAJE_ITEM_NO_ENCONTRADO = "No se encontró ese ítem en esta sucursal.";

/**
 * Guard del comando «anular un ítem ya enviado» (M12c). Solo el `cuentaItemId`: si no es un string, el MISMO mensaje que «no
 * encontrado» — exactamente lo que ya respondía `anularItemEnviado` (que con un id no-string salteaba el `findFirst` y devolvía ese
 * error). `cantidad`, `motivo` y `restanteVisto` pasan TAL CUAL, sin validar: los valida el caso de uso después de las guardas de estado,
 * en el orden de siempre (ver `ComandoAnularItemEnviado`).
 */
export const guardComandoAnularItemEnviado = guardDeId<ComandoAnularItemEnviado>("cuentaItemId", MENSAJE_ITEM_NO_ENCONTRADO, "cantidad", "motivo", "restanteVisto");

/** El texto que ya usaba `anularPromoEnviada` para una promo que no es de la sucursal activa (o no existe). */
export const MENSAJE_PROMO_NO_ENCONTRADA = "No se encontró esa promo en esta sucursal.";

/**
 * Guard del comando «anular una promo ya enviada» (M12d). Solo el `promoCuentaId`: si no es un string, el MISMO mensaje que «no
 * encontrada» — exactamente lo que ya respondía `anularPromoEnviada` (que con un id no-string salteaba el `findFirst` y devolvía ese
 * error). El `motivo` pasa TAL CUAL: lo valida el caso de uso después de las guardas de estado (ver `ComandoAnularPromoEnviada`).
 */
export const guardComandoAnularPromoEnviada = guardDeId<ComandoAnularPromoEnviada>("promoCuentaId", MENSAJE_PROMO_NO_ENCONTRADA, "motivo");
