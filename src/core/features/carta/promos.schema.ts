import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «promos de la carta» (Hito 4 de la pureza, bloque 4.2, pasos H4C-2 y H4C-3 — `docs/plan-hito-4-pureza.md` §3): los comandos y resultados de
 * los casos de uso de `src/server/actions/carta/casos-de-uso/` que vienen de la Server Action `src/server/actions/carta/promos.ts`. Mismo criterio que
 * `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Comando «guardar una promo» (alta sin `id`, edición con `id`): lo que recibe `guardarPromoCartaCasoDeUso`, con los datos YA validados por
 * `guardComandoGuardarPromoCarta` (título no vacío y en largo, descripción en largo o `null`, precio de la carta redondeado a centavos, orden).
 */
export interface ComandoGuardarPromoCarta {
  id?: string;
  seccionCartaId: string;
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
}

/**
 * Solo lo que produce el caso de uso (el formato lo rechaza antes el guard):
 *  - `SECCION_NO_ENCONTRADA`: la sección de carta elegida no existe;
 *  - `PROMO_NO_ENCONTRADA`: la promo a editar no existe.
 */
export type ResultadoGuardarPromoCarta = ResultadoCaso<null, "SECCION_NO_ENCONTRADA" | "PROMO_NO_ENCONTRADA">;

/**
 * Comando «fijar el precio de una promo en la sucursal activa»: lo que recibe `guardarPrecioLocalPromoCartaCasoDeUso`, CRUDO. No hay guard (`SIN_GUARD` en
 * `acciones-migradas-con-guard.test.ts`): el precio se valida DESPUÉS de leer la promo (una promo inexistente gana sobre un precio inválido), así que la
 * validación vive en el caso de uso, en el mismo orden que antes.
 */
export interface ComandoGuardarPrecioLocalPromoCarta {
  promoCartaId: string;
  /** `null` o vacío = vuelve al precio de la empresa. */
  precioLocal: number | string | null;
}

/**
 *  - `PROMO_NO_ENCONTRADA`: la promo no existe;
 *  - `PRECIO_INVALIDO`: el precio no es un precio de carta válido;
 *  - `BAJO_EL_PISO`: el precio no alcanza el piso de $0,01 por unidad de los cupos de la promo (en el peor caso).
 */
export type ResultadoGuardarPrecioLocalPromoCarta = ResultadoCaso<null, "PROMO_NO_ENCONTRADA" | "PRECIO_INVALIDO" | "BAJO_EL_PISO">;
