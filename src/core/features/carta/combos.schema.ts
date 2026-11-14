import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «combos» (GO-3b, ADR-032): las ENTRADAS de un lugar LISTA (un producto de venta, aunque no esté en la carta, con una configuración fija opcional de
 * opciones). Los comandos llegan ya validados
 * de forma por su guard (`combos.guard.ts`); lo que depende de la base lo decide el caso de uso.
 */

/** Una opción de la configuración fija de una entrada: la opción y sus unidades (1 a 10). */
export interface OpcionDeConfiguracionFija {
  opcionId: string;
  cantidad: number;
}

/** «Que este producto (con esta configuración) sea una entrada activa del lugar»: crea la entrada o reactiva la que ya existía; si ya está activa, no escribe nada. */
export interface ComandoAgregarEntradaDeCupo {
  cupoId: string;
  productoId: string;
  /**
   * `FIJAS` (lo de siempre): `opciones` es la configuración fija (vacía = el producto sin opciones). `A_ELEGIR` (promo que deja elegir al mozo, enmienda de ADR-032 D-6): `opciones` son las PERMITIDAS por
   * grupo (`cantidad` = tope de unidades de esa opción), al menos una, sin adicionales; el mozo elige entre ellas dentro de los límites del grupo.
   */
  modoDeOpciones: "FIJAS" | "A_ELEGIR";
  opciones: readonly OpcionDeConfiguracionFija[];
}

/** Los rechazos de un producto como componente (cargarlo o reactivarlo). */
type CodigoDeComponente = "PRODUCTO_NO_ENCONTRADO" | "PRODUCTO_INVALIDO" | "COMPONENTE_SIN_PRECIO_DE_REFERENCIA" | "COMPONENTE_SIN_RECETA" | "CONFIGURACION_INVALIDA" | "COMBO_ALICUOTAS_DISTINTAS";

/**
 *  - `CUPO_NO_ENCONTRADO`: el lugar no existe (o es de otra empresa);
 *  - `CUPO_INVALIDO`: el lugar no es una lista propia (LISTA) o está dado de baja;
 *  - `PRODUCTO_NO_ENCONTRADO`, `PRODUCTO_INVALIDO` (no es PV o es el ancla de un adicional), `COMPONENTE_SIN_PRECIO_DE_REFERENCIA` (D-8), `COMPONENTE_SIN_RECETA` (D-9);
 *  - `CONFIGURACION_INVALIDA`: la configuración fija no es válida para el producto (faltan opciones obligatorias, una opción no admitida, un adicional…);
 *  - `COMBO_ALICUOTAS_DISTINTAS` (D-2): el producto tiene una alícuota declarada distinta de la de otro componente posible del combo.
 */
export type ResultadoAgregarEntradaDeCupo = ResultadoCaso<{ entradaId: string; huboCambio: boolean }, "CUPO_NO_ENCONTRADO" | "CUPO_INVALIDO" | CodigoDeComponente>;

/** «Llevar la entrada al estado `activa`». Reactivar vuelve a validar el producto como componente (pudo perder la receta o el precio). */
export interface ComandoActivarEntradaDeCupo {
  entradaId: string;
  activa: boolean;
}

export type ResultadoActivarEntradaDeCupo = ResultadoCaso<{ huboCambio: boolean }, "ENTRADA_NO_ENCONTRADA" | "CUPO_INVALIDO" | CodigoDeComponente>;

