import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «productos del catálogo» (Hito 4 de la pureza, bloque 4.3, pasos H4C-11 a H4C-13 — `docs/plan-hito-4-pureza.md` §3): los comandos y
 * resultados de los casos de uso de `src/server/actions/catalogo/casos-de-uso/` que vienen de las mutaciones de `src/server/actions/catalogo/productos.ts`. Mismo
 * criterio que `core/features/mesas/mesas.schema.ts`.
 */

/**
 * Los datos de un producto tal como llegan del formulario de alta o edición: los MISMOS campos que `DatosProducto` de la Server Action
 * (`src/server/actions/catalogo/productos.ts`, que es la que documenta cada uno), escritos acá porque el núcleo nace sin tipos de Prisma (`pureza-del-nucleo`;
 * mismo criterio que `EntradaPromoCarta` de `core/features/carta/promos.guard.ts`). `tipo` son los valores del enum `TipoProducto` de prisma/schema.prisma. SIN
 * validar: los valida `validarDatosDeProducto` (server/lecturas/catalogo/datos-de-producto.ts), que lee la unidad de stock a mitad de camino.
 */
export interface EntradaProducto {
  codigo?: string;
  nombre: string;
  tipo: "MP" | "PV";
  categoriaId?: string | null;
  unidadCompraId?: string | null;
  unidadStockId: string;
  factorConversion: number;
  observaciones?: string;
  insumoId?: string | null;
  precioVenta?: number;
  pasoVenta?: number | null;
  seProduce?: boolean;
  esConsignacion?: boolean;
  proveedorConsignacionId?: string | null;
  precioConsignacion?: number;
  activoEnTodasLasSucursales?: boolean;
}

/** Comando «alta rápida de una MP desde el wizard de compra»: el nombre YA recortado y validado y la unidad de stock presente (`guardComandoDarDeAltaProductoRapido`). */
export interface ComandoDarDeAltaProductoRapido {
  nombre: string;
  unidadStockId: string;
}

/** El id y el nombre del producto creado, para el `ResultadoConId` de la Server Action (la pantalla lleva a su ficha; el wizard lo pone en la fila). */
export interface DatosProductoCreado {
  id: string;
  nombre: string;
}

/**
 *  - `DATOS_INVALIDOS`: algún dato del formulario no es válido (`validarDatosDeProducto`; solo el alta completa);
 *  - `YA_EXISTE`: ya hay un producto DISPONIBLE (en alguna sucursal) con ese nombre;
 *  - `CODIGO_REPETIDO`: el código (manual, o el autogenerado agotados los reintentos) ya es de otro producto.
 */
export type ResultadoDarDeAltaProducto = ResultadoCaso<DatosProductoCreado, "DATOS_INVALIDOS" | "YA_EXISTE" | "CODIGO_REPETIDO">;

/** Comando «asignar un insumo a una materia prima existente» (la mitad retroactiva del asistente de hermanar): los dos ids, sin validar (sin guard). */
export interface ComandoAsignarInsumoAProducto {
  productoId: string;
  insumoId: string;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `NO_ES_MP`: solo una materia prima puede tener insumo;
 *  - `UNIDAD_MEZCLADA`: el insumo ya tiene productos disponibles con otra unidad de stock (`validarUnidadInsumo`).
 */
export type ResultadoAsignarInsumoAProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "NO_ES_MP" | "UNIDAD_MEZCLADA">;

/**
 * Comando «agregar (o reactivar con otro factor) una presentación de compra alternativa»: CRUDO. Sin guard: el factor se valida DESPUÉS de leer el producto (sus
 * decimales son los de la unidad de STOCK del producto), así que la validación vive en el caso de uso, en el mismo orden.
 */
export interface ComandoAgregarPresentacionAlternativa {
  productoId: string;
  unidadCompraId: string;
  factorConversion: number;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `ES_LA_UNIDAD_POR_DEFECTO`: la unidad pedida ya es la unidad de compra por defecto del producto;
 *  - `FACTOR_INVALIDO`: el factor no es una cantidad válida para la unidad de stock del producto.
 */
export type ResultadoAgregarPresentacionAlternativa = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "ES_LA_UNIDAD_POR_DEFECTO" | "FACTOR_INVALIDO">;

/** Comando «activar o desactivar una presentación de compra»: el id y el booleano, sin validar (sin guard). */
export interface ComandoActualizarActivaPresentacion {
  presentacionId: string;
  activa: boolean;
}

/**
 * Sin fracasos propios: NO se chequea que la presentación exista — un id roto hace lanzar a Prisma (un 500), como antes de la mudanza (hallazgo informado por el
 * plan, migrado tal cual).
 */
export type ResultadoActualizarActivaPresentacion = ResultadoCaso<null, never>;

/** Comando «disponibilidad de un producto en la sucursal activa»: el id y el booleano, sin validar (sin guard). */
export interface ComandoActualizarDisponibilidadProducto {
  productoId: string;
  disponible: boolean;
}

/**
 *  - `PRODUCTO_NO_ENCONTRADO`: el id no es de un producto;
 *  - `TIENE_DEPENDENCIAS`: al desactivar, algo depende de él en esta sucursal (la receta vigente de un plato disponible acá, o saldo en una sección de acá).
 */
export type ResultadoActualizarDisponibilidadProducto = ResultadoCaso<null, "PRODUCTO_NO_ENCONTRADO" | "TIENE_DEPENDENCIAS">;
