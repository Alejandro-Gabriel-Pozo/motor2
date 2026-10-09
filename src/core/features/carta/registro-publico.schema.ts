import type { PosicionPortal } from "@/core/carta/public";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «registro público de las sucursales en el portal» (docs/plan-registro-tenants-2026-09-24.md, M6; Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1): los comandos y resultados de los casos de uso de
 * `src/server/actions/carta/casos-de-uso/{agregar-sucursal-al-portal,guardar-sucursal-publica,quitar-sucursal-del-portal,mover-sucursal-en-mapa}.ts`, que vienen de la
 * Server Action `src/server/actions/carta/registro-publico.ts`. Las cuatro reciben el `Sucursal.id` (la fila es 1:1 con la sucursal) y NO dependen de la sucursal activa:
 * el mapa del portal es entre sucursales.
 */

/** Comando «agregar la sucursal al portal» (D3, opt-in): solo el id, ya comprobado como texto por el guard. */
export interface ComandoAgregarSucursalAlPortal {
  sucursalId: string;
}

/**
 *  - `SUCURSAL_NO_ENCONTRADA`: la sucursal no existe;
 *  - `YA_EN_EL_PORTAL`: ya tiene su fila (el texto da el slug que tiene);
 *  - `SLUG_TOMADO`: otras cargas simultáneas le ganaron el slug las 5 veces que se reintentó.
 * El éxito devuelve el slug que quedó.
 */
export type ResultadoAgregarSucursalAlPortal = ResultadoCaso<{ slug: string }, "SUCURSAL_NO_ENCONTRADA" | "YA_EN_EL_PORTAL" | "SLUG_TOMADO">;

/**
 * Comando «guardar el registro público de una sucursal que ya está en el portal»: lo que recibe `guardarSucursalPublicaCasoDeUso`, con todo YA validado y normalizado por
 * `guardComandoGuardarSucursalPublica` (slug en minúscula, textos en largo o `null`, posición redondeada a 2 decimales y completa o vacía, orden entero).
 */
export interface ComandoGuardarSucursalPublica {
  sucursalId: string;
  slug: string;
  etiqueta: string | null;
  subtituloPortal: string | null;
  posicion: PosicionPortal;
  orden: number;
  publicada: boolean;
}

/**
 *  - `NO_ESTA_EN_EL_PORTAL`: la sucursal todavía no tiene fila (gana sobre el slug repetido);
 *  - `SLUG_EN_USO`: OTRA sucursal ya usa ese slug (el texto la nombra);
 *  - `SLUG_TOMADO`: otra sucursal se lo ganó entre el chequeo y la escritura (el índice único).
 */
export type ResultadoGuardarSucursalPublica = ResultadoCaso<null, "NO_ESTA_EN_EL_PORTAL" | "SLUG_EN_USO" | "SLUG_TOMADO">;

/** Comando «sacar la sucursal del portal»: solo el id, ya comprobado como texto por el guard. */
export interface ComandoQuitarSucursalDelPortal {
  sucursalId: string;
}

/** `NO_ESTA_EN_EL_PORTAL`: la sucursal no tiene fila. */
export type ResultadoQuitarSucursalDelPortal = ResultadoCaso<null, "NO_ESTA_EN_EL_PORTAL">;

/**
 * Comando «mover la tarjeta de una sucursal sobre el mapa»: el id (comprobado como texto por el guard) y las coordenadas CRUDAS. La posición se valida DESPUÉS de leer
 * la fila (necesita el ancho y el alto que ya tiene), así que no la valida el guard.
 */
export interface ComandoMoverSucursalEnMapa {
  sucursalId: string;
  x: number;
  y: number;
}

/**
 *  - `NO_ESTA_EN_EL_PORTAL`: la sucursal no tiene fila (gana sobre todo lo demás);
 *  - `SIN_POSICION`: todavía no tiene posición en el mapa (arrastrar mueve, no ubica por primera vez);
 *  - `POSICION_INVALIDA`: x o y no son un número entre 0 y 100.
 */
export type ResultadoMoverSucursalEnMapa = ResultadoCaso<null, "NO_ESTA_EN_EL_PORTAL" | "SIN_POSICION" | "POSICION_INVALIDA">;
