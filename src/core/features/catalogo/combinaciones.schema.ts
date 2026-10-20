import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «precio y receta por combinación» (GO-3b, ADR-032, frentes A y B): los EJES de las combinaciones de un producto (a lo sumo dos grupos, MEDIDA o VARIANTE de exactamente una
 * opción), una COMBINACIÓN (sobrescritura dispersa: activa o no, con precio propio o sin él), el PRECIO LOCAL de una combinación en la sucursal activa y la RECETA PROPIA de una combinación
 * (versiones que solo se agregan). Los comandos llegan ya validados de forma por su guard (`combinaciones.guard.ts`). Las tarifas compartidas (grupos de precio) se retiraron en la Fase 3.
 */

/** Qué grupos admitidos son los ejes del producto (`null` = sin ese eje). */
export interface ComandoFijarEjesDeProducto {
  productoId: string;
  eje1GrupoId: string | null;
  eje2GrupoId: string | null;
}

/**
 *  - `EJES_INVALIDOS`: más de dos, un grupo que no es MEDIDA ni VARIANTE de exactamente una opción, dos MEDIDAS, el eje 2 sin el 1, o un grupo que el producto no admite (activo);
 *  - `EJES_CON_COMBINACIONES`: el producto ya tiene combinaciones: los ejes no cambian mientras existan (las combinaciones se desactivan, no se borran).
 */
export type ResultadoFijarEjesDeProducto = ResultadoCaso<{ huboCambio: boolean }, "PRODUCTO_NO_ENCONTRADO" | "EJES_INVALIDOS" | "EJES_CON_COMBINACIONES">;

/** Una combinación (eje 1 y, si hay, eje 2) con su estado y su precio: propio o ninguno (rige el aditivo). `versionEsperada` 0 = todavía no existe. */
export interface ComandoGuardarCombinacion {
  productoId: string;
  opcionEje1Id: string;
  opcionEje2Id: string | null;
  versionEsperada: number;
  activa: boolean;
  precio: number | null;
}

/**
 *  - `SIN_EJES`: el producto no declaró ejes;
 *  - `COMBINACION_INVALIDA`: las opciones no son del eje que dicen, el producto no las admite, alguna es la «ninguna», o falta (o sobra) la del eje 2;
 *  - `VERSION_DESACTUALIZADA`: otra persona la creó o la cambió desde que se cargó la pantalla.
 */
export type ResultadoGuardarCombinacion = ResultadoCaso<{ combinacionId: string; huboCambio: boolean }, "PRODUCTO_NO_ENCONTRADO" | "SIN_EJES" | "COMBINACION_INVALIDA" | "VERSION_DESACTUALIZADA">;

/** Lo que la pantalla veía del precio local: el precio y si regía; `null` = no había fila. */
export interface PrecioLocalDeCombinacionVisto {
  precio: number;
  habilitado: boolean;
}

/** El precio de una combinación en la sucursal activa; `precio: null` = vuelve a regir el de la empresa (`habilitado = false`). */
export interface ComandoFijarPrecioLocalDeCombinacion {
  objetivo: { combinacionId: string };
  esperado: PrecioLocalDeCombinacionVisto | null;
  precio: number | null;
}

export type ResultadoFijarPrecioLocalDeCombinacion = ResultadoCaso<{ huboCambio: boolean }, "COMBINACION_NO_ENCONTRADA" | "PRECIO_DESACTUALIZADO">;

/** Un ingrediente de la receta propia de una combinación, en la unidad de stock de su materia prima (la pone el servidor). */
export interface IngredienteDeCombinacionEnComando {
  insumoProductoId: string;
  cantidad: number;
  mermaPorcentaje: number;
}

/**
 * Una versión NUEVA de la receta propia de una combinación. `numeroEsperado` es el número de la vigente que vio la pantalla (0 = no tenía). Sin ingredientes = «sin excepción: vuelve a la regla
 * general» (así se quita una excepción sin borrar nada).
 */
export interface ComandoGuardarRecetaDeCombinacion {
  combinacionId: string;
  numeroEsperado: number;
  ingredientes: readonly IngredienteDeCombinacionEnComando[];
}

/**
 *  - `PRODUCTO_SE_PRODUCE`: un producto que se produce por lote no admite receta por combinación (su venta descuenta su propio stock);
 *  - `RECETA_INVALIDA`: un ingrediente que no es una materia prima de la empresa, repetido, o el envase del tamaño del eje que no se puede aplicar sobre la receta propia;
 *  - `VERSION_DESACTUALIZADA`: otra persona guardó otra versión desde que se cargó la pantalla.
 * El éxito trae los AVISOS (un cambio de una opción que no es eje que apunta a un insumo que la receta propia no tiene: no aplica, no bloquea).
 */
export type ResultadoGuardarRecetaDeCombinacion = ResultadoCaso<
  { numero: number | null; huboCambio: boolean; avisos: string[] },
  "COMBINACION_NO_ENCONTRADA" | "PRODUCTO_SE_PRODUCE" | "RECETA_INVALIDA" | "VERSION_DESACTUALIZADA"
>;
