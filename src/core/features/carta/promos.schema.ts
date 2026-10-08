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
 *  - `PROMO_NO_ENCONTRADA`: la promo a editar no existe;
 *  - `BAJO_EL_PISO`: el precio nuevo de una promo con cupos no alcanza su piso de $0,01 por unidad del peor caso (O.42).
 */
export type ResultadoGuardarPromoCarta = ResultadoCaso<null, "SECCION_NO_ENCONTRADA" | "PROMO_NO_ENCONTRADA" | "BAJO_EL_PISO">;

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

/**
 * Comando «prender o apagar una promo» (H4C-3): el apagado GENERAL de la empresa (`actualizarActivaPromoCartaCasoDeUso`) y el de la sucursal activa
 * (`actualizarActivaPromoCartaEnSucursalCasoDeUso`). Solo un id y un booleano, que nunca se validaron en la acción (sin guard: el id lo resuelve el caso de uso).
 */
export interface ComandoActivarPromoCarta {
  promoCartaId: string;
  activa: boolean;
}

/** `PROMO_NO_ENCONTRADA`: el id no es de una promo de la empresa. */
export type ResultadoActivarPromoCarta = ResultadoCaso<null, "PROMO_NO_ENCONTRADA">;

/** Un cupo tal como lo manda el formulario del admin (el mismo dato que `DatosCupoPromoCarta` de la Server Action), sin validar. */
export interface EntradaCupoPromoCarta {
  seccionCartaId: string;
  /** Vacío/null → 0 (D1: el mínimo por defecto es 0). */
  cantidadMinima?: number | string | null;
  cantidadMaxima: number | string;
}

/**
 * Comando «reemplazar todos los cupos de una promo» (H4C-3): lo que recibe `guardarCuposPromoCartaCasoDeUso`, CRUDO. Sin guard (`SIN_GUARD`): los cupos se
 * validan DESPUÉS de leer la promo (una promo inexistente gana sobre un cupo inválido), así que la validación vive en el caso de uso, en el mismo orden.
 */
export interface ComandoGuardarCuposPromoCarta {
  promoCartaId: string;
  cupos: readonly EntradaCupoPromoCarta[];
}

/**
 *  - `PROMO_NO_ENCONTRADA`: la promo no existe;
 *  - `CUPO_INVALIDO`: un cupo sin sección, con la sección repetida, o con cantidades fuera de rango (o el mínimo mayor que el máximo);
 *  - `SECCION_NO_ENCONTRADA`: alguna sección de los cupos no existe;
 *  - `BAJO_EL_PISO`: el precio de la empresa, o el precio local de alguna sucursal, no alcanza el piso de $0,01 por unidad del peor caso de los cupos nuevos.
 */
export type ResultadoGuardarCuposPromoCarta = ResultadoCaso<null, "PROMO_NO_ENCONTRADA" | "CUPO_INVALIDO" | "SECCION_NO_ENCONTRADA" | "BAJO_EL_PISO">;
