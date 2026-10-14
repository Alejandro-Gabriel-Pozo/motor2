import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «menú del día» (GO-3b, ADR-032, D-1 y D-5): el plato del día de un lugar DEL_DIA en la SUCURSAL ACTIVA y en una fecha (de hoy a hoy + 13). La clave es
 * `promo_menu_del_dia` (sucursal, piso operario: delegable al encargado). Todo se escribe SOLO en la sucursal activa: el guard compara la sucursal que vio la pantalla con la activa (eco).
 */

/** «Que este producto sea plato del día de este lugar en esta fecha» (llevar al estado activo). */
export interface ComandoAgregarPlatoDelDia {
  cupoId: string;
  /** «AAAA-MM-DD». */
  fecha: string;
  productoId: string;
}

type CodigoDePlato = "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_INVALIDO" | "PRODUCTO_NO_DISPONIBLE" | "COMPONENTE_SIN_PRECIO_DE_REFERENCIA" | "COMPONENTE_SIN_RECETA" | "CONFIGURACION_INVALIDA" | "COMBO_ALICUOTAS_DISTINTAS";

/**
 *  - `CUPO_NO_ENCONTRADO` / `CUPO_INVALIDO`: el lugar no existe (u otra empresa), no es un plato del día o está dado de baja;
 *  - `FECHA_INVALIDA`: la fecha ya pasó o está a más de 13 días;
 *  - los del producto: no existe, no es PV o es ancla, no está disponible en la sucursal, sin precio (D-8), sin receta (D-9), con opciones obligatorias (un plato del día no lleva configuración,
 *    D-6), o con una alícuota distinta de otro componente del menú (D-2).
 */
export type ResultadoAgregarPlatoDelDia = ResultadoCaso<{ platoId: string; huboCambio: boolean }, "CUPO_NO_ENCONTRADO" | "CUPO_INVALIDO" | "FECHA_INVALIDA" | CodigoDePlato>;

/** «Que este plato del día deje de estar» (llevar al estado inactivo). */
export interface ComandoQuitarPlatoDelDia {
  platoId: string;
}

export type ResultadoQuitarPlatoDelDia = ResultadoCaso<{ huboCambio: boolean }, "PLATO_NO_ENCONTRADO" | "FECHA_INVALIDA">;

/** «Copiar a `fecha` los platos del día del día anterior» en la sucursal activa (todos los lugares del día). */
export interface ComandoCopiarMenuDelDiaAnterior {
  fecha: string;
}

/** `SIN_PLATOS_PARA_COPIAR`: el día anterior no tenía ningún plato cargado. Un plato que ya no puede ser componente frena la copia entera (todo o nada), con su código. */
export type ResultadoCopiarMenuDelDiaAnterior = ResultadoCaso<{ copiados: number }, "FECHA_INVALIDA" | "SIN_PLATOS_PARA_COPIAR" | CodigoDePlato>;
